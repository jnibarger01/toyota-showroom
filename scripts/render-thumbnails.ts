/**
 * Renders a consistent catalog thumbnail for every vehicle straight from its runtime GLB (or the
 * procedural fallback when a vehicle has no GLB yet).
 *
 *   npx tsx scripts/render-thumbnails.ts            # all vehicles
 *   npx tsx scripts/render-thumbnails.ts camry ae86 # a subset
 *
 * Output: `public/images/vehicles/<slug>/<slug>-thumbnail.webp`, 800×500 (the explore card is
 * 16:10). Every vehicle gets the same camera elevation, frame fill, lighting, and backdrop, so the
 * grid reads as one set instead of a mix of viewport screenshots and off-centre captures.
 *
 * Rendering happens in headless Chromium (WebGL via SwiftShader) because three.js' GLTF/Draco
 * path is browser code; the page is served from `public/` so model URLs resolve exactly as in
 * the app.
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
const WIDTH = 800;
const HEIGHT = 500;
const SUPERSAMPLE = 2;

/**
 * Catalog options that represent the factory look but aren't baked into the asset. The Supra GLB's
 * `Wheel1A` has no base colour at all (renders white); "Factory wheels" is the stock finish.
 */
const BASELINE_OPTION_IDS: Record<string, string[]> = {
  "gr-supra": ["supra-wheels-stock"],
};

const MIME: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".html": "text/html",
};

/** Dark studio sweep matching the explore card's `#0c1015` media background. */
const BACKDROP_SVG = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * SUPERSAMPLE}" height="${HEIGHT * SUPERSAMPLE}">
  <defs>
    <radialGradient id="g" cx="50%" cy="58%" r="70%">
      <stop offset="0%" stop-color="#2a313b"/>
      <stop offset="55%" stop-color="#151a21"/>
      <stop offset="100%" stop-color="#0c1015"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`);

/** Side-profile outlines on an 800×500 canvas, by body style. Deliberately generic. */
const SILHOUETTES: Record<string, string> = {
  sedan:
    "M120 330 L135 290 Q150 270 200 265 L285 258 Q330 205 390 195 L500 192 Q560 195 600 240 L655 255 Q690 262 695 290 L690 330 Z",
  truck:
    "M110 335 L112 270 Q118 250 150 246 L250 240 Q280 190 320 180 L420 178 Q440 180 445 200 L450 245 L690 245 L692 335 Z",
  suv:
    "M110 335 L112 275 Q118 255 150 250 L240 240 Q275 185 320 172 L600 168 Q640 170 660 210 L690 255 L692 335 Z",
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function placeholderSvg(vehicle: (typeof VEHICLES)[number]): Buffer {
  const outline = SILHOUETTES[vehicle.bodyStyle] ?? SILHOUETTES.suv!;
  const wheelsY = 335;
  const [frontX, rearX] = vehicle.bodyStyle === "sedan" ? [235, 590] : [215, 600];
  const w = WIDTH * SUPERSAMPLE;
  const h = HEIGHT * SUPERSAMPLE;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="g" cx="50%" cy="58%" r="70%">
      <stop offset="0%" stop-color="#2a313b"/><stop offset="55%" stop-color="#151a21"/><stop offset="100%" stop-color="#0c1015"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <ellipse cx="400" cy="${wheelsY + 32}" rx="300" ry="14" fill="#000" opacity="0.35"/>
  <g transform="translate(0 -10)" fill="none" stroke="#6b7684" stroke-width="3" stroke-linejoin="round" opacity="0.8">
    <path d="${outline}"/>
    <circle cx="${frontX}" cy="${wheelsY}" r="40" fill="#0c1015"/>
    <circle cx="${rearX}" cy="${wheelsY}" r="40" fill="#0c1015"/>
  </g>
  <text x="400" y="430" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#e6e9ee">${escapeXml(`${vehicle.year} ${vehicle.model}`)}</text>
  <text x="400" y="464" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="17" letter-spacing="3" fill="#8a94a3">3D MODEL COMING SOON</text>
</svg>`);
}

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2));
  const vehicles = VEHICLES.filter((vehicle) => only.size === 0 || only.has(vehicle.slug));
  if (vehicles.length === 0) throw new Error(`No vehicles match: ${[...only].join(", ")}`);

  console.log("bundling renderer…");
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
      response.end(`<!doctype html><html><body><script type="module" src="/__renderer.js"></script></body></html>`);
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
  if (!address || typeof address === "string") throw new Error("server did not bind");

  const browser = await chromium.launch({
    // Lets a pre-installed Chromium stand in when it differs from the pinned Playwright build.
    executablePath: process.env.THUMBNAIL_CHROMIUM_PATH || undefined,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[browser] ${message.text()}`);
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => "renderVehicleThumbnail" in window);

    for (const vehicle of vehicles) {
      const outDir = join(PUBLIC_DIR, "images/vehicles", vehicle.slug);
      await mkdir(outDir, { recursive: true });
      const outFile = join(outDir, `${vehicle.slug}-thumbnail.webp`);
      const config = vehicle.threeDConfig;

      let composed: Buffer;
      if (!config.hasModel || !config.modelUrl) {
        // The builder's procedural fallback is a generic box; photographing it would sell the
        // catalog card as something it isn't. Say plainly that the 3D model is still to come.
        composed = await sharp(placeholderSvg(vehicle)).png().toBuffer();
      } else {
        const front = config.cameraPresets.find((preset) => preset.id === "front");
        if (!front) throw new Error(`${vehicle.slug}: needs a "front" camera preset to know which way the nose faces`);
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
          materialOverrides: (BASELINE_OPTION_IDS[vehicle.slug] ?? []).map((id) => {
            const option = getOptionsForVehicle(vehicle.slug).find((candidate) => candidate.id === id);
            if (!option?.materialConfig || !option.targetMaterials) throw new Error(`${vehicle.slug}: baseline option ${id} not found`);
            const { color, metalness, roughness } = option.materialConfig;
            return { materials: option.targetMaterials, color, metalness, roughness };
          }),
          frontPosition: front.position,
          frontTarget: front.target,
          width: WIDTH * SUPERSAMPLE,
          height: HEIGHT * SUPERSAMPLE,
        };
        const dataUrl = await page.evaluate(
          (input) => (window as unknown as { renderVehicleThumbnail(job: unknown): Promise<string> }).renderVehicleThumbnail(input),
          job,
        );
        const car = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
        // sharp runs resize before composite within one pipeline, so flatten first, then downsample.
        composed = await sharp(BACKDROP_SVG).composite([{ input: car }]).png().toBuffer();
      }

      await sharp(composed).resize(WIDTH, HEIGHT, { kernel: "lanczos3" }).webp({ quality: 84, effort: 6 }).toFile(outFile);
      console.log(`${vehicle.slug}: ${config.modelUrl ?? "no GLB (placeholder card)"} -> ${outFile.slice(ROOT.length + 1)}`);
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
