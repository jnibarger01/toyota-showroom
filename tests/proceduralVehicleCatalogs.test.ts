import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createProceduralVehicle, buildProceduralAccessories } from "../lib/three/proceduralParts";
import { verifyNodeContract } from "../lib/three/nodes";
import { VehicleSceneController } from "../lib/three/sceneController";
import { tacomaOptions } from "../lib/data/options/tacoma";
import { camryOptions } from "../lib/data/options/camry";

/**
 * Tacoma and Camry have no GLB in this repo (`threeDConfig.hasModel: false`), so
 * `VehicleCanvas.loadVehicleRoot` renders them via `createProceduralVehicle()` +
 * `buildProceduralAccessories()` — the exact same functions this test calls directly. Their
 * catalogs (lib/data/options/{tacoma,camry}.ts) are written against that fallback's node/material
 * names deliberately, not as forward-declared placeholders; this proves the claim rather than
 * asserting it in a comment, by running the real production code path end to end.
 */

function proceduralScene(): THREE.Object3D {
  const root = createProceduralVehicle();
  buildProceduralAccessories(root);
  return root;
}

describe.each([
  ["tacoma", tacomaOptions],
  ["camry", camryOptions],
])("%s catalog vs. the procedural fallback vehicle", (vehicleSlug, options) => {
  it("has at least one option", () => {
    expect(options.length).toBeGreaterThan(0);
  });

  it("resolves every option — none are silently gated", () => {
    const root = proceduralScene();
    const report = verifyNodeContract(root, options);

    expect(
      report.unsatisfied.map((entry) => ({ id: entry.option.id, missing: entry.missingNodes })),
    ).toEqual([]);
    expect(report.satisfied).toHaveLength(options.length);
  });

  it(`every option is filed under vehicle id "${vehicleSlug}"`, () => {
    for (const option of options) {
      expect(option.compatibleVehicleIds).toContain(vehicleSlug);
    }
  });
});

describe("applying options actually changes the procedural scene", () => {
  it("tacoma: paint and an accessory both take visible effect", async () => {
    const root = proceduralScene();
    const controller = new VehicleSceneController(root, tacomaOptions);

    const red = tacomaOptions.find((o) => o.id === "paint-3u5-barcelona-red")!;
    expect(await controller.applyOption(red)).toBe(true);
    const body = root.getObjectByName("BODY") as THREE.Mesh;
    const paint = (Array.isArray(body.material) ? body.material : [body.material])[0] as THREE.MeshStandardMaterial;
    expect(paint.color.getHexString()).toBe("9d1d20");

    const rack = tacomaOptions.find((o) => o.id === "accessory-roof-rack")!;
    expect(root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(false);
    expect(await controller.applyOption(rack)).toBe(true);
    expect(root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(true);
  });

  it("camry: paint and wheel finish both take visible effect, and no accessory options exist", async () => {
    const root = proceduralScene();
    const controller = new VehicleSceneController(root, camryOptions);

    const underground = camryOptions.find((o) => o.id === "paint-1g3-underground")!;
    expect(await controller.applyOption(underground)).toBe(true);
    const body = root.getObjectByName("BODY") as THREE.Mesh;
    const paint = (Array.isArray(body.material) ? body.material : [body.material])[0] as THREE.MeshStandardMaterial;
    expect(paint.color.getHexString()).toBe("4f545a");

    const glossBlack = camryOptions.find((o) => o.id === "wheels-gloss-black")!;
    expect(await controller.applyOption(glossBlack)).toBe(true);
    const rim = root.getObjectByName("PLACED_WEISU_front_left") as THREE.Mesh;
    const rimMaterial = (Array.isArray(rim.material) ? rim.material : [rim.material])[0] as THREE.MeshStandardMaterial;
    expect(rimMaterial.color.getHexString()).toBe("0e0f11");

    expect(camryOptions.some((o) => o.category === "accessory")).toBe(false);
  });

  it("does not corrupt the shared fallback material across independently-loaded scenes", async () => {
    // Two separate procedural roots (as if two different browser sessions loaded /tacoma), each
    // getting its own controller — a mistake sharing module-level material state would leak a
    // paint change from one into the other.
    const rootA = proceduralScene();
    const rootB = proceduralScene();
    const controllerA = new VehicleSceneController(rootA, tacomaOptions);

    await controllerA.applyOption(tacomaOptions.find((o) => o.id === "paint-0r2-solar-octane")!);

    const bodyB = rootB.getObjectByName("BODY") as THREE.Mesh;
    const paintB = (Array.isArray(bodyB.material) ? bodyB.material : [bodyB.material])[0] as THREE.MeshStandardMaterial;
    // Still the fallback's authored default (#1558d6, Blueprint-ish blue) — untouched by A's write.
    expect(paintB.color.getHexString()).toBe("1558d6");
  });
});
