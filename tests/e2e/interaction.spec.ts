import { expect, test, type Page } from "@playwright/test";

/**
 * Browser coverage for the showroom interaction layer: lamp modes, paint hover preview, and
 * double-click focus. Pinned to `low` like the other interaction specs — this tests behaviour, not
 * rendering (visual-3d.spec.ts owns pixels).
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

async function openBuilder(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("toyota-showroom:quality", "low");
    localStorage.setItem("toyota-showroom:tour-seen", "1");
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("4runner/");
  await expect.poll(() => page.locator(".vehicle-canvas canvas").getAttribute("data-load-phase"), { timeout: 60_000 }).toBe("ready");
  return errors;
}

test("lamp modes are offered for a vehicle whose scene map names lamps, and select", async ({ page }) => {
  const errors = await openBuilder(page);
  const lamps = page.getByTestId("lamp-mode");
  await expect(lamps.getByRole("button")).toHaveText(["Default", "Off", "DRL", "Low beam", "Brake", "Hazards"]);
  const hazards = lamps.getByRole("button", { name: "Hazards" });
  await hazards.click();
  await expect(hazards).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("hovering a paint swatch previews it without selecting or saving it", async ({ page }) => {
  const errors = await openBuilder(page);
  const red = page.getByRole("button", { name: "Barcelona Red Metallic" });
  await expect(red).toBeVisible();
  await expect(red).not.toHaveAttribute("aria-pressed", "true");
  await red.hover();
  // A preview never enters configuration state: no save is scheduled and nothing becomes pressed.
  await page.waitForTimeout(500);
  await expect(red).not.toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /saving/i })).toHaveCount(0);
  await page.mouse.move(5, 5);
  await expect(red).not.toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("double-clicking the vehicle selects the part and zooms to it", async ({ page }) => {
  const errors = await openBuilder(page);
  const canvas = page.locator(".vehicle-canvas canvas");
  const box = (await canvas.boundingBox())!;
  // Same spot partInteraction.spec.ts verifies lands on the body paint.
  await page.mouse.dblclick(box.x + box.width * 0.62, box.y + box.height * 0.48);
  await expect.poll(() => canvas.getAttribute("data-selected-part"), { timeout: 10_000 }).toBe("body.exterior");
  expect(errors).toEqual([]);
});
