import { expect, test } from "@playwright/test";

/**
 * Pixel-diff regression against the static export (`playwright.config.ts`'s `webServer` serves
 * `dist/client`, real production output — not a dev build with different CSS/bundling behavior).
 *
 * Scope is deliberately DOM/CSS pages only. `/[slug]` (the builder) renders a live WebGPU/WebGL
 * Three.js scene: camera float precision, GPU vs. software rasterization, and antialiasing differ
 * enough between machines that a true pixel-diff of the canvas itself would be flaky by
 * construction, not a real regression signal — the "Builder chrome" test below screenshots that
 * page but masks the canvas out, covering the UI chrome around it without that risk.
 *
 * `maxDiffPixelRatio` is intentionally non-zero: even on the same OS (this suite runs on
 * Ubuntu 24.04 both here and in CI), a different Chromium *build* can hint fonts a few pixels
 * differently. Zero-tolerance diffing would make this suite flaky for reasons that have nothing
 * to do with an actual visual regression.
 */
const SCREENSHOT_OPTIONS = { maxDiffPixelRatio: 0.02, animations: "disabled" as const };

test("explore lineup renders consistently", async ({ page }) => {
  await page.goto("explore/");
  await page.waitForSelector(".vehicle-card");
  await expect(page).toHaveScreenshot("explore.png", { fullPage: true, ...SCREENSHOT_OPTIONS });
});

test("compare table renders consistently", async ({ page }) => {
  await page.goto("compare/?vehicles=4runner,tacoma,camry");
  await page.waitForSelector(".compare-table");
  await expect(page).toHaveScreenshot("compare.png", { fullPage: true, ...SCREENSHOT_OPTIONS });
});

test("builder chrome renders consistently (3D canvas masked out)", async ({ page }) => {
  await page.goto("4runner/");
  await page.waitForSelector(".vehicle-title h1");
  await expect(page).toHaveScreenshot("builder-chrome.png", {
    ...SCREENSHOT_OPTIONS,
    mask: [page.locator(".vehicle-canvas")],
  });
});
