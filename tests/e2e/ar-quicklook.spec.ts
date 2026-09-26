import { expect, test, type Page } from "@playwright/test";

/**
 * The iOS Quick Look path, driven in Chromium: the page is told `<a rel="ar">` is supported (as
 * Safari on iPhone reports it). What this proves is the part that can break in a browser — the
 * current build exported to a real USDZ blob *before* the tap and offered as an `<a rel="ar">` with
 * an `<img>` first child, so the viewer's own tap is the navigation Safari requires — not Quick Look.
 */
test.describe.configure({ timeout: 120_000 });

async function readUsdz(page: Page, href: string) {
  return page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    return { type: blob.type, size: blob.size, zipMagic: String.fromCharCode(...head) };
  }, href);
}

test("AR on a Quick Look device is a ready link to the current build as USDZ", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("toyota-showroom:quality", "low");
    localStorage.setItem("toyota-showroom:tour-seen", "1");
    const supports = DOMTokenList.prototype.supports;
    DOMTokenList.prototype.supports = function (token: string) {
      return token === "ar" ? true : supports.call(this, token);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("4runner/");
  await expect.poll(() => page.locator(".vehicle-canvas canvas").getAttribute("data-load-phase"), { timeout: 60_000 }).toBe("ready");

  const ar = page.locator("a[data-testid='xr-walkaround']");
  await expect(ar).toHaveAttribute("rel", "ar", { timeout: 60_000 });
  await expect(ar).toHaveAttribute("aria-label", "View in AR (Quick Look)");
  expect(await ar.evaluate((anchor) => anchor.firstElementChild?.tagName)).toBe("IMG");
  const first = (await ar.getAttribute("href"))!;
  expect(first.startsWith("blob:")).toBe(true);
  const usdz = await readUsdz(page, first);
  expect(usdz).toMatchObject({ type: "model/vnd.usdz+zip", zipMagic: "PK" });
  expect(usdz.size).toBeGreaterThan(100_000);

  // A build change withdraws the link and offers a fresh export of the new build.
  await page.getByRole("button", { name: "Barcelona Red Metallic" }).click();
  await expect.poll(() => page.locator("a[data-testid='xr-walkaround']").getAttribute("href"), { timeout: 60_000 }).not.toBe(first);
  const next = (await page.locator("a[data-testid='xr-walkaround']").getAttribute("href"))!;
  expect(next.startsWith("blob:")).toBe(true);
  expect(await readUsdz(page, next)).toMatchObject({ type: "model/vnd.usdz+zip", zipMagic: "PK" });
  expect(errors).toEqual([]);
});
