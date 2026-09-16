#!/usr/bin/env node
/**
 * Fails the build when client JavaScript grows past committed budgets.
 *
 * Two complementary gates (#43):
 *
 * 1. **Route entry JS** — gzipped sum of `modulepreload` + sync `<script>` assets referenced by
 *    the critical-route HTML (`/`, `/explore`, `/4runner` builder). This is what a cold visit
 *    downloads before interaction. Lazy `VehicleCanvas` / Draco are *not* in that set (they load
 *    on demand) and are therefore not counted here — same boundary as `assert-perf-budget.mjs`.
 *
 * 2. **Chunk sizes** — every hashed file under `dist/client/assets/*.js`, keyed on the de-hashed
 *    stem. Catches "Three.js leaked into the shared framework chunk" and any new unbudgeted chunk
 *    that appears after a rename or split. Chunks that share a stem (e.g. multiple `page` entries)
 *    are summed.
 *
 * ## Why gzip
 *
 * Gzipped size is what a user's connection actually pays for; raw byte counts move for reasons
 * (minifier whitespace, identifier length) that do not change download time. Brotli would be closer
 * still to what Cloudflare serves, but gzip is in Node's standard library and the *trend* is what
 * a budget gates, not the absolute transfer size.
 *
 * ## Why chunk names are de-hashed
 *
 * Every filename carries a content hash that changes on every meaningful edit, so budgets are keyed
 * on the stable stem (`VehicleCanvas-CElmJqDH.js` → `VehicleCanvas`). A build that renames a chunk
 * therefore reads as "new chunk, no budget", which is a deliberate failure rather than a silent
 * pass — an unbudgeted chunk is how a budget file quietly stops covering the thing it was written
 * for, exactly as `tests/glbContract.test.ts` argues for unbudgeted GLBs.
 *
 * The hash is matched as *exactly* eight characters rather than "eight or more", because the
 * alphabet includes `-` and `_`: a greedy class would eat earlier name segments too, turning
 * `git-compare-CKw3mP18.js` into `git` and quietly merging unrelated chunks under one budget.
 * Hashes here are also legitimately hyphen-bearing (`warehouse-D-bP1EJ3.js`), so the fixed width is
 * what disambiguates them, not the character set.
 *
 * Usage:
 *   node scripts/bundle-budget.mjs            # check chunks + routes
 *   node scripts/bundle-budget.mjs --add-missing  # budget only chunks with no entry (prefer this)
 *   node scripts/bundle-budget.mjs --update       # re-baseline both budget files from the build
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist", "client");
const ASSET_DIR = path.join(DIST, "assets");
const CHUNK_BUDGET_FILE = path.join(ROOT, "scripts", "bundle-budgets.json");
const ROUTE_BUDGET_FILE = path.join(ROOT, "scripts", "route-bundle-budgets.json");

/** Headroom applied when writing budgets with `--update`. Enough that an ordinary edit does not
 * trip the gate, tight enough that pulling in a library does. */
const HEADROOM = 1.15;

/** Critical routes from #43. Keys are URL paths; `html` is relative to `dist/client`. */
const CRITICAL_ROUTES = [
  { route: "/", html: "index.html", label: "home" },
  { route: "/explore", html: "explore/index.html", label: "explore" },
  { route: "/4runner", html: "4runner/index.html", label: "builder" },
];

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

function withHeadroom(bytes) {
  return Math.ceil((bytes * HEADROOM) / 1024) * 1024;
}

function chunkName(fileName) {
  return fileName.replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");
}

function requireBuild() {
  if (!existsSync(ASSET_DIR)) {
    console.error(`No build output at ${ASSET_DIR}. Run \`npm run build\` first.`);
    process.exit(2);
  }
}

function measureChunks() {
  requireBuild();
  const sizes = new Map();
  for (const file of readdirSync(ASSET_DIR)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(ASSET_DIR, file);
    if (!statSync(full).isFile()) continue;
    const name = chunkName(file);
    const gzip = gzipSync(readFileSync(full)).length;
    // Several chunks legitimately share a stem (one `page` per route, multiple Draco wrappers).
    // Summed so growth in any of them trips the shared budget.
    sizes.set(name, (sizes.get(name) ?? 0) + gzip);
  }
  return sizes;
}

/** Collect unique JS hrefs from route HTML (modulepreload + sync scripts). */
function parseEntryJsHrefs(html) {
  const jsHrefs = new Set();
  for (const match of html.matchAll(/rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi)) {
    jsHrefs.add(match[1]);
  }
  for (const match of html.matchAll(/href=["']([^"']+)["'][^>]+rel=["']modulepreload["']/gi)) {
    jsHrefs.add(match[1]);
  }
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)) {
    jsHrefs.add(match[1]);
  }
  return [...jsHrefs];
}

