import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { requiredNodeNames, resolveMeshes, resolveNodes, verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions, plannedFourRunnerOptions } from "../lib/data/options/4runner";
import { getOptionById, getOptionsForVehicle } from "../lib/data/options";
import {
  plannedOptionIds,
  plannedOptionsEligibleForCatalog,
} from "../lib/data/options/plannedGate";
import { CATEGORY_APPLY_ORDER, isProceduralPreview } from "../lib/types/customization";

describe("option → node mapping", () => {
  it("resolves every targeted node by exact name", () => {
    const { root } = createVehicleFixture();
    const paint = getOptionById("4runner", "paint-218-blueprint")!;

    const { found, missing } = resolveNodes(root, paint.targetNodes!);
    expect(missing).toEqual([]);
    expect(found.map((node) => node.name)).toEqual(["BODY"]);
  });

  it("is unaffected by child order", () => {
    const { root } = createVehicleFixture();
    const body = root.getObjectByName("BODY")!;
    const before = resolveMeshes(root, ["PLACED_WEISU_rear_right"])[0];

    body.children.reverse();

    const after = resolveMeshes(root, ["PLACED_WEISU_rear_right"])[0];
    expect(after).toBe(before);
  });

  it("resolves a named group to every mesh beneath it", () => {
    const { root } = createVehicleFixture();
    const meshes = resolveMeshes(root, ["ACCESSORY_ROOF_RACK"]);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].name).toBe("ACCESSORY_ROOF_RACK_RAIL");
  });

  it("reports missing nodes rather than silently resolving nothing", () => {
    const { root } = createVehicleFixture();
    const { found, missing } = resolveNodes(root, ["BODY", "HOOD_SPORT"]);
    expect(found.map((n) => n.name)).toEqual(["BODY"]);
    expect(missing).toEqual(["HOOD_SPORT"]);
  });
});

describe("verifyNodeContract", () => {
  it("admits every option whose nodes and materials exist in the asset", () => {
    const { root } = createVehicleFixture();
    const report = verifyNodeContract(root, fourRunnerOptions);
    const satisfiedIds = report.satisfied.map((option) => option.id);

    expect(satisfiedIds).toContain("paint-218-blueprint");
    expect(satisfiedIds).toContain("wheels-weisu-bronze");
    expect(satisfiedIds).toContain("trim-grille-blackout");
    expect(satisfiedIds).toContain("accessory-roof-rack");
  });

  it("rejects planned options whose nodes the asset does not contain", () => {
    const { root } = createVehicleFixture();
    const report = verifyNodeContract(root, plannedFourRunnerOptions);
    const unsatisfied = new Map(report.unsatisfied.map((entry) => [entry.option.id, entry]));

    expect(unsatisfied.get("hood-sport-scoop")?.missingNodes).toEqual(["HOOD_SPORT", "HOOD_STOCK"]);
    expect(unsatisfied.get("decal-trd-side-stripe")?.missingNodes).toEqual([
      "DECAL_DRIVER",
      "DECAL_PASSENGER",
    ]);
  });

  it("flags an option whose node exists but whose material slot does not", () => {
    const { root } = createVehicleFixture();
    const report = verifyNodeContract(root, [
      {
        id: "paint-wrong-slot",
        category: "paint",
        label: "Wrong slot",
        operation: "material-update",
        targetNodes: ["BODY"],
        targetMaterials: ["body.doesnotexist"],
        materialConfig: { color: "#ffffff" },
        compatibleVehicleIds: ["4runner"],
      },
    ]);

    expect(report.satisfied).toHaveLength(0);
    expect(report.unsatisfied[0].missingMaterials).toEqual(["body.doesnotexist"]);
  });

  it("rejects an option when any named material slot is absent", () => {
    const { root } = createVehicleFixture();
    const option = {
      ...getOptionById("4runner", "wheels-weisu-satin-black")!,
      targetMaterials: ["wheel.metal", "wheel.missing"],
    };
    const report = verifyNodeContract(root, [option]);

    expect(report.satisfied).toHaveLength(0);
    expect(report.unsatisfied[0]?.missingMaterials).toEqual(["wheel.missing"]);
  });
});

