import { expect, test } from "@playwright/test";

/**
 * Regression test for the Three.js code-split (`app/components/BuilderApp.tsx` lazy-loads
 * `VehicleCanvas` instead of importing it statically; docs/INTEGRATION_GUIDE.md §16). A bundler
 * chunk existing on disk doesn't prove a route never fetches it — only real network inspection
 * does, so this asserts against actual requests made while loading `/explore` and `/compare`,
 * neither of which ever renders a 3D canvas.
 */
test("pages without a 3D canvas never fetch the Three.js/VehicleCanvas chunk", async ({ page }) => {
  const chunkRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/\/assets\/VehicleCanvas-/.test(url)) chunkRequests.push(url);
  });

  await page.goto("explore/");
  await page.waitForSelector(".vehicle-card");
  await page.goto("compare/?vehicles=4runner,tacoma,camry");
  await page.waitForSelector(".compare-table");

  expect(chunkRequests).toEqual([]);
});

test("the builder page does fetch the Three.js/VehicleCanvas chunk", async ({ page }) => {
  const chunkRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/\/assets\/VehicleCanvas-/.test(url)) chunkRequests.push(url);
  });

  await page.goto("4runner/");
  await page.waitForSelector(".vehicle-title h1");
  await expect
    .poll(() => chunkRequests.length, { message: "expected the builder page to fetch the VehicleCanvas chunk" })
    .toBeGreaterThan(0);
});