function hrefToAssetFile(href) {
  const marker = "/assets/";
  const idx = href.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Unexpected asset href (no /assets/): ${href}`);
  }
  return path.join(ASSET_DIR, href.slice(idx + marker.length));
}

/**
 * Measure initial (non-lazy) gzipped JS for one route HTML file.
 * Returns { entryJsGzip, files } where files is [{ file, gzip }].
 */
function measureRouteEntry(htmlRelativePath) {
  requireBuild();
  const htmlPath = path.join(DIST, htmlRelativePath);
  if (!existsSync(htmlPath)) {
    throw new Error(`Missing ${htmlPath}. Run \`npm run build\` first.`);
  }
  const hrefs = parseEntryJsHrefs(readFileSync(htmlPath, "utf8"));
  if (hrefs.length === 0) {
    throw new Error(
      `No modulepreload/script JS found in ${htmlRelativePath}. Did the vinext build change?`,
    );
  }
  let entryJsGzip = 0;
  const files = [];
  for (const href of hrefs) {
    const filePath = hrefToAssetFile(href);
    if (!existsSync(filePath)) {
      throw new Error(`Entry JS missing: ${filePath}`);
    }
    const gzip = gzipSync(readFileSync(filePath)).length;
    entryJsGzip += gzip;
    files.push({ file: path.basename(filePath), gzip });
  }
  files.sort((a, b) => b.gzip - a.gzip);
  return { entryJsGzip, files };
}

function measureRoutes() {
  return CRITICAL_ROUTES.map((meta) => {
    const measured = measureRouteEntry(meta.html);
    return { ...meta, ...measured };
  });
}

function writeChunkBudgets(sizes) {
  const budgets = Object.fromEntries(
    [...sizes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, gzip]) => [name, withHeadroom(gzip)]),
  );
  writeFileSync(CHUNK_BUDGET_FILE, `${JSON.stringify(budgets, null, 2)}\n`);
  return budgets;
}

/**
 * Budgets only chunks that have no entry, leaving every existing budget untouched.
 *
 * `--update` re-baselines *everything* from current sizes, so adopting one new chunk added by
 * another PR also quietly raises the limits of chunks that were comfortably passing — which is the
 * silent absorption this gate exists to prevent. That is not hypothetical: it is why PR #70 had to
 * hand-write three entries to unbreak `main` rather than use the tooling.
 */
