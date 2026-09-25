import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectGlb, readGlbJson } from "../lib/tooling/glbInspect";
import { requiredNodeNames } from "../lib/three/nodes";
import { getOptionsForVehicle } from "../lib/data/options";
import { plannedFourRunnerOptions } from "../lib/data/options/4runner";
import {
  plannedOptionIds,
  plannedOptionsEligibleForCatalog,
} from "../lib/data/options/plannedGate";
import { VEHICLES } from "../lib/data/vehicles";
import { ACCESSORY_NODE_NAMES } from "../lib/three/proceduralParts";
import {
  TIRE_MATERIAL_NAME,
  WHEEL_MATERIAL_NAME,
  tiresNodeName,
  wheelsetNodeName,
} from "../lib/three/proceduralWheels";
import { getWheelFitment } from "../lib/data/wheelFitment";
import type { CustomizationOption } from "../lib/types/customization";
import { isProceduralPreview } from "../lib/types/customization";

/**
 * Nodes that exist in the live scene without coming from any GLB — `buildProceduralAccessories`
 * (lib/three/proceduralParts.ts) constructs and names them at runtime, on every vehicle, before
 * `verifyNodeContract` ever inspects the tree. They are absent from the binary asset by design, so
 * the raw-file inspection below must be told about them or every accessory option reads as broken.
 */
const SYNTHETIC_NODE_NAMES = new Set<string>(Object.values(ACCESSORY_NODE_NAMES));

/**
 * The same exemption for runtime-built running gear.
 *
 * `installProceduralWheelPackages` (lib/three/installWheels.ts) mounts one `WHEELSET_*` group per
 * package this vehicle offers, each wrapping a `TIRES_*` subgroup, before `verifyNodeContract`
 * runs. Derived per vehicle from that vehicle's own fitment rather than allowlisted by prefix, so a
 * package offered on a vehicle whose fitment does not list it still fails this check.
 */
function syntheticWheelNodeNames(vehicleId: string): Set<string> {
  const fitment = getWheelFitment(vehicleId);
  if (!fitment) return new Set<string>();
  return new Set<string>(
    fitment.packageIds.flatMap((id) => [wheelsetNodeName(id), tiresNodeName(id)]),
  );
}

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
  syntheticWheels: ReadonlySet<string>,
): string[] {
  if (!option.targetMaterials?.length || !option.targetNodes?.length) return [];

  const present = new Set<string>();
  for (const nodeName of option.targetNodes) {
    // Subtree, not just the node's own mesh: the runtime's `resolveMeshes` descends into a named
    // group, and a catalog option may target one.
    for (const materialName of inspection.materialsInSubtree.get(nodeName) ?? []) {
      present.add(materialName);
    }
  }
  // Runtime-built running gear carries its material names in code, not in the GLB — the tyre
  // sidewall slot a `tire-sidewall-*` option writes to exists on every mounted package.
  if (option.targetNodes.some((name) => syntheticWheels.has(name))) {
    present.add(TIRE_MATERIAL_NAME);
    present.add(WHEEL_MATERIAL_NAME);
  }
  return option.targetMaterials.filter((name) => !present.has(name));
}

/**
 * Every model URL a vehicle can download: the full asset and, where one ships, the `low`-tier LOD
 * (`lodModelUrl`). The LOD is held to the exact same catalog contract — a viewer on a slow phone
 * must get the same working option list as everyone else, not a quieter subset.
 */
function shippedModelUrls(threeDConfig: (typeof VEHICLES)[number]["threeDConfig"]): string[] {
  if (!threeDConfig.hasModel) return [];
  return [threeDConfig.modelUrl, threeDConfig.lodModelUrl].filter((url): url is string => Boolean(url));
}

