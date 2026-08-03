import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { VEHICLES } from "../lib/data/vehicles";
import { VEHICLE_SCHEMA_VERSION, toVehicleSummary } from "../lib/types/vehicle";

/**
 * `vinext build` (this project's `output: "export"` static export) does not pre-render
 * force-static Route Handlers under app/api into dist/client — they only run against the
 * dist/server Cloudflare Worker bundle, which the GitHub Pages workflow never deploys. This
 * script derives static catalog fixtures from the same lib/data modules. Keeping them outside
 * `/api` prevents GitHub Pages files from impersonating query-aware Route Handlers. Runs via the
 * `prebuild` npm lifecycle hook, before `vinext build`.
 */

const outDir = path.resolve(import.meta.dirname, "../public/catalog/v1");
const legacyApiDir = path.resolve(import.meta.dirname, "../public/api");

async function writeJson(relPath: string, data: unknown): Promise<void> {
  const filePath = path.join(outDir, relPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

async function main() {
  // Clear generated data before writing so retained workspaces cannot serve stale records.
  // Remove the legacy public/api output as well; those files used to look like a live API on
  // GitHub Pages even though static hosting cannot honor its query-string contract.
  await Promise.all([
    rm(outDir, { recursive: true, force: true }),
    rm(legacyApiDir, { recursive: true, force: true }),
  ]);

  // This is an unpaged catalog snapshot, not a static implementation of the queryable
  // Route Handler. GitHub Pages cannot vary a file by query string; the client SDK applies
  // filtering and pagination after loading this complete catalog.
  const summaries = VEHICLES.map(toVehicleSummary);
  await writeJson("vehicles.json", {
    schemaVersion: VEHICLE_SCHEMA_VERSION,
    data: summaries,
  });

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
