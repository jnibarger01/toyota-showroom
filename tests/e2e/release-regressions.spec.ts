import { expect, test } from "@playwright/test";

test("Explore and Compare remain user-scrollable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of ["explore/", "compare/?vehicles=4runner,tacoma,camry"]) {
    await page.goto(route);
    if (route.startsWith("explore")) await page.waitForSelector(".vehicle-card");
    else await page.waitForSelector(".compare-table");
    const dimensions = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

    await page.mouse.wheel(0, 700);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});
test("builder chrome never widens the document at responsive breakpoints", async ({ page }) => {
  const cases = [
    { slug: "4runner", width: 390, height: 844 },
    { slug: "4runner", width: 768, height: 1024 },
    { slug: "4runner", width: 844, height: 390 },
    { slug: "rav4-hybrid", width: 430, height: 932 },
    { slug: "gr-supra", width: 390, height: 844 },
  ];

  for (const entry of cases) {
    await page.setViewportSize({ width: entry.width, height: entry.height });
    await page.goto(`${entry.slug}/`);
    await expect(page.locator(".stage")).toBeVisible();
    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
  }
});
test("mobile build menu restores navigation, grade and garage actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("4runner/");

  await page.getByRole("button", { name: "Open build menu" }).click();
  const menu = page.getByRole("dialog", { name: "Build menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Explore" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Garage", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: /SR5/i })).toBeVisible();
  await expect(menu.getByRole("button", { name: /^Save build$/i })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Request a test drive" })).toBeVisible();

  await menu.getByRole("button", { name: "Close build menu" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "Open build menu" })).toBeFocused();
});
test("Tacoma uses an explicit static preview instead of exposing the procedural viewer", async ({ page }) => {
  await page.goto("tacoma/");

  const preview = page.getByTestId("static-vehicle-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("3D model unavailable");
  await expect(preview.locator("img")).toHaveAttribute("src", /vehicles\/tacoma\/tacoma-static-preview\.svg/);
  await expect(page.locator(".stage-toolbar")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Vehicle viewer/i })).toHaveCount(0);
});
test("Explore uses vehicle-specific Tacoma and AE86 imagery", async ({ page }) => {
  await page.goto("explore/");
  await expect(page.locator(".vehicle-card")).toHaveCount(8);

  const sourceFor = async (model: string) =>
    page.locator(".vehicle-card").filter({ hasText: model }).locator("img").first().getAttribute("src");

  const runner = await sourceFor("4Runner");
  const tacoma = await sourceFor("Tacoma");
  const ae86 = await sourceFor("Corolla GT-S (AE86)");

  expect(tacoma).toContain("/vehicles/tacoma/tacoma-static-preview.svg");
  expect(ae86).toContain("/vehicles/ae86/ae86-front-three-quarter.webp");
  expect(tacoma).not.toBe(runner);
  expect(ae86).not.toBe(runner);
  expect(ae86).not.toBe(tacoma);
});
