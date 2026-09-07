import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { colorHexAt, createVehicleFixture, materialAt } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions, plannedFourRunnerOptions } from "../lib/data/options/4runner";
import { getOptionById } from "../lib/data/options";
import type { SelectionMap } from "../lib/types/customization";
import { FOUR_RUNNER_SCENE_MAP } from "../lib/data/sceneMap/4runner";

function makeController() {
  const fixture = createVehicleFixture();
  const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
  return { fixture, controller: new VehicleSceneController(fixture.root, satisfied) };
}

function makeSemanticController() {
  const fixture = createVehicleFixture();
  const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
  return { fixture, controller: new VehicleSceneController(fixture.root, satisfied, FOUR_RUNNER_SCENE_MAP) };
}

function plannedOption(id: string) {
  return plannedFourRunnerOptions.find((option) => option.id === id)!;
}

describe("material updates", () => {
  it("repaints the targeted slot", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "paint-3u5-barcelona-red")!);

    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("9d1d20");
  });

  it("leaves the other nine slots of the BODY mesh untouched", async () => {
    const { fixture, controller } = makeController();
    const glassBefore = fixture.materials.bodyGlass.color.getHexString();

    await controller.applyOption(getOptionById("4runner", "paint-070-midnight-black")!);

    expect(colorHexAt(fixture.root, "BODY", "glass.windows")).toBe(glassBefore);
    expect(materialAt(fixture.root, "BODY", "glass.windows")).toBe(fixture.materials.bodyGlass);
  });

  it("does not repaint an unrelated mesh that shares the material instance", async () => {
    const { fixture, controller } = makeController();
    const donorBefore = fixture.materials.wheelFront.color.getHexString();

    await controller.applyOption(getOptionById("4runner", "wheels-weisu-bronze")!);

    // The four named wheels changed…
    expect(colorHexAt(fixture.root, "PLACED_WEISU_front_left", "wheel.metal")).toBe("8c6239");
    expect(colorHexAt(fixture.root, "PLACED_WEISU_rear_right", "wheel.metal.001")).toBe("8c6239");
    // …and the donor node, which was sharing the very same instance, did not.
    expect(colorHexAt(fixture.root, "322-1790(MD010)", "wheel.metal")).toBe(donorBefore);
    expect(fixture.materials.wheelFront.color.getHexString()).toBe(donorBefore);
  });

  it("updates all four tyres while sparing the donor tyre", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "trim-tire-letters-raised-white")!);

    for (const node of [
      "PLACED_KO3_front_left",
      "PLACED_KO3_front_right",
      "PLACED_KO3_rear_left",
      "PLACED_KO3_rear_right",
    ]) {
      expect(colorHexAt(fixture.root, node, "tire.sidewall"), node).toBe("6f6f6c");
    }
    expect(colorHexAt(fixture.root, "BFGoodrich_ALL_Terrain_TA_KO2", "tire.sidewall")).toBe("111214");
  });

  it("applies the full physical material config, not only colour", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "paint-1j9-ice-cap")!);

    const material = materialAt(fixture.root, "BODY", "body.carmain") as THREE.MeshPhysicalMaterial;
    expect(material.metalness).toBeCloseTo(0.35);
    expect(material.roughness).toBeCloseTo(0.35);
    expect(material.clearcoat).toBeCloseTo(1);
    // `needsUpdate` is a write-only setter in three.js; it bumps `version`, which is what the
    // renderer actually reads to know the program must be recompiled.
    expect(material.version).toBeGreaterThan(0);
  });
});

describe("resource growth", () => {
  it("clones each written slot once, however many times the option changes", async () => {
    const { controller } = makeController();
    const paints = [
      "paint-218-blueprint",
      "paint-070-midnight-black",
      "paint-3u5-barcelona-red",
      "paint-1g3-underground",
    ];

    for (let pass = 0; pass < 8; pass++) {
      for (const id of paints) {
        await controller.applyOption(getOptionById("4runner", id)!);
      }
    }

    // 32 paint changes, one cloned slot: BODY's `body.carmain`.
    expect(controller.clonedMaterialCount).toBe(1);
  });

  it("does not duplicate meshes when an accessory is toggled repeatedly", async () => {
    const { fixture, controller } = makeController();
    const option = getOptionById("4runner", "accessory-roof-rack")!;
    const countMeshes = () => {
      let total = 0;
      fixture.root.traverse((object) => {
        if (object instanceof THREE.Mesh) total++;
      });
      return total;
    };

    const before = countMeshes();
    for (let i = 0; i < 10; i++) {
      await controller.applyOption(option);
      await controller.removeOption(option);
    }
    expect(countMeshes()).toBe(before);
  });
});