describe("catalog vs. shipped GLB", () => {
  for (const vehicle of VEHICLES) {
    const { threeDConfig } = vehicle;
    for (const modelUrl of shippedModelUrls(threeDConfig)) {
    const filePath = path.join(process.cwd(), "public", modelUrl);
    if (!existsSync(filePath)) {
      it(`${vehicle.slug}: has its declared GLB checked in (${modelUrl})`, () => {
        expect(existsSync(filePath), `Missing declared model: ${modelUrl}`).toBe(true);
      });
      continue;
    }

    describe(`${vehicle.slug} (${modelUrl})`, () => {
      const inspection = inspectGlb(filePath);
      // Runtime-generated options are validated against the live Three.js kit in
      // tests/runtimeModificationKit.test.ts. They intentionally do not exist in the raw GLB.
      const options = getOptionsForVehicle(vehicle.slug).filter(
        (option) => option.geometrySource !== "procedural-runtime",
      );
      // Wheel packages are runtime-built too, but unlike the mod kit they are checked here rather
      // than excluded: their node names are derived per vehicle from its own fitment, so this file
      // still catches a package offered on a vehicle whose fitment does not list it.
      const syntheticWheels = syntheticWheelNodeNames(vehicle.slug);

      it("has at least one customization option to check", () => {
        // An empty catalog trivially "passes" every check below; assert non-emptiness so this file
        // can't silently stop covering a vehicle once its catalog is populated. This is especially
        // important for authored assets, where an empty catalog would otherwise make the contract trivial.
        expect(options.length).toBeGreaterThan(0);
      });

      for (const option of options) {
        const label = `${option.id} (${option.category})`;

        it(label, () => {
          const missingNodes = requiredNodeNames(option).filter(
            (name) =>
              !inspection.nodeNames.has(name) &&
              !SYNTHETIC_NODE_NAMES.has(name) &&
              !syntheticWheels.has(name),
          );
          const missingMats = missingMaterials(inspection, option, syntheticWheels);
          const unresolved = missingNodes.length > 0 || missingMats.length > 0;

          expect(
            unresolved,
            `Option "${option.id}" does not resolve against ${modelUrl}: ` +
              `missing nodes [${missingNodes.join(", ")}], missing materials [${missingMats.join(", ")}].`,
          ).toBe(false);
        });
      }
    });
    }
  }
});

/**
 * Payload budgets for the GLBs this app actually downloads.
 *
 * These exist because the hero 4Runner asset once shipped at 28.1 MiB, of which ~24.5 MiB was data
 * the runtime provably never read: 18 MiB of morph targets on the four wheel meshes (every weight
 * zero, and the file contains no animations and no skins to drive them) plus 6.5 MiB of bufferViews
 * referenced by nothing at all. `scripts/optimize-models.mjs` strips both and re-encodes with Draco,
 * taking the file to ~1.2 MiB with every node name, every material name, and the rendered triangle
 * count intact.
 *
 * The budget is the guard against that regressing silently, which is the realistic failure: a
 * re-export from Blender reintroduces the morph targets, the file is committed because it loads
 * fine locally on a fast connection, and mobile users pay 28 MiB again. A failure here means run
 * `node scripts/optimize-models.mjs` (idempotent) before committing the asset — not raise the number.
 */
describe("shipped GLB payload budget", () => {
  const BUDGETS_BYTES: Record<string, number> = {
    // ~1.21 MiB today. Headroom for genuine geometry additions, far below the 28 MiB regression.
    "/models/modsnation_7416_assets_assembled.glb": 3 * 1024 * 1024,
    // ~0.81 MiB today; a minimal FBX2glTF export with one shared material.
    "/models/toyota-ae86-ivofficial.glb": 2 * 1024 * 1024,
    // ~0.48 MiB today; scripts/optimize-models.mjs repackaged the vendor's decoded .gltf+.bin pair
    // (docs/RAV4_PROVENANCE.md §3) into this single binary .glb, same Draco compression.
    "/models/rav4-2024/rav4_2024_limited_decoded.glb": 1.5 * 1024 * 1024,
    // ~2.58 MiB after texture stripping, paint-preserving simplification (1.23M -> 0.61M triangles)
    // and Draco. 3.5 MiB leaves headroom without letting the 3.91 MiB unsimplified asset — or the
    // original 68.36 MiB source payload — regress into production.
    "/models/camry/camry.glb": 3.5 * 1024 * 1024,
    "/models/camry/camry.lod1.glb": 2 * 1024 * 1024,
    "/models/modsnation_7416_assets_assembled.lod1.glb": 1 * 1024 * 1024,
    // ~3.64 MiB after Draco (19.21 MiB Sketchfab source, textures kept). 5 MiB leaves headroom.
    "/models/gr-corolla-2023/gr-corolla.glb": 5 * 1024 * 1024,
    "/models/gr-supra-2024/toyota_gr_supra.glb": 18 * 1024 * 1024,
    // ~3.42 MiB: paint-preserving simplification plus WebP textures (was 4.61 MiB).
    "/models/rav4-hybrid-2023/rav4-hybrid.glb": 4.25 * 1024 * 1024,
    "/models/rav4-hybrid-2023/rav4-hybrid.lod1.glb": 2 * 1024 * 1024,
    // ~4.31 MiB: 1.56M -> 0.73M triangles outside the paint, WebP textures (was 7.37 MiB).
    "/models/land-cruiser-250-2025/land-cruiser-250.glb": 5.25 * 1024 * 1024,
    "/models/land-cruiser-250-2025/land-cruiser-250.lod1.glb": 3 * 1024 * 1024,
  };

  for (const vehicle of VEHICLES) {
    for (const modelUrl of shippedModelUrls(vehicle.threeDConfig)) {
    const filePath = path.join(process.cwd(), "public", modelUrl);
    if (!existsSync(filePath)) continue;

    it(`${vehicle.slug}: ${modelUrl} stays within its download budget`, () => {
      const budget = BUDGETS_BYTES[modelUrl];
      expect(
        budget,
        `${modelUrl} is shipped to browsers but has no entry in BUDGETS_BYTES. Add one rather ` +
          `than deleting this assertion — an unbudgeted asset is how the 28 MiB regression happened.`,
      ).toBeDefined();

      const actual = statSync(filePath).size;
      expect(
        actual,
        `${modelUrl} is ${(actual / 1024 / 1024).toFixed(2)} MiB, over its ` +
          `${(budget / 1024 / 1024).toFixed(2)} MiB budget. Run \`node scripts/optimize-models.mjs\`.`,
      ).toBeLessThanOrEqual(budget);
    });
    }
  }

  // A LOD that is not meaningfully smaller than its source is a download the low tier pays for
  // nothing — the whole point of shipping it.
  for (const vehicle of VEHICLES) {
    const { modelUrl, lodModelUrl } = vehicle.threeDConfig;
    if (!modelUrl || !lodModelUrl) continue;
    it(`${vehicle.slug}: ${lodModelUrl} is smaller than the full asset`, () => {
      const full = statSync(path.join(process.cwd(), "public", modelUrl)).size;
      const lod = statSync(path.join(process.cwd(), "public", lodModelUrl)).size;
      expect(lod).toBeLessThan(full * 0.7);
    });
  }
});

