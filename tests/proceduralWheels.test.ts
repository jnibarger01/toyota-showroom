import path from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { getOptionById, getOptionsForVehicle } from "../lib/data/options";
import { VEHICLES } from "../lib/data/vehicles";
import { allWheelFitments, getWheelFitment } from "../lib/data/wheelFitment";
import { WHEEL_PACKAGES_BY_ID, TIRE_FINISHES } from "../lib/data/wheelPackages";
import {
  buildWheelPackage,
  tiresNodeName,
  wheelsetNodeName,
  TIRE_MATERIAL_NAME,
  WHEEL_MATERIAL_NAME,
  type WheelFitment,
} from "../lib/three/proceduralWheels";
import { installProceduralWheelPackages, resolveCorners } from "../lib/three/installWheels";
import { inspectGlb } from "../lib/tooling/glbInspect";

/**
 * Coverage for the procedural wheel-and-tyre system.
 *
 * The properties worth locking in are the ones that are easy to break silently: that *every*
 * vehicle keeps a working wheel and tyre catalog (the reason this exists — two of the six could not
 * have one at all from their own assets), that a package is measured to the vehicle it is fitted to
 * rather than to a fixed size, and that swapping between a package and the factory wheels always
 * leaves exactly one set of wheels on the car.
 */

