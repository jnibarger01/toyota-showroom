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
  reporter: [["list"], ["html", { open: "never" }]],
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