/**
 * The optimizer's own invariant, asserted against the committed asset rather than trusted.
 *
 * Morph targets are the single largest thing `scripts/optimize-models.mjs` removes, and they are also
 * the thing a Blender re-export silently puts back. Checking the file directly means this fails at
 * commit time on the real artifact, not on a description of it.
 */
describe("shipped GLB carries no undrivable morph targets", () => {
  for (const vehicle of VEHICLES) {
    const { modelUrl, hasModel } = vehicle.threeDConfig;
    if (!hasModel || !modelUrl) continue;

    const filePath = path.join(process.cwd(), "public", modelUrl);
    if (!existsSync(filePath)) continue;

    it(`${vehicle.slug}: ${modelUrl}`, () => {
      const { meshes, animations } = readGlbJson(filePath);
      // A file with real blend-shape animation is allowed to keep its targets; the optimizer skips
      // those meshes too. Only assert the dead case this project actually hit.
      if (animations.length > 0) return;

      const withTargets = meshes.filter((mesh) =>
        mesh.primitives.some((primitive) => (primitive.targets?.length ?? 0) > 0),
      );
      expect(
        withTargets.map((mesh) => mesh.name ?? "<unnamed>"),
        `These meshes carry morph targets that no weight and no animation can drive — dead ` +
          `download weight. Run \`node scripts/optimize-models.mjs\`.`,
      ).toEqual([]);
    });
  }
});


describe("hybrid accessories: planned gate + procedural preview", () => {
  it("keeps every plannedFourRunnerOption out of the served 4runner catalog", () => {
    const served = new Set(getOptionsForVehicle("4runner").map((option) => option.id));
    for (const id of plannedOptionIds(plannedFourRunnerOptions)) {
      expect(served.has(id), `${id} must stay out of getOptionsForVehicle until GLB nodes exist`).toBe(
        false,
      );
    }
  });

  it("does not promote planned options against the shipped 4Runner GLB", () => {
    const vehicle = VEHICLES.find((entry) => entry.slug === "4runner")!;
    const filePath = path.join(process.cwd(), "public", vehicle.threeDConfig.modelUrl!);
    const inspection = inspectGlb(filePath);
    expect(plannedOptionsEligibleForCatalog(plannedFourRunnerOptions, inspection)).toEqual([]);
  });

  it("labels every ACCESSORY_* option as procedural-preview", () => {
    for (const vehicle of VEHICLES) {
      for (const option of getOptionsForVehicle(vehicle.slug)) {
        const targets = option.targetNodes ?? [];
        const hitsAccessory = targets.some((name) => SYNTHETIC_NODE_NAMES.has(name));
        if (!hitsAccessory) continue;
        expect(
          isProceduralPreview(option),
          `${option.id} targets procedural ACCESSORY_* nodes and must be labeled procedural-preview`,
        ).toBe(true);
      }
    }
  });

  it("covers every ACCESSORY_* target named in proceduralParts", () => {
    const covered = new Set<string>();
    for (const vehicle of VEHICLES) {
      for (const option of getOptionsForVehicle(vehicle.slug)) {
        for (const name of option.targetNodes ?? []) {
          if (SYNTHETIC_NODE_NAMES.has(name)) covered.add(name);
        }
      }
    }
    expect([...SYNTHETIC_NODE_NAMES].sort()).toEqual([...covered].sort());
  });
});
