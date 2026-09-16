#!/usr/bin/env node
/**
 * Fails the build when a client JavaScript chunk grows past its committed budget.
 *
 * ## Why chunk budgets rather than route budgets
 *
 * #43 asks for "route-level" budgets. This measures *chunks*, which is the honest unit for this
 * build: `vinext` emits hashed chunks into `dist/client/assets/` and a route's real cost is its
 * entry plus whatever it dynamically imports. The expensive things here are all lazily loaded —
 * `VehicleCanvas` (Three.js), the Draco decoder — so attributing them to one route would either
 * double-count them across every route that can reach the builder, or hide them behind a route
 * that does not load them until interaction. Chunk budgets say the same thing without the
 * arithmetic being a lie: the regression this is meant to catch is "something pulled Three.js into
 * the shared framework chunk", and that shows up here immediately.
 *
 * ## Why gzip
 *
 * Gzipped size is what a user's connection actually pays for; raw byte counts move for reasons
 * (minifier whitespace, identifier length) that do not change download time. Brotli would be closer
 * still to what Cloudflare serves, but gzip is in Node's standard library and the *trend* is what
 * a budget gates, not the absolute transfer size.
 *
 * ## Why names are de-hashed
 *
 * Every filename carries a content hash that changes on every meaningful edit, so budgets are keyed
 * on the stable stem (`VehicleCanvas-CElmJqDH.js` → `VehicleCanvas`). A build that renames a chunk
 * therefore reads as "new chunk, no budget", which is a deliberate failure rather than a silent
 * pass — an unbudgeted chunk is how a budget file quietly stops covering the thing it was written
 * for, exactly as `tests/glbContract.test.ts` argues for unbudgeted GLBs.
 *
 * Usage:
 *   node scripts/bundle-budget.mjs                 # check against scripts/bundle-budgets.json
 *   node scripts/bundle-budget.mjs --add-missing    # budget only chunks that have no entry
 *   node scripts/bundle-budget.mjs --update         # re-baseline every budget from the current build
 *
 * Prefer `--add-missing` when a PR introduces a new chunk. `--update` rewrites *every* budget from
 * current sizes, which quietly raises budgets for chunks that were comfortably passing — folding
 * "adopt a new chunk" into the same diff as "relax two unrelated limits" is the silent absorption
 * this gate exists to prevent. That happened for real: the only way to adopt three tiny chunks added
 * by another PR was to re-baseline the whole file.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const ASSET_DIR = path.join(process.cwd(), "dist", "client", "assets");
const BUDGET_FILE = path.join(process.cwd(), "scripts", "bundle-budgets.json");

/** Headroom applied when writing budgets with `--update`. Enough that an ordinary edit does not
 * trip the gate, tight enough that pulling in a library does. */
const HEADROOM = 1.15;

/**
 * Strips the build's content hash: `VehicleCanvas-CElmJqDH.js` → `VehicleCanvas`.
 *
 * The hash is matched as *exactly* eight characters rather than "eight or more", because the
 * alphabet includes `-` and `_`: a greedy class would eat earlier name segments too, turning
 * `git-compare-CKw3mP18.js` into `git` and quietly merging unrelated chunks under one budget.
 * Hashes here are also legitimately hyphen-bearing (`warehouse-D-bP1EJ3.js`), so the fixed width is
 * what disambiguates them, not the character set.
 */
function chunkName(fileName) {
  return fileName.replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");
}

