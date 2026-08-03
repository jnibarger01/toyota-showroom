import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { requiredNodeNames, resolveMeshes, resolveNodes, verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { getOptionById, getOptionsForVehicle } from "../lib/data/options";
import { CATEGORY_APPLY_ORDER } from "../lib/types/customization";

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

  it("rejects forward-declared options whose nodes the asset does not contain", () => {
    const { root } = createVehicleFixture();
    const report = verifyNodeContract(root, fourRunnerOptions);
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

  it("accepts an option naming several slots when only some are present", () => {
    // Front wheels carry `wheel.metal` and rear wheels `wheel.metal.001`; an option naming both
    // is satisfied, and would still be if a future export unified them.
    const { root } = createVehicleFixture();
    const report = verifyNodeContract(root, [getOptionById("4runner", "wheels-weisu-satin-black")!]);
    expect(report.satisfied).toHaveLength(1);
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
    const hood = getOptionById("4runner", "hood-sport-scoop")!;
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