function meshesUnder(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  node.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

describe("every vehicle has wheel and tire options", () => {
  for (const vehicle of VEHICLES) {
    it(`${vehicle.slug}: offers wheel packages and sidewall finishes`, () => {
      const options = getOptionsForVehicle(vehicle.slug);
      const fitment = getWheelFitment(vehicle.slug);
      expect(fitment, `${vehicle.slug} needs a fitment entry to be configurable`).toBeDefined();

      const packages = options.filter((option) => option.id.startsWith("wheels-package-"));
      expect(packages.length, `${vehicle.slug} wheel packages`).toBe(fitment!.packageIds.length);
      expect(packages.length).toBeGreaterThanOrEqual(4);

      const sidewalls = options.filter((option) => option.id.startsWith("tire-sidewall-"));
      expect(sidewalls.length, `${vehicle.slug} sidewall finishes`).toBe(TIRE_FINISHES.length);

      // Both sets are in the category the rail labels "Wheels & Tires", and each is its own
      // independently-selectable group.
      expect(new Set([...packages, ...sidewalls].map((option) => option.category))).toEqual(
        new Set(["wheels"]),
      );
      expect(new Set(packages.map((option) => option.selectionGroup))).toEqual(new Set(["wheels"]));
      expect(new Set(sidewalls.map((option) => option.selectionGroup))).toEqual(new Set(["tire-sidewall"]));
    });
  }

  it("offers factory wheels back on every vehicle that has any", () => {
    for (const fitment of allWheelFitments()) {
      const factory = getOptionById(fitment.vehicleId, "wheels-factory");
      if (fitment.stockRunningGearNodes.length === 0) {
        // The RAV4 capture has no wheel geometry at all, so there is no factory wheel to return to.
        expect(factory, `${fitment.vehicleId} has no stock running gear`).toBeUndefined();
        continue;
      }
      expect(factory, `${fitment.vehicleId} must be able to return to its factory wheels`).toBeDefined();
      expect(factory!.hidesNodes).toEqual(fitment.packageIds.map(wheelsetNodeName));
    }
  });

  it("references only packages the shared catalog defines", () => {
    for (const fitment of allWheelFitments()) {
      for (const id of fitment.packageIds) {
        expect(WHEEL_PACKAGES_BY_ID.has(id), `${fitment.vehicleId} -> ${id}`).toBe(true);
      }
    }
  });
});

describe("fitment anchors resolve against the shipped assets", () => {
  for (const fitment of allWheelFitments()) {
    const vehicle = VEHICLES.find((entry) => entry.slug === fitment.vehicleId);
    const modelUrl = vehicle?.threeDConfig.modelUrl;
    if (!vehicle?.threeDConfig.hasModel || !modelUrl) continue;

    const filePath = path.join(process.cwd(), "public", modelUrl);
    if (!existsSync(filePath)) continue;

    it(`${fitment.vehicleId}: every named anchor and stock node exists in ${modelUrl}`, () => {
      const { nodeNames } = inspectGlb(filePath);
      const named = [
        ...(fitment.anchors.kind === "fixed" ? [] : fitment.anchors.nodeNames),
        ...fitment.stockRunningGearNodes,
        ...fitment.stockTireNodes,
      ];
      expect(named.filter((name) => !nodeNames.has(name))).toEqual([]);
    });
  }
});

describe("buildWheelPackage", () => {
  const corners: WheelFitment[] = [
    { position: new THREE.Vector3(0.834, 0.395, 1.527), radius: 0.395, width: 0.225, side: 1 },
    { position: new THREE.Vector3(-0.834, 0.395, 1.527), radius: 0.395, width: 0.225, side: -1 },
    { position: new THREE.Vector3(0.834, 0.395, -1.281), radius: 0.395, width: 0.225, side: 1 },
    { position: new THREE.Vector3(-0.834, 0.395, -1.281), radius: 0.395, width: 0.225, side: -1 },
  ];

  const spec = WHEEL_PACKAGES_BY_ID.get("offroad-beadlock")!;

  it("mounts four assemblies under one hidden, exactly-named group", () => {
    const group = buildWheelPackage(spec, corners);

    expect(group.name).toBe(wheelsetNodeName("offroad-beadlock"));
    expect(group.visible).toBe(false);

    const tires = group.getObjectByName(tiresNodeName("offroad-beadlock"))!;
    expect(tires.children).toHaveLength(4);
    // Four corner groups beside the tyre subgroup.
    expect(group.children.filter((child) => child !== tires)).toHaveLength(4);
  });

  it("exposes the material slots the catalog writes to", () => {
    const names = new Set(meshesUnder(buildWheelPackage(spec, corners)).map((mesh) => mesh.material));
    const materialNames = new Set([...names].map((material) => (material as THREE.Material).name));
    expect(materialNames).toContain(WHEEL_MATERIAL_NAME);
    expect(materialNames).toContain(TIRE_MATERIAL_NAME);
  });

  it("sizes the tyre to the measured fitment and keeps the rim inside it", () => {
    const group = buildWheelPackage(spec, corners);
    const tire = meshesUnder(group.getObjectByName(tiresNodeName("offroad-beadlock"))!)[0]!;
    tire.geometry.computeBoundingBox();
    const size = tire.geometry.boundingBox!.getSize(new THREE.Vector3());

    // Lathed around +Y before the assembly is rotated, so Y is the axle and X/Z the diameter.
    expect(size.x).toBeCloseTo(corners[0].radius * 2, 2);
    expect(size.y).toBeLessThanOrEqual(corners[0].width * 1.01);

    const rim = group.children.find((child) => child.name === "")!;
    const rimBox = new THREE.Box3().setFromObject(rim);
    const rimSize = rimBox.getSize(new THREE.Vector3());
    expect(Math.max(rimSize.x, rimSize.y, rimSize.z)).toBeLessThan(corners[0].radius * 2);
  });

  it("keeps the whole assembly inside the measured envelope", () => {
    // The property that keeps a fitted package off the showroom floor and out of the wheel arch:
    // nothing in the assembly — tread blocks, rim lip, caliper — may reach past the radius the
    // vehicle's own running gear was measured at.
    for (const spec of WHEEL_PACKAGES_BY_ID.values()) {
      const group = buildWheelPackage(spec, corners);
      group.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(group);
      const { radius, position } = corners[0];

      expect(box.min.y, spec.id).toBeGreaterThanOrEqual(position.y - radius - 1e-6);
      expect(box.max.y, spec.id).toBeLessThanOrEqual(position.y + radius + 1e-6);
    }
  });

  it("shares one geometry across corners that measure the same", () => {
    const group = buildWheelPackage(spec, corners);
    const tireGeometries = new Set(
      meshesUnder(group.getObjectByName(tiresNodeName("offroad-beadlock"))!).map((mesh) => mesh.geometry),
    );
    expect(tireGeometries.size).toBe(1);
  });

  it("faces each rim outward", () => {
    const group = buildWheelPackage(spec, corners);
    const assemblies = group.children.filter((child) => child.name === "");
    // Mirrored halves: the +X corners turn one way about Z, the -X corners the other.
    const rotations = assemblies.map((child) => Math.sign(child.rotation.z));
    expect(rotations.filter((value) => value > 0)).toHaveLength(2);
    expect(rotations.filter((value) => value < 0)).toHaveLength(2);
  });
});

describe("resolveCorners", () => {
  it("measures corner nodes in the root's local space, not the world's", () => {
    const root = new THREE.Group();
    // The same treatment `prepareVehicleRoot` gives a Camry/Supra-scale asset.
    root.scale.setScalar(100);
    root.rotation.y = Math.PI;
    root.position.set(3, 1, -2);

    for (const [name, x, z] of [
      ["Wheel1", 0.1, 0.2],
      ["Wheel2", -0.1, 0.2],
      ["Wheel3", 0.1, -0.2],
      ["Wheel4", -0.1, -0.2],
    ] as const) {
      // 0.06 x 0.02 x 0.06: the axle is the smallest extent, the diameter the largest.
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.06));
      wheel.name = name;
      wheel.position.set(x, 0.03, z);
      root.add(wheel);
    }

    const corners = resolveCorners(root, {
      kind: "corner",
      nodeNames: ["Wheel1", "Wheel2", "Wheel3", "Wheel4"],
    });

    expect(corners).toHaveLength(4);
    for (const corner of corners) {
      // Local units throughout — a world-space measurement would be 100x these.
      expect(corner.radius).toBeCloseTo(0.03, 5);
      expect(corner.width).toBeCloseTo(0.02, 5);
      expect(Math.abs(corner.position.x)).toBeCloseTo(0.1, 5);
      expect(corner.position.y).toBeCloseTo(0.03, 5);
    }
    expect(corners.filter((corner) => corner.side === 1)).toHaveLength(2);
    expect(corners.filter((corner) => corner.side === -1)).toHaveLength(2);
  });

  it("clamps a stock wheel node that bundles suspension geometry into its width", () => {
    const root = new THREE.Group();
    // 1.52 x 2.63 x 2.63 — the AE86's real proportions, where the "wheel" mesh is 0.58 as wide as
    // it is tall. Left unclamped this would produce a tyre wider than its own sidewall is tall.
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(1.52, 2.63, 2.63));
    wheel.name = "Wheel1";
    root.add(wheel);

    const [corner] = resolveCorners(root, {
      kind: "corner",
      nodeNames: ["Wheel1", "Wheel1", "Wheel1", "Wheel1"],
    });

    expect(corner.radius).toBeCloseTo(1.315, 3);
    expect(corner.width).toBeCloseTo(1.315 * 0.9, 3);
  });

  it("stands a mount-anchored wheel on the vehicle's own floor", () => {
    const root = new THREE.Group();
    const mount = new THREE.Object3D();
    mount.name = "MOUNT_WHEEL_FRONT_LEFT";
    // The rig's own hub height is deliberately nothing like the derived one.
    mount.position.set(0.834, 0.395, 1.527);
    root.add(mount);

    const [corner] = resolveCorners(root, {
      kind: "mount",
      nodeNames: [
        "MOUNT_WHEEL_FRONT_LEFT",
        "MOUNT_WHEEL_FRONT_LEFT",
        "MOUNT_WHEEL_FRONT_LEFT",
        "MOUNT_WHEEL_FRONT_LEFT",
      ],
      radius: 0.3585,
      width: 0.235,
      floorLocalY: 0.207,
    });

    // Contact patch exactly on the floor `prepareVehicleRoot` grounded the body to.
    expect(corner.position.y - corner.radius).toBeCloseTo(0.207, 6);
    expect(corner.position.x).toBeCloseTo(0.834, 6);
    expect(corner.position.z).toBeCloseTo(1.527, 6);
  });

  it("returns the declared corners verbatim for a fixed fitment", () => {
    const corners = resolveCorners(new THREE.Group(), {
      kind: "fixed",
      corners: [
        [0.00789, 0.01081, -0.01004],
        [-0.00789, 0.01081, -0.01004],
        [0.00789, 0.01081, -0.03822],
        [-0.00789, 0.01081, -0.03822],
      ],
      radius: 0.003355,
      width: 0.00235,
    });

    expect(corners).toHaveLength(4);
    expect(corners.map((corner) => corner.side)).toEqual([1, -1, 1, -1]);
    expect(corners[0].radius).toBeCloseTo(0.003355, 6);
  });
});

