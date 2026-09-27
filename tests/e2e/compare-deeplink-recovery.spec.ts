import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

test("present-but-empty cmp is treated as a broken compare link", async ({ page }) => {
  await page.goto("compare/?cmp=");
  await expect(page.getByRole("alert")).toContainText(/can.t be restored/i);
  await expect(page.locator(".compare-picker")).toHaveCount(0);
});

test("resetting a broken compare link clears deep-link params and returns to the catalog picker", async ({ page }) => {
  await page.goto("compare/?cmp=%25%25%25&builds=cfg_a,cfg_b&keep=1#recovery");

  await expect(page.getByRole("alert")).toContainText(/can.t be restored/i);
  await page.getByRole("button", { name: "Clear link and compare vehicles" }).click();

  await expect(page.locator(".compare-picker")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  const url = new URL(page.url());
  expect(url.searchParams.has("cmp")).toBe(false);
  expect(url.searchParams.has("builds")).toBe(false);
  expect(url.searchParams.get("keep")).toBe("1");
  expect(url.hash).toBe("#recovery");
});
