import { expect, test } from "@playwright/test";

/**
 * The iOS Quick Look path, driven in Chromium: the page is told `<a rel="ar">` is supported (as
 * Safari on iPhone reports it) and the anchor click Quick Look would intercept is captured instead.
 * What this proves is the part that can break in a browser — the current build exporting to a real
 * USDZ blob and being handed to an `<a rel="ar">` with an `<img>` child — not Quick Look itself.
 */
test.describe.configure({ timeout: 120_000 });

test("AR on a Quick Look device exports the current build as USDZ and opens it", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("toyota-showroom:quality", "low");
    localStorage.setItem("toyota-showroom:tour-seen", "1");
    const supports = DOMTokenList.prototype.supports;
    DOMTokenList.prototype.supports = function (token: string) {
      return token === "ar" ? true : supports.call(this, token);
    };
    const opened: Array<{ href: string; hasImg: boolean }> = [];
    (window as unknown as { __quickLook: typeof opened }).__quickLook = opened;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.rel === "ar") {
        opened.push({ href: this.href, hasImg: this.firstElementChild?.tagName === "IMG" });
        return;
      }
      click.call(this);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("4runner/");
  await expect.poll(() => page.locator(".vehicle-canvas canvas").getAttribute("data-load-phase"), { timeout: 60_000 }).toBe("ready");

  const ar = page.getByTestId("xr-walkaround");
  await expect(ar).toHaveAttribute("aria-label", "View in AR (Quick Look)");
  await expect(ar).toBeEnabled();
  await ar.click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __quickLook: unknown[] }).__quickLook.length), { timeout: 60_000 }).toBe(1);
  const usdz = await page.evaluate(async () => {
    const [entry] = (window as unknown as { __quickLook: Array<{ href: string; hasImg: boolean }> }).__quickLook;
    const blob = await (await fetch(entry!.href)).blob();
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    return { hasImg: entry!.hasImg, scheme: entry!.href.split(":")[0], type: blob.type, size: blob.size, zipMagic: String.fromCharCode(...head) };
  });
  expect(usdz).toMatchObject({ hasImg: true, scheme: "blob", type: "model/vnd.usdz+zip", zipMagic: "PK" });
  expect(usdz.size).toBeGreaterThan(100_000);
  expect(errors).toEqual([]);
});
