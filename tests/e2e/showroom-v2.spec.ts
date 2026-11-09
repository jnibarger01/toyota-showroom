import { expect, test } from "@playwright/test";

test.describe("Showroom v2 opt-in experience", () => {
  test("enters the vehicle-first studio and returns to the existing builder", async ({ page }) => {
    await page.goto("4runner/");
    const toggle = page.getByTestId("showroom-v2-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();
    const studio = page.getByTestId("showroom-v2-overlay");
    await expect(studio).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Showroom v2 controls" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Camera views" })).toBeVisible();
    await page.getByRole("button", { name: "Back to builder" }).click();
    await expect(studio).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Showroom v2 controls" })).toHaveCount(0);
  });

  test("keeps the studio entry and mobile controls operable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("4runner/");
    await expect(page.getByTestId("showroom-v2-toggle")).toBeVisible();
    await page.getByTestId("showroom-v2-toggle").click();
    const panel = page.getByRole("complementary", { name: "Showroom v2 controls" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Back to builder" })).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(390);
    await panel.getByRole("button", { name: "Back to builder" }).click();
    await expect(panel).toHaveCount(0);
  });
});