describe("visibility operations", () => {
  it("shows and hides the targeted group", async () => {
    const { fixture, controller } = makeController();
    const option = getOptionById("4runner", "accessory-light-bar")!;
    const node = () => fixture.root.getObjectByName("ACCESSORY_LIGHT_BAR")!;

    expect(node().visible).toBe(false);
    await controller.applyOption(option);
    expect(node().visible).toBe(true);
    await controller.removeOption(option);
    expect(node().visible).toBe(false);
  });

  it("hides the variant an option displaces", async () => {
    const fixture = createVehicleFixture();
    for (const name of ["HOOD_STOCK", "HOOD_SPORT"]) {
      const hood = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      hood.name = name;
      fixture.root.add(hood);
    }
    const controller = new VehicleSceneController(fixture.root, plannedFourRunnerOptions);

    await controller.applyOption(plannedOption("hood-sport-scoop"));
    expect(fixture.root.getObjectByName("HOOD_SPORT")!.visible).toBe(true);
    expect(fixture.root.getObjectByName("HOOD_STOCK")!.visible).toBe(false);

    await controller.applyOption(plannedOption("hood-stock"));
    expect(fixture.root.getObjectByName("HOOD_STOCK")!.visible).toBe(true);
    expect(fixture.root.getObjectByName("HOOD_SPORT")!.visible).toBe(false);
  });

  it("reports failure instead of silently succeeding when nodes are absent", async () => {
    const { controller } = makeController();
    const applied = await controller.applyOption(plannedOption("hood-sport-scoop"));
    expect(applied).toBe(false);
  });
});

describe("applyConfiguration", () => {
  it("applies selections in deterministic category order", async () => {
    const { fixture, controller } = makeController();
    const selections: SelectionMap = {
      accessory: ["accessory-roof-rack", "accessory-rock-sliders"],
      paint: ["paint-0r2-solar-octane"],
      trim: ["trim-grille-blackout"],
      wheels: ["wheels-weisu-satin-black"],
    };

    const { applied, failed } = await controller.applyConfiguration(selections);

    expect(failed).toEqual([]);
    // Insertion order of the map above is trim-last; the applier reorders to the canonical sequence.
    expect(applied).toEqual([
      "trim-grille-blackout",
      "wheels-weisu-satin-black",
      "paint-0r2-solar-octane",
      "accessory-roof-rack",
      "accessory-rock-sliders",
    ]);
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("ff6a1a");
    expect(fixture.root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(true);
  });

  it("is idempotent: reapplying the same map yields the same scene", async () => {
    const { fixture, controller } = makeController();
    const selections: SelectionMap = { paint: ["paint-218-blueprint"], accessory: ["accessory-light-bar"] };

    await controller.applyConfiguration(selections);
    const cloneCountAfterFirst = controller.clonedMaterialCount;
    await controller.applyConfiguration(selections);

    expect(controller.clonedMaterialCount).toBe(cloneCountAfterFirst);
    expect(fixture.root.getObjectByName("ACCESSORY_LIGHT_BAR")!.visible).toBe(true);
  });

  it("clears accessories that the incoming configuration does not list", async () => {
    const { fixture, controller } = makeController();

    await controller.applyConfiguration({ accessory: ["accessory-roof-rack", "accessory-light-bar"] });
    expect(fixture.root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(true);

    await controller.applyConfiguration({ accessory: ["accessory-light-bar"] });
    expect(fixture.root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(false);
    expect(fixture.root.getObjectByName("ACCESSORY_LIGHT_BAR")!.visible).toBe(true);
  });

  it("reports unknown option ids as failures", async () => {
    const { controller } = makeController();
    const { failed } = await controller.applyConfiguration({ paint: ["paint-does-not-exist"] });
    expect(failed).toEqual(["paint-does-not-exist"]);
  });
});

describe("disposal", () => {
  it("restores original materials and releases clones", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "paint-3u5-barcelona-red")!);
    expect(controller.clonedMaterialCount).toBe(1);

    controller.dispose();
    expect(controller.clonedMaterialCount).toBe(0);
    // The GLB-supplied instance was never mutated, so it still holds its authored colour.
    expect(fixture.materials.bodyPaint.color.getHexString()).toBe("1558d6");
  });
});

describe("semantic parts", () => {
  it("resolves registered parts and reports the ones this fixture cannot satisfy", () => {
    const { controller } = makeSemanticController();

    expect(controller.hasPart("wheel.front-left")).toBe(true);
    expect(controller.getPart("body.exterior")?.type).toBe("body");
    expect(controller.findPartsByType("wheel")).toHaveLength(4);
    expect(controller.findPartsByCapability("paintable").map((p) => p.id)).toContain("body.exterior");

    // The fixture's BODY mesh has no separate door/mirror/badge/roof/interior geometry.
    expect(controller.hasPart("door.front-left")).toBe(false);
    expect(controller.sceneMapReport.unsatisfied.map((u) => u.entry.id)).toContain("door.front-left");
  });

  it("a controller built with no scene map has no addressable parts (back-compat default)", () => {
    const { controller } = makeController();
    expect(controller.listParts()).toHaveLength(0);
    expect(controller.hasPart("body.exterior")).toBe(false);
  });
});

