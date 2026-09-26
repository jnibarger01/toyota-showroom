import { expect, test } from "@playwright/test";

/**
 * The compare page's opt-in 3D stage: the stage, the 3D renderer chunk and the models stay off the
 * page until asked for, then the chosen vehicles load side by side and the stage says so.
 *
 * (three.js core itself is not in that list: the catalog's option data imports node-name constants
 * from `lib/three/*` modules, which pulls three.js core into the shared `buildTools` chunk. That
 * predates the stage and is not something this toggle can defer.)
 */
test.describe.configure({ timeout: 180_000 });

test("Compare in 3D loads the chosen vehicles side by side, only on request", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const threeRequests: string[] = [];
  page.on("request", (request) => {
    if (/CompareStage|VehicleCanvas|\.glb$/.test(request.url())) threeRequests.push(request.url());
  });

  await page.goto("compare/?vehicles=camry,rav4-hybrid");
  await page.waitForSelector(".compare-table");
  const toggle = page.getByRole("button", { name: "Compare in 3D" });
  await expect(toggle).toBeVisible();
  expect(threeRequests).toEqual([]);

  await toggle.click();
  const stage = page.getByRole("region", { name: "3D size comparison" });
  await expect(stage.locator("canvas")).toHaveCount(1);
  await expect(stage.locator(".compare-stage-labels span")).toHaveText(["2025 Camry", "2023 RAV4 Hybrid"]);
  await expect(stage.getByRole("status")).toHaveText("Shown at true relative scale. Drag to orbit together.", { timeout: 150_000 });
  // The low-detail LOD, not the full model: several vehicles load at once here.
  expect(threeRequests.filter((url) => url.endsWith(".glb")).every((url) => url.includes(".lod1."))).toBe(true);

  await page.getByRole("button", { name: "Hide 3D comparison" }).click();
  await expect(stage).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the builder stage shows the vehicle's rendered thumbnail as a poster while 3D loads", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("toyota-showroom:quality", "low");
    localStorage.setItem("toyota-showroom:tour-seen", "1");
  });
  await page.goto("4runner/");
  const stage = page.locator(".vehicle-canvas[data-poster]").first();
  await expect(stage).toHaveCSS("background-image", /\/images\/vehicles\/4runner\/4runner-thumbnail\.webp/);
  const poster = await stage.evaluate((element) => getComputedStyle(element).backgroundImage.replace(/^url\("?|"?\)$/g, ""));
  expect((await page.request.get(poster)).status()).toBe(200);
});

test("3D is not offered when fewer than two chosen vehicles have a model", async ({ page }) => {
  // The Tacoma has no 3D model yet, so Tacoma + Camry would be a one-car "comparison".
  await page.goto("compare/?vehicles=tacoma,camry");
  await page.waitForSelector(".compare-table");
  await expect(page.getByRole("button", { name: "Compare in 3D" })).toHaveCount(0);
});

test("the stage takes keyboard orbit/zoom/reset, and unmounts when the window gets too narrow for it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("compare/?vehicles=camry,rav4-hybrid");
  await page.waitForSelector(".compare-table");
  await page.getByRole("button", { name: "Compare in 3D" }).click();
  const stage = page.getByRole("region", { name: "3D size comparison" });
  await expect(stage.getByRole("status")).toHaveText(/Shown at true relative scale/, { timeout: 150_000 });

  const viewer = stage.getByRole("group", { name: /arrow keys to orbit/ });
  await viewer.focus();
  await expect(viewer).toBeFocused();
  for (const key of ["ArrowLeft", "ArrowUp", "+", "-", "Home"]) await page.keyboard.press(key);

  await page.setViewportSize({ width: 800, height: 900 });
  await expect(stage).toHaveCount(0);
  await expect(page.getByRole("button", { name: /3D/ })).toHaveCount(0);
  await expect(page.locator(".compare-table")).toBeVisible();
  expect(errors).toEqual([]);
});
