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
  // Waited for explicitly, not just implied by the screenshot above completing: the optional
  // wheel/tyre glTF replacement (VehicleCanvas.tsx's installWheelAndTireAssets, Draco-decoded) is
  // still in flight after the title renders, and a network failure surfaces as a `pageerror` on
  // its own timeline — asserting immediately after the screenshot raced that and missed it once
  // for real, while proving the Draco-decoder-vendoring fix (docs/INTEGRATION_GUIDE.md §13).
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("paint studio OEM preset chrome renders consistently", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("4runner/");
  await page.waitForSelector("[data-testid='paint-studio']");
  await page.waitForSelector("[data-testid='oem-paint-swatches'] button");
  // Select the Blueprint OEM paint swatch (first swatch) for a stable preset.
  const swatches = page.locator("[data-testid='oem-paint-swatches'] button");
  await swatches.first().click();
  await expect(page.locator("[data-testid='paint-mode-oem']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-testid='paint-hdri-presets'] button").first()).toBeVisible();
  await expect(page).toHaveScreenshot("paint-studio-oem.png", {
    ...SCREENSHOT_OPTIONS,
    mask: [page.locator(".vehicle-canvas")],
  });
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
