/**
 * Performance budget for the GitHub Pages builder (`/toyota-showroom/4runner/`).
 *
 * 1. Gzip size of the initial (modulepreload + sync) JS/CSS referenced by the
 *    builder HTML in dist/client — fails a huge unused sync script with a
 *    readable table, even if Lighthouse is noisy. Lazy 3D (VehicleCanvas) is
 *    not in the initial preload set and is not counted here.
 * 2. One Lighthouse performance run (desktop) asserting LCP + TBT.
 *
 * Complements chunk gzip budgets (`npm run bundle:budget`, #43); does not replace them.
 *
 * Usage (after `npm run build`):
 *   npm run test:perf
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import * as chromeLauncher from "chrome-launcher";
import lighthouse, { desktopConfig } from "lighthouse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist", "client");
const BUDGET_PATH = join(ROOT, "lighthouse-budget.json");
const REPORT_PATH = join(ROOT, "lighthouse-report.json");
const HUGE_SYNC_JS_GZIP = 500 * 1024;

function loadBudget() {
  return JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
}

function fmtKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function padStart(value, width) {
  return String(value).padStart(width);
}

/** Collect unique asset hrefs from the builder HTML (modulepreload + sync scripts + CSS). */
function parseEntryAssets(html) {
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

  const cssHrefs = new Set();
  for (const match of html.matchAll(/rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)) {
    cssHrefs.add(match[1]);
  }
  for (const match of html.matchAll(/href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/gi)) {
    cssHrefs.add(match[1]);
  }

  if (jsHrefs.size === 0) {
    throw new Error(
      "Could not find entry JS (modulepreload/script) in builder HTML. Did the vinext build change?",
    );
  }
  if (cssHrefs.size === 0) {
    throw new Error(
      "Could not find entry CSS in builder HTML. Did the vinext build change?",
    );
  }

  return {
    jsHrefs: [...jsHrefs],
    cssHrefs: [...cssHrefs],
  };
}

