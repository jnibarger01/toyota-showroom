import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getOptionsForVehicle } from "../lib/data/options";
import { VEHICLES } from "../lib/data/vehicles";

/**
 * `scripts/optimize-models.mjs` keeps simplification off paint because fewer triangles on a large
 * smooth panel visibly moves the clearcoat highlight. It finds paint by exact material name from
 * `scripts/model-pipeline-config.json` — and the first version, which guessed with a regex, missed
 * the RAV4 Hybrid's `Tdummy_material_0_085`/`Color_2` entirely. This ties that list to the catalog:
 * any material a paint option recolours must be protected for every model the pipeline simplifies.
 */
const config = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/model-pipeline-config.json"), "utf8"),
) as { paintMaterials: Record<string, string[]> };

describe("model pipeline paint protection", () => {
  for (const vehicle of VEHICLES) {
    const { modelUrl } = vehicle.threeDConfig;
    if (!modelUrl) continue;
    const key = Object.keys(config.paintMaterials).find((relative) => modelUrl.endsWith(relative));
    // Only models the pipeline simplifies need an entry; the script throws for a missing one.
    if (!key) continue;

    it(`${vehicle.slug}: every paint option's target material is protected`, () => {
      const protectedNames = new Set(config.paintMaterials[key]);
      const paintTargets = getOptionsForVehicle(vehicle.slug)
        .filter((option) => option.category === "paint")
        .flatMap((option) => option.targetMaterials ?? []);
      expect(paintTargets.length).toBeGreaterThan(0);
      expect([...new Set(paintTargets)].filter((name) => !protectedNames.has(name))).toEqual([]);
    });
  }
});
