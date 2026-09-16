#!/usr/bin/env node
/**
 * Stamps `CACHE_VERSION` in the built demo service worker so every deploy gets a fresh cache name.
 *
 * Acceptance for #49: "Cache version bumps on deploy". The source file (`public/sw.js`) ships with
 * `CACHE_VERSION = "dev"`; this script rewrites the copy under `dist/client/sw.js` (or a path
 * passed as argv) to `v-<git-sha>` using `GITHUB_SHA` in CI or `git rev-parse` locally.
 *
 * Safe no-op when the target file is missing (e.g. a Worker-only artifact layout that omitted the
 * static client tree) — the demo worker is Pages-scoped and must not fail unrelated builds.
 *
 * The pure rewrite lives in `lib/pwa/stampDemoSw.ts` (imported via a tiny duplicated regex here so
 * this classic `.mjs` script stays dependency-free for CI). Keep the pattern in lockstep with that
 * module — `tests/demoSwPolicy.test.ts` exercises the TypeScript helper.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveVersion() {
  const fromEnv = process.env.DEMO_SW_CACHE_VERSION?.trim();
  if (fromEnv) {
    return fromEnv.startsWith("v") ? fromEnv : `v-${fromEnv}`;
  }

  const sha = (process.env.GITHUB_SHA || "").trim();
  if (sha) return `v-${sha.slice(0, 7)}`;

  try {
    const short = execSync("git rev-parse --short HEAD", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (short) return `v-${short}`;
  } catch {
    // Fall through.
  }
  return `v-${Date.now().toString(36)}`;
}

/** Mirrors `lib/pwa/stampDemoSw.ts` — keep the regex identical. */
function stampDemoSwSource(source, version) {
  if (!/const CACHE_VERSION = "[^"]*";/.test(source)) {
    throw new Error("CACHE_VERSION declaration not found in service worker source");
  }
  return source.replace(/const CACHE_VERSION = "[^"]*";/, `const CACHE_VERSION = "${version}";`);
}

function stampDemoSwFile(targetPath, version = resolveVersion()) {
  if (!existsSync(targetPath)) {
    return { skipped: true, version, targetPath };
  }
  const before = readFileSync(targetPath, "utf8");
  const after = stampDemoSwSource(before, version);
  if (before !== after) writeFileSync(targetPath, after);
  return { skipped: false, version, targetPath, changed: before !== after };
}

function main() {
  const target = path.resolve(root, process.argv[2] ?? "dist/client/sw.js");
  const result = stampDemoSwFile(target);
  if (result.skipped) {
    console.log(`[stamp-demo-sw] skip — ${path.relative(root, target)} not found`);
    return;
  }
  console.log(
    `[stamp-demo-sw] ${path.relative(root, target)} → CACHE_VERSION=${result.version}` +
      (result.changed ? "" : " (unchanged)"),
  );
}

main();
