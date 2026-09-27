import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { VEHICLES } from "../../lib/data/vehicles";
import { exteriorSpinCatalogErrors } from "../../lib/showroom/exteriorSpin";
import { EXTERIOR_SPIN_SCHEMA_VERSION } from "../../lib/types/spin";
import { validateSpinAssets, type SpinAssetValidation } from "./validate";

const ROOT = resolve(import.meta.dirname, "../..");
const PUBLIC_DIR = join(ROOT, "public");
const SPINS_DIR = join(PUBLIC_DIR, "spins");
const REVIEW_PATH = join(SPINS_DIR, "spin-review-manifest.json");
const PRODUCTION_PATH = join(SPINS_DIR, "spin-manifest.json");

async function main(): Promise<void> {
  const errors: string[] = [];
  const reviewSpins: Array<Record<string, unknown>> = [];
  const validationCache = new Map<string, Promise<SpinAssetValidation>>();

  for (const vehicle of VEHICLES) {
    const catalogErrors = exteriorSpinCatalogErrors(vehicle);
    errors.push(...catalogErrors);
    for (const spin of vehicle.media.exteriorSpins ?? []) {
      const assetKey = spin.frames.map((frame) => frame.url).join("\n");
      let pending = validationCache.get(assetKey);
      if (!pending) {
        pending = validateSpinAssets(spin, PUBLIC_DIR);
        validationCache.set(assetKey, pending);
      }
      const validation = await pending;
      const spinErrors = [
        ...catalogErrors.filter((message) => message.includes(spin.id)),
        ...validation.errors,
      ];
      errors.push(...validation.errors);
      reviewSpins.push({
        id: spin.id,
        vehicleSlug: spin.vehicleSlug,
        modelYear: spin.modelYear,
        gradeId: spin.gradeId,
        paintCode: spin.paintCode,
        direction: spin.direction,
        zeroAngle: spin.zeroAngle,
        degreesPerFrame: spin.degreesPerFrame,
        source: spin.source,
        ok: spinErrors.length === 0,
        errors: spinErrors,
        frames: validation.frames,
      });
    }
  }

  await mkdir(SPINS_DIR, { recursive: true });
  const review = {
    schemaVersion: EXTERIOR_SPIN_SCHEMA_VERSION,
    ok: errors.length === 0,
    errors,
    spins: reviewSpins,
  };
  await writeFile(REVIEW_PATH, JSON.stringify(review, null, 2) + "\n", "utf8");
  if (errors.length > 0) {
    await rm(PRODUCTION_PATH, { force: true });
    for (const error of errors) console.error(`[spin-qa] ${error}`);
    console.error(`[spin-qa] FAIL — review manifest: ${REVIEW_PATH}`);
    process.exitCode = 1;
    return;
  }

  const production = {
    schemaVersion: EXTERIOR_SPIN_SCHEMA_VERSION,
    spins: reviewSpins.map(({ ok: _ok, errors: _errors, ...spin }) => spin),
  };
  await writeFile(PRODUCTION_PATH, JSON.stringify(production, null, 2) + "\n", "utf8");
  console.log(`[spin-qa] PASS — ${reviewSpins.length} catalog spins validated`);
  console.log(`[spin-qa] production manifest: ${PRODUCTION_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});