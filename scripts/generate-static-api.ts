import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { VEHICLES } from "../lib/data/vehicles";
import { queryVehicles } from "../lib/api/query";
import { VEHICLE_SCHEMA_VERSION } from "../lib/types/vehicle";

/**
 * `vinext build` (this project's `output: "export"` static export) does not pre-render
 * force-static Route Handlers under app/api into dist/client — they only run against the
 * dist/server Cloudflare Worker bundle, which the GitHub Pages workflow never deploys. This
 * script derives the same JSON payloads from the same lib/data + lib/api/query modules the
 * route handlers use, so the static site actually has vehicle data to fetch. Runs via the
 * `prebuild` npm lifecycle hook, before `vinext build`.
 */

const outDir = path.resolve(import.meta.dirname, "../public/api/v1");

async function writeJson(relPath: string, data: unknown): Promise<void> {
  const filePath = path.join(outDir, relPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

async function main() {
  const list = queryVehicles(VEHICLES, {}, { page: 1, pageSize: VEHICLES.length });
  await writeJson("vehicles.json", { schemaVersion: VEHICLE_SCHEMA_VERSION, ...list });

  for (const vehicle of VEHICLES) {
    await writeJson(`vehicles/${vehicle.slug}.json`, { schemaVersion: VEHICLE_SCHEMA_VERSION, data: vehicle });
    await writeJson(`vehicles/${vehicle.slug}/media.json`, {
      schemaVersion: VEHICLE_SCHEMA_VERSION,
      slug: vehicle.slug,
      media: vehicle.media,
      threeDConfig: vehicle.threeDConfig,
    });
  }

  await writeJson("health.json", {
    status: "ok",
    schemaVersion: VEHICLE_SCHEMA_VERSION,
    vehicleCount: VEHICLES.length,
    timestamp: new Date().toISOString(),
  });

  console.log(`Generated static API fixtures for ${VEHICLES.length} vehicles into ${outDir}`);
}

main();
