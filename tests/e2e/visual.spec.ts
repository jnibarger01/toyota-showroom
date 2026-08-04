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

/**
 * Collects uncaught page errors (thrown exceptions, React hydration mismatches surfaced as
 * `Minified React error #418`) so each test below can assert none occurred — a screenshot
 * comparison alone would miss this class of bug entirely, since React recovers from a hydration
 * mismatch by re-rendering client-side and the *final* pixels look correct either way. Found this
 * exact gap for real: `/compare/?vehicles=...` threw #418 on every load until fixed (see
 * docs/INTEGRATION_GUIDE.md §13), invisible to this file's screenshot assertion the whole time.
 */
function collectPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("explore lineup renders consistently", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("explore/");
  await page.waitForSelector(".vehicle-card");
  await expect(page).toHaveScreenshot("explore.png", { fullPage: true, ...SCREENSHOT_OPTIONS });
  expect(errors).toEqual([]);
});

test("compare table renders consistently", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("compare/?vehicles=4runner,tacoma,camry");
  await page.waitForSelector(".compare-table");
  await expect(page).toHaveScreenshot("compare.png", { fullPage: true, ...SCREENSHOT_OPTIONS });
  expect(errors).toEqual([]);
});

test("builder chrome renders consistently (3D canvas masked out)", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("4runner/");
  await page.waitForSelector(".vehicle-title h1");
  await expect(page).toHaveScreenshot("builder-chrome.png", {
    ...SCREENSHOT_OPTIONS,
    mask: [page.locator(".vehicle-canvas")],
  });
  // Not asserted empty here, unlike the other two: the vendored Draco decoder still falls through
  // to an external CDN blocked by this app's CSP (§13's "Vendored Draco/Basis decoders" gap),
  // which surfaces as a page error on this specific page. Asserted narrowly instead, so a
  // *different* page error still fails this test.
  expect(errors.filter((message) => !message.includes("Failed to fetch"))).toEqual([]);
});