describe("hover and selection highlighting", () => {
  it("tints only the selected part's mesh, not a sibling sharing the same material", () => {
    const { fixture, controller } = makeSemanticController();
    const donorBefore = fixture.materials.wheelFront.color.getHexString();

    controller.selectPart("wheel.front-left");

    expect(controller.selectedPartId).toBe("wheel.front-left");
    const selectedMaterial = materialAt(fixture.root, "PLACED_WEISU_front_left", "wheel.metal") as THREE.MeshStandardMaterial;
    expect(selectedMaterial.emissive.getHexString()).toBe("ffb000");
    // front-right shares the exact same original material instance in the fixture; it must be untouched.
    const siblingMaterial = materialAt(fixture.root, "PLACED_WEISU_front_right", "wheel.metal") as THREE.MeshStandardMaterial;
    expect(siblingMaterial.emissive.getHexString()).toBe("000000");
    expect(fixture.materials.wheelFront.color.getHexString()).toBe(donorBefore);
  });

  it("selection takes precedence over hover on the same part, and clearing selection falls back to the hover tint", () => {
    const { fixture, controller } = makeSemanticController();

    controller.hoverPart("wheel.front-left");
    controller.selectPart("wheel.front-left");
    let material = materialAt(fixture.root, "PLACED_WEISU_front_left", "wheel.metal") as THREE.MeshStandardMaterial;
    expect(material.emissive.getHexString()).toBe("ffb000"); // "selected" tint wins

    controller.clearSelection();
    material = materialAt(fixture.root, "PLACED_WEISU_front_left", "wheel.metal") as THREE.MeshStandardMaterial;
    expect(material.emissive.getHexString()).toBe("3d7dff"); // still hovered
  });

  it("clearing hover restores the mesh's material to its pre-highlight state, not the GLB original", async () => {
    const { fixture, controller } = makeSemanticController();
    // Repaint first — the mesh's "current" material is now a MaterialWriter clone whose base
    // colour is the new paint, not the GLB-authored blue.
    await controller.applyOption(getOptionById("4runner", "paint-3u5-barcelona-red")!);
    const repaintedColor = colorHexAt(fixture.root, "BODY", "body.carmain");
    expect(repaintedColor).toBe("9d1d20");

    controller.hoverPart("body.exterior");
    const tinted = materialAt(fixture.root, "BODY", "body.carmain") as THREE.MeshStandardMaterial;
    expect(tinted.emissive.getHexString()).toBe("3d7dff"); // hover tint applied
    expect(tinted.color.getHexString()).toBe(repaintedColor); // base colour untouched by the tint

    controller.hoverPart(undefined);
    const restored = materialAt(fixture.root, "BODY", "body.carmain") as THREE.MeshStandardMaterial;
    expect(restored.emissive.getHexString()).toBe("000000");
    // Restored to the *repainted* material, not the pristine GLB original.
    expect(restored.color.getHexString()).toBe(repaintedColor);
    expect(fixture.materials.bodyPaint.color.getHexString()).toBe("1558d6"); // GLB original, never touched
  });

  it("a part with no highlightable capability is not tinted", () => {
    const { fixture, controller } = makeSemanticController();
    controller.selectPart("tire.front-left"); // capabilities: ["selectable", "tire"] — no "highlightable"

    expect(controller.selectedPartId).toBe("tire.front-left");
    const material = materialAt(fixture.root, "PLACED_KO3_front_left", "tire.sidewall") as THREE.MeshStandardMaterial;
    expect(material.emissive.getHexString()).toBe("000000");
  });

  it("selecting an unknown id is a safe no-op", () => {
    const { controller } = makeSemanticController();
    controller.selectPart("does-not-exist");
    expect(controller.selectedPartId).toBe("does-not-exist");
    controller.clearSelection();
    expect(controller.selectedPartId).toBeUndefined();
  });

  it("applyConfiguration clears any active highlight so it cannot leak a stale material clone", async () => {
    const { fixture, controller } = makeSemanticController();
    controller.selectPart("body.exterior");
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).not.toBeUndefined();

    await controller.applyConfiguration({ paint: ["paint-3u5-barcelona-red"] });

    expect(controller.selectedPartId).toBeUndefined();
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("9d1d20");
  });

  it("dispose() clears highlights before tearing down the scene", () => {
    const { controller } = makeSemanticController();
    controller.selectPart("wheel.front-left");
    expect(() => controller.dispose()).not.toThrow();
    expect(controller.selectedPartId).toBeUndefined();
  });
});