function hrefToDistFile(href) {
  const marker = "/assets/";
  const idx = href.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Unexpected asset href (no /assets/): ${href}`);
  }
  return join(DIST, "assets", href.slice(idx + marker.length));
}

function gzipSize(filePath) {
  return gzipSync(readFileSync(filePath)).length;
}

function measureEntryAssets(budget) {
  const htmlPath = join(DIST, budget.htmlRelativePath || "4runner/index.html");
  if (!existsSync(htmlPath)) {
    throw new Error(
      `Missing ${htmlPath}. Run \`npm run build\` first.`,
    );
  }
  const parsed = parseEntryAssets(readFileSync(htmlPath, "utf8"));
  let entryJsGzip = 0;
  let entryCssGzip = 0;
  const jsFiles = [];
  const cssFiles = [];

  for (const href of parsed.jsHrefs) {
    const filePath = hrefToDistFile(href);
    if (!existsSync(filePath)) {
      throw new Error(`Entry JS missing: ${filePath}`);
    }
    const gz = gzipSize(filePath);
    entryJsGzip += gz;
    jsFiles.push({ file: href.replace(/^.*assets\//, ""), gzip: gz });
  }
  for (const href of parsed.cssHrefs) {
    const filePath = hrefToDistFile(href);
    if (!existsSync(filePath)) {
      throw new Error(`Entry CSS missing: ${filePath}`);
    }
    const gz = gzipSize(filePath);
    entryCssGzip += gz;
    cssFiles.push({ file: href.replace(/^.*assets\//, ""), gzip: gz });
  }

  return { entryJsGzip, entryCssGzip, jsFiles, cssFiles };
}

function evaluateAssets(measured, budget) {
  return [
    {
      name: "entry JS gzip",
      actual: measured.entryJsGzip,
      limit: budget.assets.entryJsGzipBytes,
      unit: "bytes",
      detail: `${measured.jsFiles?.length ?? "?"} modules`,
    },
    {
      name: "entry CSS gzip",
      actual: measured.entryCssGzip,
      limit: budget.assets.entryCssGzipBytes,
      unit: "bytes",
      detail: `${measured.cssFiles?.length ?? "?"} sheets`,
    },
  ].map((row) => ({ ...row, ok: row.actual <= row.limit }));
}

function evaluateLighthouse(lhr, budget) {
  const lcp = lhr.audits["largest-contentful-paint"]?.numericValue;
  const tbt = lhr.audits["total-blocking-time"]?.numericValue;
  if (typeof lcp !== "number" || typeof tbt !== "number") {
    throw new Error("Lighthouse report missing LCP or TBT numericValue.");
  }
  return [
    {
      name: "LCP",
      actual: lcp,
      limit: budget.lighthouse.lcpMs,
      unit: "ms",
      detail: lhr.audits["largest-contentful-paint"]?.displayValue ?? "",
    },
    {
      name: "TBT",
      actual: tbt,
      limit: budget.lighthouse.tbtMs,
      unit: "ms",
      detail: lhr.audits["total-blocking-time"]?.displayValue ?? "",
    },
  ].map((row) => ({ ...row, ok: row.actual <= row.limit }));
}

function printTable(title, rows, formatActual) {
  console.log(`\n${title}`);
  const nameW = Math.max(16, ...rows.map((r) => r.name.length));
  for (const row of rows) {
    const status = row.ok ? "PASS" : "FAIL";
    const extra = row.detail ? `  ${row.detail}` : "";
    console.log(
      `  ${pad(row.name, nameW)}  ${padStart(formatActual(row), 12)}  / ${padStart(formatActual({ ...row, actual: row.limit }), 10)}  ${status}${extra}`,
    );
  }
}

async function isReady(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isReady(url)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Preview did not become ready: ${url}`);
}

function stopPreview(child) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // already gone
  }
}

async function ensurePreview(budget) {
  const url = `http://${budget.previewHost}:${budget.previewPort}${budget.urlPath}`;
  if (await isReady(url)) {
    return { url, child: null };
  }
  const child = spawn(
    process.execPath,
    [join(ROOT, "scripts", "preview-server.mjs")],
    {
      cwd: ROOT,
      stdio: "ignore",
      env: {
        ...process.env,
        PORT: String(budget.previewPort),
      },
    },
  );
  try {
    await waitForUrl(url);
  } catch (error) {
    stopPreview(child);
    throw error;
  }
  return { url, child };
}

async function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.LIGHTHOUSE_CHROMIUM_PATH) {
    return process.env.LIGHTHOUSE_CHROMIUM_PATH;
  }
  const sandboxChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  if (existsSync(sandboxChromium)) return sandboxChromium;
  try {
    const { chromium } = await import("@playwright/test");
    const path = chromium.executablePath();
    if (path && existsSync(path)) return path;
  } catch {
    // chrome-launcher will search the usual Chrome install locations
  }
  return undefined;
}

async function runLighthouse(url, budget) {
  const chromePath = await resolveChromePath();
  const chrome = await chromeLauncher.launch({
    ...(chromePath ? { chromePath } : {}),
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    // Block lazy 3D / GLB so LCP+TBT measure the builder *shell* (HTML, framework,
    // BuilderApp). Full WebGPU/GLB under headless software GL produces multi-tens-of-
    // seconds of main-thread "Other" work that is not a useful CI signal and would
    // force absurd TBT budgets. Entry JS gzip still covers a huge sync script; TBT
    // catches a multi-second block in the shell. Same spirit as lexus-showroom #19
    // (3D stays out of the initial budget).
    const blocked = budget.lighthouse?.blockedUrlPatterns ?? [
      "*VehicleCanvas*",
      "*.glb",
      "*draco*",
    ];
    const config = {
      ...desktopConfig,
      settings: {
        ...desktopConfig.settings,
        onlyCategories: ["performance"],
        blockedUrlPatterns: blocked,
      },
    };
    const result = await lighthouse(
      url,
      {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"],
      },
      config,
    );
    if (!result?.lhr) {
      throw new Error("Lighthouse returned no lhr.");
    }
    return result.lhr;
  } finally {
    await chrome.kill();
  }
}

function printReadableReport({ url, assetRows, lhRows, lhr }) {
  console.log(`\nPerformance budget — ${url}`);
  printTable("Asset sizes (gzip of initial / non-lazy files)", assetRows, (r) =>
    fmtKb(r.actual),
  );
  printTable("Lighthouse (desktop, performance)", lhRows, (r) =>
    `${Math.round(r.actual)} ms`,
  );
  const score = lhr.categories?.performance?.score;
  if (typeof score === "number") {
    console.log(`  performance score          ${(score * 100).toFixed(0)}`);
  }
}

function proveHugeSyncScriptFails(budget) {
  const fake = {
    jsFiles: [{ file: "index-HUGE-SYNC.js", gzip: HUGE_SYNC_JS_GZIP }],
    cssFiles: [{ file: "index.css", gzip: 6 * 1024 }],
    entryJsGzip: HUGE_SYNC_JS_GZIP,
    entryCssGzip: 6 * 1024,
  };
  const rows = evaluateAssets(fake, budget);
  const jsRow = rows.find((row) => row.name === "entry JS gzip");
  if (!jsRow || jsRow.ok) {
    throw new Error(
      "Regression proof failed: a 500 KB gzip sync script should exceed the entry JS budget.",
    );
  }
  // Acceptance (#79): a PR that blocks the main thread for seconds must fail CI.
  const blockingMs = 5_000;
  const tbtRows = evaluateLighthouse(
    {
      audits: {
        "largest-contentful-paint": { numericValue: 1_000, displayValue: "1.0 s" },
        "total-blocking-time": {
          numericValue: blockingMs,
          displayValue: `${blockingMs} ms`,
        },
      },
    },
    budget,
  );
  const tbtRow = tbtRows.find((row) => row.name === "TBT");
  if (!tbtRow || tbtRow.ok) {
    throw new Error(
      `Regression proof failed: a ${blockingMs} ms main-thread block should exceed the TBT budget.`,
    );
  }
  console.log("\nRegression proof (not served)");
  console.log(
    `  huge unused sync JS   ${fmtKb(HUGE_SYNC_JS_GZIP)}  / ${fmtKb(budget.assets.entryJsGzipBytes)}  FAIL (expected)  ${fake.jsFiles[0].file}`,
  );
  console.log(
    `  multi-second TBT      ${blockingMs} ms  / ${budget.lighthouse.tbtMs} ms  FAIL (expected)`,
  );
}

async function main() {
  const budget = loadBudget();
  const measured = measureEntryAssets(budget);
  const { url, child } = await ensurePreview(budget);
  let failed = false;
  try {
    const lhr = await runLighthouse(url, budget);
    writeFileSync(REPORT_PATH, JSON.stringify(lhr, null, 2));
    const assetRows = evaluateAssets(measured, budget);
    const lhRows = evaluateLighthouse(lhr, budget);
    printReadableReport({ url, assetRows, lhRows, lhr });
    proveHugeSyncScriptFails(budget);

    const failedRows = [...assetRows, ...lhRows].filter((row) => !row.ok);
    if (failedRows.length) {
      failed = true;
      console.error(
        `\nFAIL — ${failedRows.length} budget${failedRows.length === 1 ? "" : "s"} exceeded.`,
      );
      console.error(
        "A large unused sync script in the initial bundle fails the entry JS gzip budget;",
      );
      console.error(
        "a multi-second main-thread block fails TBT. See lighthouse-budget.json and README.",
      );
      console.error(`Full Lighthouse JSON: ${REPORT_PATH}`);
    } else {
      console.log("\nOK — all budgets met.");
      console.log(`Lighthouse JSON: ${REPORT_PATH}`);
    }
  } finally {
    stopPreview(child);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
