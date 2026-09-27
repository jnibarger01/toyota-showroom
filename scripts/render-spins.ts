/**
 * Generates deterministic OEM-style 24-frame exterior spins from runtime GLBs.
 *
 *   npx tsx scripts/render-spins.ts                 # every vehicle with exteriorSpins
 *   npx tsx scripts/render-spins.ts rav4-hybrid     # selected vehicles
 */
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import sharp from "sharp";
import { VEHICLES } from "../lib/data/vehicles";
import { getOptionsForVehicle } from "../lib/data/options";
import type { ThumbnailJob } from "./thumbnails/renderer.browser";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC_DIR = join(ROOT, "public");
const WIDTH = 1600;
const HEIGHT = 1000;

const MIME: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".html": "text/html",
};
const BACKDROP_SVG = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <radialGradient id="g" cx="50%" cy="58%" r="70%">
      <stop offset="0%" stop-color="#2a313b"/>
      <stop offset="55%" stop-color="#151a21"/>
      <stop offset="100%" stop-color="#0c1015"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`);

function paintForCode(vehicleSlug: string, paintCode: string) {
  return getOptionsForVehicle(vehicleSlug).find(
    (option) => option.category === "paint" && option.paintCode?.toLowerCase() === paintCode.toLowerCase(),
  );
}

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2));
  const vehicles = VEHICLES.filter(
    (vehicle) =>
      (only.size === 0 || only.has(vehicle.slug)) &&
      Boolean(vehicle.media.exteriorSpins?.length),
  );
  if (vehicles.length === 0) throw new Error("No vehicles with exteriorSpins matched the request.");

  const bundle = await build({
    entryPoints: [join(import.meta.dirname, "thumbnails/renderer.browser.ts")],
    bundle: true,
    format: "esm",
    write: false,
    platform: "browser",
    logLevel: "warning",
  });
  const bundleJs = bundle.outputFiles[0]!.text;

  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><html><body><script type="module" src="/__renderer.js"></script></body></html>');
      return;
    }
    if (path === "/__renderer.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(bundleJs);
      return;
    }
    const file = normalize(join(PUBLIC_DIR, path));
    if (!file.startsWith(PUBLIC_DIR)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("spin renderer server did not bind");

  const browser = await chromium.launch({
    executablePath: process.env.THUMBNAIL_CHROMIUM_PATH || undefined,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });

  try {
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[browser] ${message.text()}`);
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => "renderVehicleSpin" in window);

    for (const vehicle of vehicles) {
      const config = vehicle.threeDConfig;
      if (!config.hasModel || !config.modelUrl) throw new Error(`${vehicle.slug}: spin requires a GLB`);
      const front = config.cameraPresets.find((preset) => preset.id === "front");
      if (!front) throw new Error(`${vehicle.slug}: spin requires a front camera preset`);

      const paintCodes = [
        ...new Set((vehicle.media.exteriorSpins ?? []).map((spin) => spin.paintCode)),
      ];

      for (const paintCode of paintCodes) {
        const paint = paintForCode(vehicle.slug, paintCode);
        if (!paint?.materialConfig || !paint.targetMaterials?.length) {
          throw new Error(`${vehicle.slug}: paint ${paintCode} lacks material targets`);
        }

        const job: ThumbnailJob = {
          slug: vehicle.slug,
          modelUrl: config.modelUrl,
          scale: config.scale,
          rotation: config.rotation,
          hiddenNodeNames: config.hiddenNodeNames,
          groundingNodeNames: config.groundingNodeNames,
          texturePolicy: config.texturePolicy,
          wheelAndTireAssets: config.wheelAndTireAssets,
          wheelMountNames: config.wheelMountNames,
          materialOverrides: [{
            materials: paint.targetMaterials,
            color: paint.materialConfig.color,
            metalness: paint.materialConfig.metalness,
            roughness: paint.materialConfig.roughness,
          }],
          frontPosition: front.position,
          frontTarget: front.target,
          width: WIDTH,
          height: HEIGHT,
        };

        const frames = await page.evaluate(
          (input) => (window as unknown as {
            renderVehicleSpin(job: unknown): Promise<string[]>;
          }).renderVehicleSpin(input),
          job,
        );
        if (frames.length !== 24) throw new Error(`${vehicle.slug}/${paintCode}: expected 24 frames`);
        const outDir = join(PUBLIC_DIR, "spins", vehicle.slug, paintCode.toLowerCase());
        await mkdir(outDir, { recursive: true });

        for (let index = 0; index < frames.length; index += 1) {
          const dataUrl = frames[index]!;
          const car = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
          const output = join(outDir, `${String(index).padStart(2, "0")}.webp`);
          await sharp(BACKDROP_SVG)
            .composite([{ input: car }])
            .webp({ quality: 86, effort: 5 })
            .toFile(output);
        }
        console.log(`${vehicle.slug}/${paintCode}: wrote 24 frames`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});