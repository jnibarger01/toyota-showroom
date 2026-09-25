import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleFixture, colorHexAt, materialAt } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { getOptionById, getOptionsForVehicle } from "../lib/data/options";
import { VEHICLES } from "../lib/data/vehicles";
import { PAINT_FINISHES, PAINT_FINISH_GROUP, paintFinishOptionId } from "../lib/data/paintFinishes";
import { PAINT_CUSTOM_OPTION_ID, defaultPaintStudioCustom } from "../lib/data/paintStudio";
import { selectionGroupOf, withOptionSelected } from "../lib/types/customization";

/**
 * Coverage for the paint program: finishes that compose with any colour, and a Paint Studio that
 * works on every vehicle rather than on the one whose material names were hardcoded.
 */

describe("every vehicle has a full paint offering", () => {
  for (const vehicle of VEHICLES) {
    it(`${vehicle.slug}: colours, finishes and the Paint Studio`, () => {
      const options = getOptionsForVehicle(vehicle.slug);
      const paint = options.filter((option) => option.category === "paint");

      const colours = paint.filter(
        (option) => option.id !== PAINT_CUSTOM_OPTION_ID && selectionGroupOf(option) !== PAINT_FINISH_GROUP,
      );
      const finishes = paint.filter((option) => selectionGroupOf(option) === PAINT_FINISH_GROUP);

      expect(colours.length, `${vehicle.slug} colours`).toBeGreaterThan(0);
      expect(finishes.length, `${vehicle.slug} finishes`).toBe(PAINT_FINISHES.length);
      expect(
        paint.some((option) => option.id === PAINT_CUSTOM_OPTION_ID),
        `${vehicle.slug} must offer the Paint Studio`,
      ).toBe(true);
    });

    it(`${vehicle.slug}: generated paint targets match the vehicle's own colours`, () => {
      // The whole point of borrowing targets rather than sharing a constant: the Camry paints
      // `CarPaint`, the AE86 `Body`, the Supra `Paint`. A finish that wrote the 4Runner's slot
      // names would resolve nothing on five of the eight vehicles and silently do nothing.
      const options = getOptionsForVehicle(vehicle.slug);
      const colour = options.find(
        (option) =>
          option.category === "paint" &&
          option.id !== PAINT_CUSTOM_OPTION_ID &&
          selectionGroupOf(option) !== PAINT_FINISH_GROUP,
      )!;
      const generated = options.filter(
        (option) =>
          option.id === PAINT_CUSTOM_OPTION_ID || selectionGroupOf(option) === PAINT_FINISH_GROUP,
      );

      for (const option of generated) {
        expect(option.targetNodes, `${vehicle.slug} ${option.id} nodes`).toEqual(colour.targetNodes);
        expect(option.targetMaterials, `${vehicle.slug} ${option.id} materials`).toEqual(colour.targetMaterials);
      }
    });
  }

  it("never gives a finish a colour of its own", () => {
    // This is the mechanism, not a detail: `applyMaterialConfig` writes only defined fields, so an
    // absent `color` is what lets a finish repaint the surface and leave the colour alone.
    for (const vehicle of VEHICLES) {
      for (const option of getOptionsForVehicle(vehicle.slug)) {
        if (selectionGroupOf(option) !== PAINT_FINISH_GROUP) continue;
        expect(option.materialConfig?.color, `${vehicle.slug} ${option.id}`).toBeUndefined();
      }
    }
  });

  it("keeps the 4Runner's hand-written studio entry rather than shadowing it", () => {
    const matches = getOptionsForVehicle("4runner").filter((option) => option.id === PAINT_CUSTOM_OPTION_ID);
    expect(matches).toHaveLength(1);
  });
});