describe("catalog integrity", () => {
  const options = getOptionsForVehicle("4runner");

  it("uses unique, stable ids", () => {
    const ids = options.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares a known category for every option", () => {
    for (const option of options) {
      expect(CATEGORY_APPLY_ORDER).toContain(option.category);
    }
  });

  it("lists itself as compatible with the vehicle it is filed under", () => {
    for (const option of options) {
      expect(option.compatibleVehicleIds).toContain("4runner");
    }
  });

  it("gives every material-update option both a target and a config", () => {
    for (const option of options.filter((o) => o.operation === "material-update")) {
      expect(option.targetNodes?.length, option.id).toBeGreaterThan(0);
      expect(option.materialConfig, option.id).toBeDefined();
    }
  });

  it("never carries an absolute or protocol-relative asset URL", () => {
    for (const option of options) {
      if (option.assetUrl) expect(option.assetUrl.startsWith("/")).toBe(true);
      if (option.materialConfig?.textureUrl) {
        expect(option.materialConfig.textureUrl.startsWith("/")).toBe(true);
      }
    }
  });

  it("requires every node an option needs to be listed for verification", () => {
    const hood = plannedFourRunnerOptions.find((option) => option.id === "hood-sport-scoop")!;
    expect(requiredNodeNames(hood).sort()).toEqual(["HOOD_SPORT", "HOOD_STOCK"]);
  });
});

describe("fixture faithfulness", () => {
  it("models BODY as a multi-material mesh", () => {
    const { root } = createVehicleFixture();
    const body = root.getObjectByName("BODY") as THREE.Mesh;
    expect(Array.isArray(body.material)).toBe(true);
    expect((body.material as THREE.Material[]).length).toBe(10);
  });

  it("shares one material instance between the front wheels and the donor node", () => {
    const { root, materials } = createVehicleFixture();
    const front = root.getObjectByName("PLACED_WEISU_front_left") as THREE.Mesh;
    const donor = root.getObjectByName("322-1790(MD010)") as THREE.Mesh;
    expect(front.material).toBe(materials.wheelFront);
    expect(donor.material).toBe(materials.wheelFront);
  });
});


describe("hybrid accessories catalog contract", () => {
  it("never serves planned option ids through getOptionsForVehicle", () => {
    const served = new Set(getOptionsForVehicle("4runner").map((o) => o.id));
    expect(plannedOptionIds(plannedFourRunnerOptions).some((id) => served.has(id))).toBe(false);
  });

  it("marks accessory options as procedural-preview while paint stays catalog", () => {
    const rack = getOptionById("4runner", "accessory-roof-rack")!;
    const paint = getOptionById("4runner", "paint-218-blueprint")!;
    expect(isProceduralPreview(rack)).toBe(true);
    expect(isProceduralPreview(paint)).toBe(false);
  });

  it("maps every procedural accessory target to ACCESSORY_* nodes", () => {
    const accessories = getOptionsForVehicle("4runner").filter((o) => o.category === "accessory");
    expect(accessories.length).toBeGreaterThan(0);
    for (const option of accessories) {
      expect(isProceduralPreview(option)).toBe(true);
      expect(option.targetNodes?.every((name) => name.startsWith("ACCESSORY_"))).toBe(true);
    }
  });

  it("promotion gate admits a planned option only when its GLB targets exist", () => {
    const empty = plannedOptionsEligibleForCatalog(plannedFourRunnerOptions, {
      nodeNames: new Set(),
      materialsByNode: new Map(),
    });
    expect(empty).toEqual([]);

    const withHood = plannedOptionsEligibleForCatalog(plannedFourRunnerOptions, {
      nodeNames: new Set(["HOOD_STOCK", "HOOD_SPORT"]),
      materialsByNode: new Map(),
    });
    expect(withHood.map((o) => o.id).sort()).toEqual(["hood-sport-scoop", "hood-stock"]);
  });
});
