import path from "node:path";
import { expect, test } from "@playwright/test";

const vehicles = [
  {
    slug: "gr-corolla",
    name: /2023 Toyota GR Corolla/i,
    paint: "Ice Cap",
    modelFile: "2023_toyota_gr_corolla.glb",
    thumbnail: "public/images/vehicles/gr-corolla/gr-corolla-front-three-quarter.png",
  },
  {
    slug: "gt86",
    name: /Toyota GT86/i,
    paint: "Satin White Pearl",
    modelFile: "toyota_gt86.glb",
    thumbnail: "public/images/vehicles/gt86/gt86-front-three-quarter.png",
  },
] as const;

const modelBBaseUrl = process.env.MODEL_B_BASE_URL;
const modelBUrl = (route: string) => modelBBaseUrl ? new URL(route, modelBBaseUrl).toString() : route;

test.describe.configure({ mode: "serial", timeout: 120_000 });

for (const vehicle of vehicles) {
  test(`${vehicle.slug} loads its detailed model and applies configuration`, async ({ page }, testInfo) => {
    const consoleFailures: string[] = [];
    const failedRequests: string[] = [];
    const errorResponses: string[] = [];
    const modelResponses: number[] = [];

    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") consoleFailures.push(message.text());
    });
    page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.endsWith(vehicle.modelFile)) modelResponses.push(response.status());
      if (response.status() >= 400) errorResponses.push(`${response.status()} ${pathname}`);
    });

    await page.goto(modelBUrl(`${vehicle.slug}/`));
    const paint = page.getByRole("button", { name: vehicle.paint });
    await expect(paint).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => page.locator("canvas").getAttribute("data-load-phase"), { timeout: 60_000 }).toBe("ready");

    const visualEvidence = testInfo.outputPath(`${vehicle.slug}-hero.png`);
    await page.locator(".vehicle-canvas").screenshot({ path: visualEvidence, animations: "disabled" });
    await testInfo.attach(`${vehicle.slug} hero`, { path: visualEvidence, contentType: "image/png" });

    expect(modelResponses).toContain(200);
    expect(failedRequests).toEqual([]);
    expect(errorResponses).toEqual(["404 /toyota-showroom/api/v1/configurations"]);
    const knownHeadlessDiagnostics = [
      "Failed to load resource: the server responded with a status of 404",
      "RGBELoader has been deprecated",
      "No available adapters.",
      "THREE.WebGPURenderer: WebGPU is not available",
      "THREE.Renderer: \"renderAsync()\" has been deprecated",
      "THREE.WebGPURenderer: Timestamp tracking is disabled",
      "THREE.DRACOLoader: setDecoderConfig to has been deprecated",
      "GL Driver Message",
    ];
    expect(
      consoleFailures.filter((entry) => !knownHeadlessDiagnostics.some((known) => entry.includes(known))),
    ).toEqual([]);

    await paint.click();
    await expect(paint).toHaveAttribute("aria-pressed", "true");

    if (process.env.CAPTURE_MODEL_B_THUMBNAILS === "1") {
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

test("Explore lists exactly one GT86 and the GR Corolla with working Pages-base links", async ({ page }) => {
  const missingAssets: string[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400 && (pathname.includes("gt86") || pathname.includes("gr-corolla"))) {
      missingAssets.push(`${response.status()} ${pathname}`);
    }
  });

  await page.goto(modelBUrl("explore/"));
  const grCorolla = page.getByRole("link", { name: vehicles[0].name });
  const gt86 = page.getByRole("link", { name: vehicles[1].name });
  await expect(grCorolla).toBeVisible();
  await expect(gt86).toHaveCount(1);
  await expect(gt86).toBeVisible();
  await expect(grCorolla).toHaveAttribute("href", /\/toyota-showroom\/gr-corolla\/$/);
  await expect(gt86).toHaveAttribute("href", /\/toyota-showroom\/gt86\/$/);
  expect(missingAssets).toEqual([]);
});

test("switching from GT86 to GR Corolla does not retain GT86 paint state", async ({ page }) => {
  await page.goto(modelBUrl("gt86/"));
  const gt86Paint = page.getByRole("button", { name: "Lightning Red" });
  await expect(gt86Paint).toBeVisible({ timeout: 60_000 });
  await gt86Paint.click();
  await expect(gt86Paint).toHaveAttribute("aria-pressed", "true");

  await page.goto(modelBUrl("gr-corolla/"));
  await expect(page.getByRole("button", { name: "Ice Cap" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Lightning Red" })).toHaveCount(0);
  await expect.poll(async () => page.locator("canvas").getAttribute("data-load-phase"), { timeout: 60_000 }).toBe("ready");
});
