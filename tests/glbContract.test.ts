import path from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectGlb } from "../lib/tooling/glbInspect";
import { requiredNodeNames } from "../lib/three/nodes";
import { getOptionsForVehicle } from "../lib/data/options";
import { VEHICLES } from "../lib/data/vehicles";
import { ACCESSORY_NODE_NAMES } from "../lib/three/proceduralParts";
import type { CustomizationOption } from "../lib/types/customization";

/**
 * Nodes that exist in the live scene without coming from any GLB — `buildProceduralAccessories`
 * (lib/three/proceduralParts.ts) constructs and names them at runtime, on every vehicle, before
 * `verifyNodeContract` ever inspects the tree. They are absent from the binary asset by design, so
 * the raw-file inspection below must be told about them or every accessory option reads as broken.
 */
const SYNTHETIC_NODE_NAMES = new Set<string>(Object.values(ACCESSORY_NODE_NAMES));

/**
 * Guards the catalog against silent drift from the shipped GLB.
 *
 * `verifyNodeContract` (lib/three/nodes.ts) already does this at runtime — an option whose nodes
 * are missing is dropped from the UI rather than rendering a dead button — but that check only ever
 * runs in a browser with a loaded scene. Nothing previously caught a typo'd node name, a renamed
 * material, or a swapped GLB at commit/CI time. This test parses the real, checked-in asset (via
 * `inspectGlb`, no three.js/DOM dependency) and re-derives the same pass/fail the browser would see.
 *
 * Every option returned by `getOptionsForVehicle` is shipped to clients and must resolve. Planned
 * options whose authored geometry has not landed belong outside that active catalog; allowing them
 * here would turn this check into documentation rather than an enforcement gate.
 */

function missingMaterials(
  inspection: ReturnType<typeof inspectGlb>,
  option: CustomizationOption,
): string[] {
  if (!option.targetMaterials?.length || !option.targetNodes?.length) return [];

  const present = new Set<string>();
  for (const nodeName of option.targetNodes) {
    for (const materialName of inspection.materialsByNode.get(nodeName) ?? []) {
      present.add(materialName);
    }
  }
  return option.targetMaterials.filter((name) => !present.has(name));
}

describe("catalog vs. shipped GLB", () => {
  for (const vehicle of VEHICLES) {
    const { threeDConfig } = vehicle;
    if (!threeDConfig.hasModel || !threeDConfig.modelUrl) continue;

    const filePath = path.join(process.cwd(), "public", threeDConfig.modelUrl);
    if (!existsSync(filePath)) {
      it(`${vehicle.slug}: has its declared GLB checked in`, () => {
        expect(existsSync(filePath), `Missing declared model: ${threeDConfig.modelUrl}`).toBe(true);
      });
      continue;
    }

    describe(vehicle.slug, () => {
      const inspection = inspectGlb(filePath);
      const options = getOptionsForVehicle(vehicle.slug);

      it("has at least one customization option to check", () => {
        // An empty catalog trivially "passes" every check below; assert non-emptiness so this file
        // can't silently stop covering a vehicle once its catalog is populated (Task 1 fills this in
        // for tacoma/camry once their assets exist).
        expect(options.length).toBeGreaterThan(0);
      });

      for (const option of options) {
        const label = `${option.id} (${option.category})`;

        it(label, () => {
          const missingNodes = requiredNodeNames(option).filter(
            (name) => !inspection.nodeNames.has(name) && !SYNTHETIC_NODE_NAMES.has(name),
          );
          const missingMats = missingMaterials(inspection, option);
          const unresolved = missingNodes.length > 0 || missingMats.length > 0;

          expect(
            unresolved,
            `Option "${option.id}" does not resolve against ${threeDConfig.modelUrl}: ` +
              `missing nodes [${missingNodes.join(", ")}], missing materials [${missingMats.join(", ")}].`,
          ).toBe(false);
        });
      }
    });
  }
});
