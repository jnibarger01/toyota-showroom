import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("toyota-showroom:tour-seen", "1");
    localStorage.setItem("toyota-showroom:quality", "low");
  });
});

test("Build & Price uses the OEM buyer step order and keeps factory package data honest", async ({ page }) => {
  await page.goto("4runner/");

  const flow = page.getByTestId("buyer-flow");
  await expect(flow).toBeVisible();
  await expect(flow.getByRole("button")).toHaveCount(7);

  await page.getByRole("button", { name: "Build step: Grade" }).click();
  const gradePanel = page.getByTestId("buyer-grade-panel");
  await expect(gradePanel).toBeVisible();
  await gradePanel.getByRole("button", { name: /TRD Off-Road/i }).click();

  await page.getByRole("button", { name: "Build step: Packages" }).click();
  const packages = page.getByTestId("buyer-packages-panel");
  await expect(packages).toContainText("Premium Package");
  await expect(packages).toContainText("Leather-trimmed seats");
  await expect(packages).toContainText("$3,520");

  await page.getByRole("button", { name: "Build step: Exterior" }).click();
  await expect(page.getByRole("tab", { name: "Paint" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Wheels" }).click();
  await expect(page.getByRole("tab", { name: "Wheels" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Build step: Summary" }).click();
  await expect(page.getByTestId("buyer-summary-panel")).toBeVisible();
  await expect(page.getByTestId("estimated-total")).toBeVisible();
  await expect(page.getByTestId("estimated-monthly-payment")).toBeVisible();
});

test("OEM spin keeps 3D Studio out of the primary flow until the shopper requests 3D", async ({ page }) => {
  await page.goto("rav4-hybrid/");

  await expect(page.getByTestId("vehicle-spin")).toBeVisible();
  await expect(page.locator(".left-rail").getByText("3D Studio", { exact: true })).toHaveCount(0);
  await expect(page.locator(".oem-rail-note")).toContainText("Open 3D for studio tools");

  await page.getByTestId("explore-in-3d").click();
  await expect(page.locator(".left-rail").getByText("3D Studio", { exact: true })).toBeVisible();

  await page.locator(".rail-item").filter({ hasText: "Brakes" }).click();
  await expect(page.locator("#configuration-panel-title")).toContainText("3D Studio");
  await expect(page.locator("#configuration-panel-title")).toContainText("Brakes");
  await expect(page.getByText("Terrain preview")).toBeVisible();
});
