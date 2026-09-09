import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
// Trailing slash matters: relative navigations in tests/e2e/*.spec.ts (e.g. `page.goto("explore/")`)
// resolve against this per WHATWG URL rules — without it, "toyota-showroom" is treated as a file
// segment and dropped rather than kept as a directory prefix.
const BASE_URL = `http://127.0.0.1:${PORT}/toyota-showroom/`;

/**
 * Some sandboxed dev environments pre-install a Chromium build under a fixed path
 * (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) at a browser revision that doesn't match whatever
 * `@playwright/test`'s currently-installed version expects, so Playwright's own version-keyed
 * auto-resolution fails there with "Executable doesn't exist" — pointing `executablePath` at the
 * real, already-present binary sidesteps that mismatch instead of trying to download a browser
 * such an environment may have no route to fetch anyway. Real CI (`.github/workflows/e2e.yml`)
 * has no such path; `npx playwright install --with-deps chromium` there gives Playwright a browser
 * matching its own resolution, so this override only applies where the fixed path actually exists.
 */
const sandboxChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial everywhere, including locally.
  //
  // GitHub Actions' standard ubuntu-latest runners are 2-core; tests/e2e/build-and-restore.spec.ts
  // loads a real ~57 MiB GLB per test (already run serially within that file — see its own
  // `test.describe.configure`), and two of those loading at once from separate spec files was
  // enough contention to make one time out for reasons that had nothing to do with the app.
  //
  // This previously read `process.env.CI ? 1 : undefined`, on the assumption that local machines
  // had headroom to spare. They do not. Several of these specs render a real Three.js scene through
  // a *software* rasteriser, so two of them at once starve the renderer's input pipeline: with two
  // workers, `partInteraction.spec.ts`'s orbit-drag test fails reliably with `mouse.move` timing
  // out after 60s — the browser is not processing input at all — and passes in isolation. Verified
  // to reproduce on an unmodified tree, so it is a property of the harness, not of any change.
  //
  // A gate that fails locally for reasons CI never sees trains contributors to distrust it, which
  // is worse than the ~1 minute serialising costs. Local now reproduces CI exactly, which is the
  // point of having a browser gate at all.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  // tests/e2e/build-and-restore.spec.ts loads a real ~57 MiB GLB before its catalog buttons exist
  // at all — the default 5s per-assertion timeout is tuned for DOM-only pages, not a full
  // Three.js scene load, and is too tight for that test on a loaded CI runner.
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    launchOptions: {
      ...(existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {}),
      args: ["--no-sandbox"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node scripts/preview-server.mjs`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    timeout: 30_000,
  },
});