describe("swapping running gear in a live scene", () => {
  function makeController() {
    const fixture = createVehicleFixture({ wheelPackages: true });
    const catalog = getOptionsForVehicle("4runner");
    const { satisfied } = verifyNodeContract(fixture.root, catalog);
    return { fixture, controller: new VehicleSceneController(fixture.root, satisfied) };
  }

  const stockWheel = "PLACED_WEISU_front_left";
  const stockTire = "PLACED_KO3_front_left";

  it("mounts every offered package, hidden, alongside the factory wheels", () => {
    const { fixture } = makeController();
    for (const id of getWheelFitment("4runner")!.packageIds) {
      const group = fixture.root.getObjectByName(wheelsetNodeName(id));
      expect(group, id).toBeDefined();
      expect(group!.visible, id).toBe(false);
    }
    expect(fixture.root.getObjectByName(stockWheel)!.visible).toBe(true);
  });

  it("hides the factory running gear when a package is fitted", async () => {
    const { fixture, controller } = makeController();
    const option = getOptionById("4runner", "wheels-package-bronze-forged")!;

    expect(await controller.applyOption(option)).toBe(true);
    expect(fixture.root.getObjectByName(wheelsetNodeName("bronze-forged"))!.visible).toBe(true);
    expect(fixture.root.getObjectByName(stockWheel)!.visible).toBe(false);
    expect(fixture.root.getObjectByName(stockTire)!.visible).toBe(false);
  });

  it("keeps exactly one package visible when swapping between them", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "wheels-package-bronze-forged")!);
    await controller.applyOption(getOptionById("4runner", "wheels-package-sport-machined")!);

    expect(fixture.root.getObjectByName(wheelsetNodeName("sport-machined"))!.visible).toBe(true);
    expect(fixture.root.getObjectByName(wheelsetNodeName("bronze-forged"))!.visible).toBe(false);
  });

  it("restores the factory wheels when they are reselected", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "wheels-package-bronze-forged")!);
    await controller.applyOption(getOptionById("4runner", "wheels-factory")!);

    expect(fixture.root.getObjectByName(stockWheel)!.visible).toBe(true);
    expect(fixture.root.getObjectByName(stockTire)!.visible).toBe(true);
    expect(fixture.root.getObjectByName(wheelsetNodeName("bronze-forged"))!.visible).toBe(false);
  });

  it("gives the factory wheels back when a wheel *finish* replaces a package", async () => {
    // The regression this exists for: a finish is a material write with no `hidesNodes` of its own,
    // so without group-level reversion the package's hide stayed in force and the vehicle was left
    // with no wheels at all — the finish applied to geometry nobody could see.
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "wheels-package-offroad-beadlock")!);
    await controller.applyOption(getOptionById("4runner", "wheels-weisu-machined")!);

    expect(fixture.root.getObjectByName(stockWheel)!.visible).toBe(true);
    expect(fixture.root.getObjectByName(wheelsetNodeName("offroad-beadlock"))!.visible).toBe(false);
  });

  it("restores the loaded vehicle's own visibility before replaying a saved build", async () => {
    const { fixture, controller } = makeController();
    await controller.applyOption(getOptionById("4runner", "wheels-package-offroad-beadlock")!);

    // A configuration that never mentions wheels must not inherit the previous package's hide.
    await controller.applyConfiguration({ paint: ["paint-218-blueprint"] });

    expect(fixture.root.getObjectByName(stockWheel)!.visible).toBe(true);
    expect(fixture.root.getObjectByName(wheelsetNodeName("offroad-beadlock"))!.visible).toBe(false);
  });

  it("replays a saved package without leaving the factory wheels showing", async () => {
    const { fixture, controller } = makeController();
    await controller.applyConfiguration({ wheels: ["wheels-package-sport-machined"] });

    expect(fixture.root.getObjectByName(wheelsetNodeName("sport-machined"))!.visible).toBe(true);
    expect(fixture.root.getObjectByName(stockWheel)!.visible).toBe(false);
  });
});

describe("installProceduralWheelPackages", () => {
  it("mounts nothing, and warns, when the anchors cannot be resolved", () => {
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      // A bare root: none of the 4Runner's `PLACED_KO3_*` anchors exist.
      const root = new THREE.Group();
      expect(installProceduralWheelPackages(root, "4runner")).toEqual([]);
      expect(root.children).toHaveLength(0);
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = original;
    }
  });

  it("does nothing for a vehicle with no fitment entry", () => {
    const root = new THREE.Group();
    expect(installProceduralWheelPackages(root, "not-a-vehicle")).toEqual([]);
    expect(root.children).toHaveLength(0);
  });
});