function measure() {
  if (!existsSync(ASSET_DIR)) {
    console.error(`No build output at ${ASSET_DIR}. Run \`npm run build\` first.`);
    process.exit(2);
  }
  const sizes = new Map();
  for (const file of readdirSync(ASSET_DIR)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(ASSET_DIR, file);
    if (!statSync(full).isFile()) continue;
    const name = chunkName(file);
    const gzip = gzipSync(readFileSync(full)).length;
    // Several chunks legitimately share a stem: the build emits one `page` chunk per route and more
    // than one Draco wrapper, with no manifest mapping them back to routes. They are summed, so the
    // `page` entry is a budget on total route-entry JS rather than on any single route. #43 asked
    // for per-route budgets; this is the closest honest approximation from what the build emits,
    // and it still fails when any one route's entry grows.
    sizes.set(name, (sizes.get(name) ?? 0) + gzip);
  }
  return sizes;
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const sizes = measure();

const budgetFor = (gzip) => Math.ceil((gzip * HEADROOM) / 1024) * 1024;
const writeBudgets = (budgets) => {
  const sorted = Object.fromEntries(Object.keys(budgets).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((k) => [k, budgets[k]]));
  writeFileSync(BUDGET_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
};

if (process.argv.includes("--update")) {
  const budgets = Object.fromEntries([...sizes.entries()].map(([name, gzip]) => [name, budgetFor(gzip)]));
  writeBudgets(budgets);
  console.log(`Re-baselined ${Object.keys(budgets).length} budgets in ${path.relative(process.cwd(), BUDGET_FILE)} (+${Math.round((HEADROOM - 1) * 100)}% headroom).`);
  process.exit(0);
}

if (process.argv.includes("--add-missing")) {
  const budgets = existsSync(BUDGET_FILE) ? JSON.parse(readFileSync(BUDGET_FILE, "utf8")) : {};
  const added = [];
  for (const [name, gzip] of sizes) {
    if (budgets[name] !== undefined) continue;
    budgets[name] = budgetFor(gzip);
    added.push(`${name} (${kib(gzip)} → ${kib(budgets[name])})`);
  }
  if (added.length === 0) {
    console.log("Every chunk already has a budget; nothing to add.");
    process.exit(0);
  }
  writeBudgets(budgets);
  console.log(`Added ${added.length} budget(s), leaving existing entries untouched:\n  ${added.join("\n  ")}`);
  process.exit(0);
}

if (!existsSync(BUDGET_FILE)) {
  console.error(`No budget file at ${BUDGET_FILE}. Create one with \`node scripts/bundle-budget.mjs --update\`.`);
  process.exit(2);
}

const budgets = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
const over = [];
const unbudgeted = [];

for (const [name, gzip] of [...sizes.entries()].sort(([, a], [, b]) => b - a)) {
  const budget = budgets[name];
  if (budget === undefined) unbudgeted.push({ name, gzip });
  else if (gzip > budget) over.push({ name, gzip, budget });
}

console.log("Client chunk sizes (gzipped):");
for (const [name, gzip] of [...sizes.entries()].sort(([, a], [, b]) => b - a)) {
  const budget = budgets[name];
  const marker = budget === undefined ? "  NEW" : gzip > budget ? " OVER" : "     ";
  console.log(`${marker}  ${kib(gzip).padStart(10)}${budget === undefined ? "" : ` / ${kib(budget)}`}  ${name}`);
}

if (over.length === 0 && unbudgeted.length === 0) {
  console.log(`\nAll ${sizes.size} chunks within budget.`);
  process.exit(0);
}

console.error("");
for (const { name, gzip, budget } of over) {
  console.error(`FAIL  ${name} is ${kib(gzip)} gzipped, over its ${kib(budget)} budget by ${kib(gzip - budget)}.`);
}
for (const { name, gzip } of unbudgeted) {
  console.error(`FAIL  ${name} (${kib(gzip)} gzipped) has no budget entry.`);
}
console.error(
  unbudgeted.length > 0
    ? "\nFor a newly added chunk, run `npm run bundle:budget:add-missing` — it budgets only the\n" +
        "chunks that have no entry and leaves every existing budget alone.\n" +
        "If an existing chunk grew intentionally, use `npm run bundle:budget:update` and commit the\n" +
        "change so the increase is reviewed as a deliberate diff rather than absorbed silently."
    : "\nIf the growth is intentional, run `npm run bundle:budget:update` and commit the change so\n" +
        "the increase is reviewed as a deliberate diff rather than absorbed silently.",
);
process.exit(1);
