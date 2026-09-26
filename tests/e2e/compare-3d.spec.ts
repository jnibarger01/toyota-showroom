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