describe("colour and finish compose in the scene", () => {
  function makeController() {
    const fixture = createVehicleFixture();
    const catalog = getOptionsForVehicle("4runner");
    const { satisfied } = verifyNodeContract(fixture.root, catalog);
    return { fixture, catalog, controller: new VehicleSceneController(fixture.root, satisfied) };
  }

  const RED = "9d1d20";
  const colourId = "paint-3u5-barcelona-red";
  const matteId = paintFinishOptionId("matte");
  const matte = PAINT_FINISHES.find((finish) => finish.id === "matte")!;

  function surfaceAt(fixture: ReturnType<typeof createVehicleFixture>) {
    const material = materialAt(fixture.root, "BODY", "body.carmain") as import("three").MeshPhysicalMaterial;
    return { roughness: material.roughness, metalness: material.metalness, clearcoat: material.clearcoat };
  }

  it("applies the finish over the colour when the finish is clicked second", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", colourId)!);
    await controller.applyOption(getOptionById("4runner", matteId)!);

    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe(RED);
    expect(surfaceAt(fixture).roughness).toBeCloseTo(matte.surface.roughness!, 5);
  });

  it("keeps the finish when the colour is clicked second", async () => {
    // The ordering case that needs `reapplyDependentGroups`: a colour carries its own metalness and
    // roughness, so without it the colour silently reverts the finish to gloss.
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", matteId)!);
    await controller.applyOption(getOptionById("4runner", colourId)!);

    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe(RED);
    expect(surfaceAt(fixture).roughness).toBeCloseTo(matte.surface.roughness!, 5);
    expect(surfaceAt(fixture).clearcoat).toBeCloseTo(matte.surface.clearcoat!, 5);
  });

  it("restores a saved build the same way whichever order it was recorded in", async () => {
    // `applyConfiguration` orders a category's ids by the catalog, so these two maps — identical
    // sets, opposite order — have to land in the same place.
    const first = makeController();
    await first.controller.applyConfiguration({ paint: [colourId, matteId] });

    const second = makeController();
    await second.controller.applyConfiguration({ paint: [matteId, colourId] });

    expect(colorHexAt(first.fixture.root, "BODY", "body.carmain")).toBe(RED);
    expect(colorHexAt(second.fixture.root, "BODY", "body.carmain")).toBe(RED);
    expect(surfaceAt(second.fixture).roughness).toBeCloseTo(surfaceAt(first.fixture).roughness!, 5);
    expect(surfaceAt(second.fixture).clearcoat).toBeCloseTo(surfaceAt(first.fixture).clearcoat!, 5);
  });

  it("swaps one finish for another without disturbing the colour", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", colourId)!);
    await controller.applyOption(getOptionById("4runner", matteId)!);
    await controller.applyOption(getOptionById("4runner", paintFinishOptionId("pearl"))!);

    const pearl = PAINT_FINISHES.find((finish) => finish.id === "pearl")!;
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe(RED);
    expect(surfaceAt(fixture).roughness).toBeCloseTo(pearl.surface.roughness!, 5);
  });

  it("keeps colour and finish as separate selections", () => {
    const catalog = getOptionsForVehicle("4runner");
    let selections = withOptionSelected({}, getOptionById("4runner", matteId)!, catalog);
    selections = withOptionSelected(selections, getOptionById("4runner", colourId)!, catalog);

    expect(selections.paint).toContain(matteId);
    expect(selections.paint).toContain(colourId);

    // …but one finish at a time, and one colour at a time.
    selections = withOptionSelected(selections, getOptionById("4runner", paintFinishOptionId("satin"))!, catalog);
    expect(selections.paint).not.toContain(matteId);
    expect(selections.paint).toContain(colourId);
  });
});

describe("the Paint Studio resolves per vehicle", () => {
  it("writes the 4Runner's own paint slot", () => {
    const fixture = createVehicleFixture();
    const catalog = getOptionsForVehicle("4runner");
    const { satisfied } = verifyNodeContract(fixture.root, catalog);
    const controller = new VehicleSceneController(fixture.root, satisfied);

    expect(
      controller.applyPaintStudio(defaultPaintStudioCustom({
        color: "#22c55e",
        metalness: 0.3,
        roughness: 0.4,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
      })),
    ).toBe(true);
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("22c55e");
  });

  it("writes a vehicle whose paint slot is named nothing like the 4Runner's", () => {
    // The Camry paints `CarPaint` on `CAMRY_EX_*` nodes. Against the old hardcoded
    // `BODY`/`body.carmain` constants this resolved no meshes and returned false — the studio was
    // offered on one vehicle because it only ever worked on one.
    const catalog = getOptionsForVehicle("camry");
    const camryPaint = catalog.find((option) => option.id === PAINT_CUSTOM_OPTION_ID)!;

    // Every node the Camry's paint option names, so `verifyNodeContract` keeps the option — a
    // partial fixture would drop it and the assertion below would pass for the wrong reason.
    const root = new THREE.Group();
    root.name = "VEHICLE_ROOT";
    for (const name of camryPaint.targetNodes ?? []) {
      const paint = new THREE.MeshPhysicalMaterial({ color: "#111111" });
      paint.name = "CarPaint";
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
      mesh.name = name;
      root.add(mesh);
    }

    const { satisfied } = verifyNodeContract(root, catalog);
    const controller = new VehicleSceneController(root, satisfied);

    expect(
      controller.applyPaintStudio(defaultPaintStudioCustom({
        color: "#22c55e",
        metalness: 0.3,
        roughness: 0.4,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
      })),
    ).toBe(true);
    expect(colorHexAt(root, "CAMRY_EX_CARBODY_MESH_CarPaint_0", "CarPaint")).toBe("22c55e");
  });
});
