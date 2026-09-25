import { expect, test, type Page } from "@playwright/test";

/**
 * Pixel regression for the 3D scene itself — the one surface `visual.spec.ts` deliberately masks.
 *
 * That file's header explains why canvas pixels were left out: GPU vs. software rasterisation and
 * float precision differ between *machines*. Both are pinned here instead of avoided. CI and the
 * snapshot-refresh workflow run the same Playwright Chromium on the same `ubuntu-latest` image, which
 * rasterises WebGL through SwiftShader on the CPU — deterministic for a fixed build. What remains
 * variable is timing, and every source of it is removed explicitly:
 *
 * - `reducedMotion: "reduce"` (via `contextOptions`) makes every camera/lift tween land instantly (motionPreference.ts).
 * - The quality tier is pinned through the viewer's stored preference, so the governor cannot move
 *   it mid-test and the device-hint guess cannot differ between runners.
 * - The shot waits for the detailed model (`data-load-phase=ready`) *and* the HDRI environment
 *   (`data-environment`), which lands asynchronously after it, then for two painted frames.
 * - Chrome overlaid on the stage is hidden so only rendered pixels are compared.
 *
 * This is the guard for anything that changes what the vehicle looks like — tone mapping, paint
 * finishes, environment maps, the floor reflection. Refresh baselines only through the documented
 * `update-snapshots` workflow (CONTRIBUTING.md), and read the diff first.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });
test.use({ viewport: { width: 1280, height: 800 }, contextOptions: { reducedMotion: "reduce" } });

const SCREENSHOT_OPTIONS = {
  // Looser than the DOM suite's 0.02: antialiased silhouette edges are where a rasteriser build
  // difference shows first, and they are not what this suite exists to catch.
  maxDiffPixelRatio: 0.03,
  threshold: 0.25,
  animations: "disabled" as const,
  // SwiftShader draws this scene at roughly one frame per second (it is vertex-bound: the 4Runner is
  // ~330k triangles before shadows and the reflection), a capture waits on several frames, and
  // `toHaveScreenshot` needs two consecutive identical captures before it trusts one.
  timeout: 120_000,
};

async function openSettled(page: Page, slug: string, quality: "high" | "medium" | "low") {
  await page.addInitScript((tier) => {
    localStorage.setItem("toyota-showroom:quality", tier);
    // The first-visit onboarding tip overlaps the stage; it is chrome, not scene.
    localStorage.setItem("toyota-showroom:tour-seen", "1");
  }, quality);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${slug}/`);
  const canvas = page.locator(".vehicle-canvas canvas");
  await expect.poll(() => canvas.getAttribute("data-load-phase"), { timeout: 90_000 }).toBe("ready");
  await expect.poll(() => canvas.getAttribute("data-environment"), { timeout: 30_000 }).not.toBeNull();
  await page.addStyleTag({
    content:
      ".stage > :not(.vehicle-canvas), [aria-label='3D viewer controls'], [role=dialog] { visibility: hidden !important; }",
  });
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  return { canvas, errors };
}

test("4Runner hero on the high tier (floor reflection, studio HDRI, neutral tone mapping)", async ({ page }) => {
  const { errors } = await openSettled(page, "4runner", "high");
  await expect(page.locator(".vehicle-canvas")).toHaveScreenshot("3d-4runner-high.png", SCREENSHOT_OPTIONS);
  expect(errors).toEqual([]);
});

test("4Runner in a metallic paint (flake finish) on the medium tier", async ({ page }) => {
  const { errors } = await openSettled(page, "4runner", "medium");
  await page.getByRole("button", { name: "Barcelona Red Metallic" }).first().click();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.locator(".vehicle-canvas")).toHaveScreenshot("3d-4runner-red-metallic.png", SCREENSHOT_OPTIONS);
  expect(errors).toEqual([]);
});

test("4Runner on the low tier renders the LOD", async ({ page }) => {
  const { errors } = await openSettled(page, "4runner", "low");
  await expect(page.locator(".vehicle-canvas")).toHaveScreenshot("3d-4runner-low-lod.png", SCREENSHOT_OPTIONS);
  expect(errors).toEqual([]);
});

// The RAV4 rather than a heavier body: at ~0.5 MiB it is the cheapest real asset to rasterise in
// software, and this test is about the environment map, not the mesh.
test("RAV4 under the Golden Hour HDRI", async ({ page }) => {
  const { errors } = await openSettled(page, "rav4", "medium");
  await page.getByRole("button", { name: /Golden Hour/ }).first().click();
  const canvas = page.locator(".vehicle-canvas canvas");
  await expect.poll(() => canvas.getAttribute("data-environment"), { timeout: 30_000 }).toBe("hdri-sunset");
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.locator(".vehicle-canvas")).toHaveScreenshot("3d-rav4-golden-hour.png", SCREENSHOT_OPTIONS);
  expect(errors).toEqual([]);
});
