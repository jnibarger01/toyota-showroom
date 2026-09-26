import { expect, test, type Page } from "@playwright/test";

/**
 * Browser coverage for the showroom's View tools: feature hotspots, the dimensions overlay, doors
 * and the driver's-seat view. Pinned to `low` like the other interaction specs — this tests
 * behaviour and wiring, not rendering (visual-3d.spec.ts owns pixels).
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

async function openBuilder(page: Page, slug: string) {
  await page.addInitScript(() => {
    localStorage.setItem("toyota-showroom:quality", "low");
    localStorage.setItem("toyota-showroom:tour-seen", "1");
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${slug}/`);
  await expect.poll(() => page.locator(".vehicle-canvas canvas").getAttribute("data-load-phase"), { timeout: 60_000 }).toBe("ready");
  return errors;
}

test("feature hotspots appear on the visible side of the vehicle and open their category", async ({ page }) => {
  const errors = await openBuilder(page, "camry");
  await page.getByTestId("toggle-hotspots").click();
  const wheel = page.getByRole("button", { name: "Wheel finish: customize" });
  // Anchors resolve over a few frames (one raycast pass per hotspot per frame).
  await expect(wheel).toBeVisible({ timeout: 30_000 });
  await wheel.click();
  await expect(page.locator(".rail-item.active")).toContainText("Wheels");
  expect(errors).toEqual([]);
});

test("dimensions label only the figures the catalog publishes", async ({ page }) => {
  const errors = await openBuilder(page, "camry");
  await page.getByTestId("toggle-dimensions").click();
  const labels = page.locator(".scene-dimension");
  // The Camry publishes its length only; width and height are not guessed from the model.
  await expect(labels).toHaveText(["Length 193.0 in · 4,902 mm"], { timeout: 15_000 });
  await page.getByTestId("toggle-dimensions").click();
  await expect(labels).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("doors toggle, and the driver's seat is offered where a steering wheel is configured", async ({ page }) => {
  const errors = await openBuilder(page, "camry");
  const doors = page.getByTestId("toggle-doors");
  await doors.click();
  await expect(doors).toHaveAttribute("aria-pressed", "true");
  const driver = page.getByTestId("toggle-driver-view");
  await driver.click();
  await expect(driver).toHaveAttribute("aria-pressed", "true");
  // Hotspots stand down while the camera is in the cabin.
  await page.getByTestId("toggle-hotspots").click();
  await expect(page.locator(".scene-hotspot:visible")).toHaveCount(0);
  await driver.click();
  await expect(driver).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("a body-shell asset offers no driver's seat", async ({ page }) => {
  const errors = await openBuilder(page, "rav4");
  await expect(page.getByTestId("toggle-dimensions")).toBeVisible();
  await expect(page.getByTestId("toggle-driver-view")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("dimension lines are measured from the closed vehicle, whichever toggle came first", async ({ page }) => {
  const errors = await openBuilder(page, "camry");
  const label = page.locator(".scene-dimension").first();
  const dimensions = page.getByTestId("toggle-dimensions");

  await dimensions.click();
  await expect(label).toBeVisible({ timeout: 15_000 });
  const closedFirst = await label.getAttribute("style");
  await dimensions.click();

  await page.getByTestId("toggle-doors").click();
  await page.waitForTimeout(1500); // doors finish opening
  await dimensions.click();
  await expect(label).toBeVisible({ timeout: 15_000 });
  expect(await label.getAttribute("style")).toBe(closedFirst);
  expect(errors).toEqual([]);
});

test("on a phone, a hotspot opens the configuration panel at its category", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openBuilder(page, "camry");
  const customize = page.locator(".mobile-config-trigger");
  await customize.click();
  await page.getByTestId("toggle-hotspots").click();
  await page.keyboard.press("Escape"); // close the panel to see the stage
  await expect(customize).toHaveAttribute("aria-expanded", "false");
  const hotspot = page.locator(".scene-hotspot:visible").first();
  await expect(hotspot).toBeVisible({ timeout: 30_000 });
  await hotspot.click();
  await expect(customize).toHaveAttribute("aria-expanded", "true");
  expect(errors).toEqual([]);
});