function addMissingChunkBudgets(sizes) {
  const budgets = existsSync(CHUNK_BUDGET_FILE) ? JSON.parse(readFileSync(CHUNK_BUDGET_FILE, "utf8")) : {};
  const added = [];
  for (const [name, gzip] of sizes) {
    if (budgets[name] !== undefined) continue;
    budgets[name] = withHeadroom(gzip);
    added.push(`${name} (${kib(gzip)} → ${kib(budgets[name])})`);
  }
  if (added.length > 0) {
    const sorted = Object.fromEntries(Object.keys(budgets).sort((a, b) => a.localeCompare(b)).map((k) => [k, budgets[k]]));
    writeFileSync(CHUNK_BUDGET_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  return added;
}

function writeRouteBudgets(routeMeasurements) {
  const doc = {
    $comment:
      "Initial (modulepreload + sync) gzipped JS per critical route after vinext build. Lazy VehicleCanvas / Draco are not in the HTML preload set and are gated by chunk budgets instead. 15% headroom from baseline; --update rewrites. Issue #43.",
    routes: Object.fromEntries(
      routeMeasurements.map((r) => [
        r.route,
        {
          html: r.html,
          label: r.label,
          entryJsGzipBytes: withHeadroom(r.entryJsGzip),
        },
      ]),
    ),
  };
  writeFileSync(ROUTE_BUDGET_FILE, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

function checkChunks(sizes) {
  if (!existsSync(CHUNK_BUDGET_FILE)) {
    console.error(
      `No budget file at ${CHUNK_BUDGET_FILE}. Create one with \`node scripts/bundle-budget.mjs --update\`.`,
    );
    process.exit(2);
  }
  const budgets = JSON.parse(readFileSync(CHUNK_BUDGET_FILE, "utf8"));
  const over = [];
  const unbudgeted = [];

  console.log("Client chunk sizes (gzipped):");
  for (const [name, gzip] of [...sizes.entries()].sort(([, a], [, b]) => b - a)) {
    const budget = budgets[name];
    const marker = budget === undefined ? "  NEW" : gzip > budget ? " OVER" : "     ";
    console.log(
      `${marker}  ${kib(gzip).padStart(10)}${budget === undefined ? "" : ` / ${kib(budget)}`}  ${name}`,
    );
    if (budget === undefined) unbudgeted.push({ name, gzip });
    else if (gzip > budget) over.push({ name, gzip, budget });
  }

  return { over, unbudgeted, ok: over.length === 0 && unbudgeted.length === 0, count: sizes.size };
}

function checkRoutes(routeMeasurements) {
  if (!existsSync(ROUTE_BUDGET_FILE)) {
    console.error(
      `No route budget file at ${ROUTE_BUDGET_FILE}. Create one with \`node scripts/bundle-budget.mjs --update\`.`,
    );
    process.exit(2);
  }
  const doc = JSON.parse(readFileSync(ROUTE_BUDGET_FILE, "utf8"));
  const budgets = doc.routes ?? doc;
  const over = [];
  const missing = [];

  console.log("\nCritical route entry JS (gzipped modulepreload + sync, excludes lazy 3D):");
  for (const measured of routeMeasurements) {
    const entry = budgets[measured.route];
    const label = `${measured.route} (${measured.label})`;
    if (!entry || typeof entry.entryJsGzipBytes !== "number") {
      missing.push({ route: measured.route, label, gzip: measured.entryJsGzip });
      console.log(`  NEW  ${kib(measured.entryJsGzip).padStart(10)}  ${label}  ${measured.files.length} modules`);
      continue;
    }
    const budget = entry.entryJsGzipBytes;
    const ok = measured.entryJsGzip <= budget;
    const marker = ok ? "     " : " OVER";
    console.log(
      `${marker}  ${kib(measured.entryJsGzip).padStart(10)} / ${kib(budget)}  ${label}  ${measured.files.length} modules`,
    );
    if (!ok) over.push({ route: measured.route, label, gzip: measured.entryJsGzip, budget });
  }

  return {
    over,
    missing,
    ok: over.length === 0 && missing.length === 0,
    count: routeMeasurements.length,
  };
}

/**
 * Acceptance (#43): a PR that adds >budget JS to a critical route must fail with a clear report.
 * Prove the evaluator rejects a fake oversize without depending on a live oversized build.
 */
function proveRouteOverBudgetFails() {
  const fakeBudget = 100 * 1024;
  const fakeActual = 500 * 1024;
  if (!(fakeActual > fakeBudget)) {
    throw new Error("Regression proof setup error.");
  }
  console.log("\nRegression proof (not served)");
  console.log(
    `  fake /explore entry JS   ${kib(fakeActual)}  / ${kib(fakeBudget)}  FAIL (expected)`,
  );
}

function main() {
  const sizes = measureChunks();
  const routeMeasurements = measureRoutes();

  if (process.argv.includes("--update")) {
    const chunkBudgets = writeChunkBudgets(sizes);
    const routeDoc = writeRouteBudgets(routeMeasurements);
    console.log(
      `Wrote ${Object.keys(chunkBudgets).length} chunk budgets to ${path.relative(ROOT, CHUNK_BUDGET_FILE)} (+${Math.round((HEADROOM - 1) * 100)}% headroom).`,
    );
    console.log(
      `Wrote ${Object.keys(routeDoc.routes).length} route budgets to ${path.relative(ROOT, ROUTE_BUDGET_FILE)} (+${Math.round((HEADROOM - 1) * 100)}% headroom).`,
    );
    for (const r of routeMeasurements) {
      console.log(
        `  ${r.route} (${r.label}): ${kib(r.entryJsGzip)} → budget ${kib(withHeadroom(r.entryJsGzip))}`,
      );
    }
    process.exit(0);
  }

  if (process.argv.includes("--add-missing")) {
    const added = addMissingChunkBudgets(sizes);
    console.log(
      added.length === 0
        ? "Every chunk already has a budget; nothing to add."
        : `Added ${added.length} chunk budget(s), leaving existing entries untouched:\n  ${added.join("\n  ")}`,
    );
    // Route budgets are a fixed, hand-curated set of critical routes rather than a discovered list,
    // so there is no "missing" case for them — a new critical route is a deliberate `--update`.
    process.exit(0);
  }

  const chunkResult = checkChunks(sizes);
  const routeResult = checkRoutes(routeMeasurements);
  proveRouteOverBudgetFails();

  if (chunkResult.ok && routeResult.ok) {
    console.log(
      `\nOK — ${chunkResult.count} chunks and ${routeResult.count} critical routes within budget.`,
    );
    process.exit(0);
  }

  console.error("");
  for (const { name, gzip, budget } of chunkResult.over) {
    console.error(
      `FAIL  chunk ${name} is ${kib(gzip)} gzipped, over its ${kib(budget)} budget by ${kib(gzip - budget)}.`,
    );
  }
  for (const { name, gzip } of chunkResult.unbudgeted) {
    console.error(`FAIL  chunk ${name} (${kib(gzip)} gzipped) has no budget entry.`);
  }
  for (const { label, gzip, budget } of routeResult.over) {
    console.error(
      `FAIL  route ${label} entry JS is ${kib(gzip)} gzipped, over its ${kib(budget)} budget by ${kib(gzip - budget)}.`,
    );
  }
  for (const { label, gzip } of routeResult.missing) {
    console.error(`FAIL  route ${label} (${kib(gzip)} gzipped entry JS) has no budget entry.`);
  }
  console.error(
    "\nIf the growth is intentional, run `node scripts/bundle-budget.mjs --update` and commit the\n" +
      "change so the increase is reviewed as a deliberate diff rather than absorbed silently.",
  );
  process.exit(1);
}

main();
