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
      expect(rule.headers["Cache-Control"], `rule for ${rule.pattern}`).toBeDefined();
      if (rule.pattern === "/assets/*") continue; // hashed output only exists post-build, not under public/
      expect(rule.headers["Cache-Control"]).not.toMatch(/immutable/);

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

    const covered = new Set(rules.map((rule) => rule.pattern.replace(/^\//, "").replace(/\/\*$/, "")));
    for (const dir of topLevelDirs) {
      expect(covered.has(dir), `public/${dir}/ has no matching rule in public/_headers`).toBe(true);
    }
  });
});
