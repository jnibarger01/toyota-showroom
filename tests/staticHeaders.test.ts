import path from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards `public/_headers` (docs/INTEGRATION_GUIDE.md §17), the Cloudflare Workers Static Assets
 * cache-control config for this app's static asset weight.
 *
 * Providing a hand-authored `public/_headers` replaces vinext's own auto-generated one *entirely*
 * rather than merging with it — confirmed empirically while writing this file (a build with only a
 * `/models/*` rule in `public/_headers` produced a `dist/client/_headers` with no `/assets/*` rule
 * at all). That makes "did we keep the immutable rule for content-hashed build output" a real
 * regression this test exists to catch, not a hypothetical.
 */
const HEADERS_PATH = path.resolve(__dirname, "../public/_headers");
const PUBLIC_DIR = path.resolve(__dirname, "../public");

/**
 * `public/catalog/` is `.gitignore`d — generated at build/dev time by
 * `scripts/generate-static-api.ts` (the `prebuild`/`predev` npm hooks), not checked into the repo.
 * A fresh checkout has no such directory until one of those hooks has run, which CI's `verify` job
 * (`npm test` before `npm run build`) never does — this failed there for real (existsSync false on
 * a clean checkout) despite passing locally, where a prior `npm run build` had already generated
 * it. Exempted from the on-disk existence check below for that reason, same as `/assets/*`.
 */
const GENERATED_AT_BUILD_TIME = new Set(["/assets/*", "/catalog/*"]);

/** The catch-all rule carrying security headers rather than caching policy. */
const SECURITY_RULE_PATTERN = "/*";

const LAYOUT_PATH = path.resolve(__dirname, "../app/layout.tsx");

/** Parses a CSP string into directive name -> sorted source list, so comparison is order-insensitive. */
function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives.set(tokens[0]!, tokens.slice(1).sort());
  }
  return directives;
}

type Rule = { pattern: string; headers: Record<string, string> };

function parseHeadersFile(contents: string): Rule[] {
  const rules: Rule[] = [];
  let current: Rule | null = null;

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }

    if (!current) throw new Error(`Indented header line has no preceding path pattern: ${JSON.stringify(rawLine)}`);
    const [name, ...rest] = line.trim().split(":");
    current.headers[name.trim()] = rest.join(":").trim();
  }

  return rules;
}

describe("public/_headers", () => {
  const contents = readFileSync(HEADERS_PATH, "utf8");
  const rules = parseHeadersFile(contents);

  it("keeps the immutable rule for vite/vinext's content-hashed build output", () => {
    const assetsRule = rules.find((rule) => rule.pattern === "/assets/*");
    expect(assetsRule).toBeDefined();
    expect(assetsRule?.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  });

  it("gives every non-hashed asset directory a Cache-Control rule, and every rule a real target", () => {
    // Non-hashed = never renamed on edit (§1, §15's GLB edits-in-place), so `immutable` would be
    // wrong for any of these — every one of these rules must bound its staleness with a real
    // max-age instead.
    for (const rule of rules) {
      // `/*` carries security headers for every response and deliberately sets no Cache-Control:
      // it matches HTML and `.rsc` payloads too, whose caching is left to Cloudflare's default.
      if (rule.pattern === SECURITY_RULE_PATTERN) continue;

      expect(rule.headers["Cache-Control"], `rule for ${rule.pattern}`).toBeDefined();
      if (rule.pattern === "/assets/*") continue; // content-hashed, so genuinely immutable
      expect(rule.headers["Cache-Control"]).not.toMatch(/immutable/);

      if (GENERATED_AT_BUILD_TIME.has(rule.pattern)) continue; // not on disk in a fresh checkout
      const dir = rule.pattern.replace(/\/\*$/, "");
      const onDisk = path.join(PUBLIC_DIR, dir);
      expect(existsSync(onDisk), `${rule.pattern} should resolve under public/${dir}`).toBe(true);
    }
  });

  it("has no rule for a public/ directory that public/_headers doesn't already cover", () => {
    // Catches drift the other direction: a new top-level asset folder added to public/ without a
    // matching cache rule silently falls back to Cloudflare's own revalidate-always default —
    // correct for HTML, a missed optimization for anything else large and static.
    const topLevelDirs = readdirSync(PUBLIC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const covered = new Set(
      rules
        .filter((rule) => rule.pattern !== SECURITY_RULE_PATTERN)
        .map((rule) => rule.pattern.replace(/^\//, "").replace(/\/\*$/, "")),
    );
    for (const dir of topLevelDirs) {
      expect(covered.has(dir), `public/${dir}/ has no matching rule in public/_headers`).toBe(true);
    }
  });
});


/**
 * Keeps the two Content-Security-Policy delivery mechanisms from drifting apart.
 *
 * This app has two deployment targets that need the same policy delivered differently: the
 * Cloudflare Worker can send a real header (`public/_headers`), while GitHub Pages has no server
 * and can only carry a `<meta http-equiv>` tag in `app/layout.tsx`. Two copies of one policy is a
 * setup that silently diverges — someone loosens `connect-src` to make a feature work, tests it on
 * one target, and ships a policy mismatch nobody sees until the other target breaks in production.
 */
describe("Content-Security-Policy across both deployment targets", () => {
  const headerRule = parseHeadersFile(readFileSync(HEADERS_PATH, "utf8")).find(
    (rule) => rule.pattern === SECURITY_RULE_PATTERN,
  );
  const headerPolicy = headerRule?.headers["Content-Security-Policy"];

  const layout = readFileSync(LAYOUT_PATH, "utf8");
  const metaPolicy = layout.match(/content="(default-src[^"]*)"/)?.[1];

  it("sends a CSP header on the Cloudflare deployment", () => {
    expect(headerPolicy, "public/_headers has no Content-Security-Policy on /*").toBeTruthy();
  });

  it("still ships the meta policy, the only mechanism GitHub Pages has", () => {
    // `_headers` is a Cloudflare Workers Static Assets feature; GitHub Pages does not read it, so
    // removing the meta tag would leave that target with no policy at all.
    expect(metaPolicy, "app/layout.tsx has no meta CSP").toBeTruthy();
  });

  it("enforces frame-ancestors in the header, which a meta tag structurally cannot", () => {
    // frame-ancestors and sandbox are header-only per spec and silently ignored in a meta tag.
    // This directive is the reason the header exists at all.
    expect(parsePolicy(headerPolicy!).get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("agrees with the meta policy on every directive they share", () => {
    const header = parsePolicy(headerPolicy!);
    const meta = parsePolicy(metaPolicy!);

    for (const [directive, sources] of meta) {
      expect(header.get(directive), `directive "${directive}" differs between the two policies`).toEqual(
        sources,
      );
    }
  });

  it("adds nothing beyond frame-ancestors to the header", () => {
    // The header may carry header-only directives the meta tag cannot express, but anything else
    // extra would mean the two targets enforce genuinely different policies.
    const header = parsePolicy(headerPolicy!);
    const meta = parsePolicy(metaPolicy!);
    const extra = [...header.keys()].filter((directive) => !meta.has(directive));

    expect(extra.sort()).toEqual(["frame-ancestors"]);
  });

  it("keeps the non-CSP security headers on the catch-all rule", () => {
    for (const header of [
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "X-Frame-Options",
    ]) {
      expect(headerRule?.headers[header], `${header} missing from /*`).toBeTruthy();
    }
  });
});
