import path from "node:path";
import { expect, test } from "@playwright/test";

const vehicles = [
  {
    slug: "rav4-hybrid",
    paint: "Ice Cap",
    modelFile: "rav4-hybrid.glb",
    thumbnail: "public/images/vehicles/rav4-hybrid/rav4-hybrid-front-three-quarter.png",
  },
  {
    slug: "land-cruiser",
    paint: "Trail Dust",
    modelFile: "land-cruiser-250.glb",
    thumbnail: "public/images/vehicles/land-cruiser/land-cruiser-front-three-quarter.png",
  },
] as const;

const modelABaseUrl = process.env.MODEL_A_BASE_URL;
const modelAUrl = (route: string) => modelABaseUrl ? new URL(route, modelABaseUrl).toString() : route;

test.describe.configure({ mode: "serial", timeout: 120_000 });

for (const vehicle of vehicles) {
  test(`${vehicle.slug} loads its detailed model and exposes working configuration`, async ({ page }, testInfo) => {
    const consoleFailures: string[] = [];
    const failedRequests: string[] = [];
    const modelResponses: number[] = [];

    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") consoleFailures.push(message.text());
    });
    page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.endsWith(vehicle.modelFile)) modelResponses.push(response.status());
    });

    await page.goto(modelAUrl(`${vehicle.slug}/`));
    const paint = page.getByRole("button", { name: vehicle.paint });
    await expect(paint).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => page.locator("canvas").getAttribute("data-load-phase"), { timeout: 60_000 }).toBe("ready");
    const visualEvidence = testInfo.outputPath(`${vehicle.slug}-hero.png`);
    await page.locator(".vehicle-canvas").screenshot({ path: visualEvidence, animations: "disabled" });
    await testInfo.attach(`${vehicle.slug} hero`, { path: visualEvidence, contentType: "image/png" });

    expect(modelResponses).toContain(200);
    expect(failedRequests.filter((entry) => entry.includes("/models/") || entry.includes("/images/vehicles/"))).toEqual([]);
    expect(consoleFailures.filter((entry) => entry.includes("High-detail glTF failed to load"))).toEqual([]);
    expect(consoleFailures.filter((entry) => entry.includes("is unavailable for this asset"))).toEqual([]);

    await paint.click();
    await expect(paint).toHaveAttribute("aria-pressed", "true");

    if (process.env.CAPTURE_MODEL_A_THUMBNAILS === "1") {
      await page.evaluate(() => {
        const canvas = document.querySelector(".vehicle-canvas canvas");
        if (!canvas) return;
        const ancestors = new Set<Element>();
        for (let element: Element | null = canvas; element; element = element.parentElement) ancestors.add(element);
        for (const element of document.querySelectorAll<HTMLElement>("body *")) {
          if (!ancestors.has(element) && !canvas.contains(element)) element.style.visibility = "hidden";
        }
      });
      await page.locator(".vehicle-canvas canvas").screenshot({
        path: path.resolve(process.cwd(), vehicle.thumbnail),
        animations: "disabled",
      });
    }
  });
}

test("Explore lists both new vehicles with working base-path links and thumbnails", async ({ page }) => {
  const missingAssets: string[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400 && (pathname.includes("rav4-hybrid") || pathname.includes("land-cruiser"))) {
      missingAssets.push(`${response.status()} ${pathname}`);
    }
  });

  await page.goto(modelAUrl("explore/"));
  const rav4Hybrid = page.getByRole("link", { name: /2023 Toyota RAV4 Hybrid/i });
  const landCruiser = page.getByRole("link", { name: /2025 Toyota Land Cruiser/i });
  await expect(rav4Hybrid).toBeVisible();
  await expect(landCruiser).toBeVisible();
  await expect(rav4Hybrid).toHaveAttribute("href", /\/toyota-showroom\/rav4-hybrid\/$/);
  await expect(landCruiser).toHaveAttribute("href", /\/toyota-showroom\/land-cruiser\/$/);
  expect(missingAssets).toEqual([]);
});
