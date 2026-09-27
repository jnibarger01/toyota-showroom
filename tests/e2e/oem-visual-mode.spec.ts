import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 180_000 });

test("OEM visual mode stays lightweight until 3D is explicitly requested", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("toyota-showroom:tour-seen", "1");
    localStorage.setItem("toyota-showroom:quality", "low");
  });

  const heavyRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/VehicleCanvas|\.glb(?:\?|$)/.test(url)) heavyRequests.push(url);
  });

  await page.goto("rav4-hybrid/");
  const spin = page.getByTestId("vehicle-spin");
  await expect(spin).toBeVisible();
  const image = spin.getByRole("img");
  await expect(image).toHaveAttribute("src", /\/spins\/rav4-hybrid\/040\/00\.webp$/);
  expect(heavyRequests).toEqual([]);

  await spin.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(image).toHaveAttribute("src", /\/spins\/rav4-hybrid\/040\/02\.webp$/);

  await page.getByRole("button", { name: "Magnetic Gray Metallic" }).click();
  await expect(image).toHaveAttribute("src", /\/spins\/rav4-hybrid\/1g3\/02\.webp$/);
  expect(heavyRequests).toEqual([]);

  await page.getByTestId("explore-in-3d").click();
  await expect(page.locator(".vehicle-canvas canvas")).toHaveCount(1);
  await expect.poll(() => heavyRequests.some((url) => /\.glb(?:\?|$)/.test(url)), {
    timeout: 120_000,
  }).toBe(true);

  await page.getByTestId("oem-visual-mode").click();
  await expect(page.getByTestId("vehicle-spin")).toBeVisible();
});