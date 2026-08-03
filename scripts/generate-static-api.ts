import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { VEHICLES } from "../lib/data/vehicles";
import { VEHICLE_SCHEMA_VERSION, toVehicleSummary } from "../lib/types/vehicle";

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
  // Clear any fixtures from a previous run (e.g. a vehicle removed or renamed since) so a
  // retained public/api/v1 directory can't leave stale, still-fetchable endpoints behind.
  await rm(outDir, { recursive: true, force: true });

  // Deliberately bypasses `queryVehicles`/`paginateAndFilter`, which clamp to MAX_PAGE_SIZE
  // (50): this snapshot is the full catalog the client SDK caches and filters/paginates
  // client-side, so it must never be truncated regardless of the public per-request cap.
  const summaries = VEHICLES.map(toVehicleSummary);
  await writeJson("vehicles.json", {
    schemaVersion: VEHICLE_SCHEMA_VERSION,
    data: summaries,
    page: 1,
    pageSize: summaries.length,
    totalItems: summaries.length,
    totalPages: 1,
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
