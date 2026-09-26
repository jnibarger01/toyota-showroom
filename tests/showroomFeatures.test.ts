import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { VEHICLES } from "../lib/data/vehicles";
import { DoorRig, pickOpeningDirection } from "../lib/three/doors";
import { buildDimensionsOverlay, formatDimension, scaleMismatch } from "../lib/three/dimensions";
import { dimensionSpecsFrom } from "../lib/showroom/dimensionSpecs";
import { DriverLook, driverEyeFromSteeringWheel, EYE_ABOVE_WHEEL, EYE_BEHIND_WHEEL, MAX_PITCH, MAX_YAW } from "../lib/three/interiorView";
import { projectToScreen, resolveHotspotAnchor, selectHotspots, surfaceSamples } from "../lib/three/hotspots";
import { RigidPivot } from "../lib/three/showroomFrame";

describe("showroom frame convention", () => {
  it("every vehicle's front camera preset looks at the nose from −Z", () => {
    // doors.ts, interiorView.ts and dimensions.ts all assume nose −Z; this is what makes that true.
    for (const vehicle of VEHICLES) {
      const front = vehicle.threeDConfig.cameraPresets.find((preset) => preset.id === "front");
      if (!front) continue;
      expect(front.position[2], vehicle.slug).toBeLessThan(front.target[2]);
      expect(Math.abs(front.position[0] - front.target[0]), vehicle.slug).toBeLessThan(0.5);
    }
  });
});

/** A 4.8 m × 1.8 m × 1.4 m "car" in the showroom frame, with a front-left door and a boot lid. */
function carWithDoors() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4.8), new THREE.MeshBasicMaterial());
  body.position.set(0, 0.7, 0);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.1), new THREE.MeshBasicMaterial());
  door.name = "DOOR_FL";
  door.position.set(-0.92, 0.8, -0.6); // left side (−X), front half (−Z)
  const boot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.9), new THREE.MeshBasicMaterial());
  boot.name = "BOOT";
  boot.position.set(0, 1.0, 2.0); // rear (+Z), top
  root.add(body, door, boot);
  root.updateWorldMatrix(true, true);
  return { root, door, boot };
}

const centre = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

describe("DoorRig", () => {
  it("swings a side door outward on its front edge, and a boot lid upward", () => {
    const { root, door, boot } = carWithDoors();
    const doorBefore = centre(door);
    const bootBefore = centre(boot);
    const rig = new DoorRig(root, [
      { id: "fl", label: "Driver door", kind: "side", nodeNames: ["DOOR_FL"] },
      { id: "boot", label: "Trunk", kind: "lid", nodeNames: ["BOOT"] },
      { id: "missing", label: "Nope", kind: "side", nodeNames: ["NOT_THERE"] },
    ]);
    expect(rig.available.map((door) => door.id)).toEqual(["fl", "boot"]);

    rig.setOpenAmount(1);
    root.updateWorldMatrix(true, true);
    expect(centre(door).x).toBeLessThan(doorBefore.x - 0.3); // further out to the left
    // Hinged at the front: the front edge stays put.
    expect(new THREE.Box3().setFromObject(door).min.z).toBeCloseTo(-1.15, 1);
    expect(centre(boot).y).toBeGreaterThan(bootBefore.y + 0.2);

    rig.setOpenAmount(0);
    root.updateWorldMatrix(true, true);
    expect(centre(door).distanceTo(doorBefore)).toBeLessThan(1e-6);
  });

  it("matches door prefixes through GLTFLoader's name sanitizing, topmost nodes only", () => {
    const { root } = carWithDoors();
    const group = new THREE.Group();
    group.name = THREE.PropertyBinding.sanitizeNodeName("T:SK_Door_FL_001");
    const child = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.1), new THREE.MeshBasicMaterial());
    child.name = THREE.PropertyBinding.sanitizeNodeName("T:SK_Door_FL_001_part");
    child.position.set(-0.92, 0.8, -0.6);
    group.add(child);
    root.add(group);
    const rig = new DoorRig(root, [{ id: "fl", label: "Driver door", kind: "side", nodePrefix: "T:SK_Door_FL_" }]);
    const before = centre(child);
    rig.setOpenAmount(1);
    root.updateWorldMatrix(true, true);
    expect(centre(child).x).toBeLessThan(before.x - 0.3);
  });

  it("picks the rotation direction that moves the panel the way the score prefers", () => {
    const angle = pickOpeningDirection(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 1, (p) => p.z);
    // Rotating +x about +y by a negative angle moves it toward +z.
    expect(angle).toBe(-1);
  });

  it("RigidPivot survives the parent moving (ride-height lift)", () => {
    const parent = new THREE.Group();
    const node = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    node.position.set(1, 0, 0);
    parent.add(node);
    parent.updateWorldMatrix(true, true);
    const pivot = new RigidPivot([node], new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    parent.position.y = 0.3;
    pivot.setAngle(Math.PI / 2);
    expect(node.position.x).toBeCloseTo(0, 5);
    expect(Math.abs(node.position.z)).toBeCloseTo(1, 5);
  });
});

describe("driver's-seat view", () => {
  it("puts the eye behind and above the steering wheel, on whichever side the wheel is", () => {
    const lhd = new THREE.Box3(new THREE.Vector3(-0.55, 0.85, -0.6), new THREE.Vector3(-0.2, 1.2, -0.5));
    const eye = driverEyeFromSteeringWheel(lhd);
    expect(eye.x).toBeCloseTo(-0.375, 5); // the wheel's own lateral position: no LHD/RHD flag
    expect(eye.y).toBeCloseTo(1.025 + EYE_ABOVE_WHEEL, 5);
    expect(eye.z).toBeCloseTo(-0.55 + EYE_BEHIND_WHEEL, 5); // behind = toward the rear, +Z
    const rhd = lhd.clone().translate(new THREE.Vector3(0.75, 0, 0));
    expect(driverEyeFromSteeringWheel(rhd).x).toBeGreaterThan(0);
  });

  it("is offered only for vehicles whose config names a steering wheel", () => {
    const offered = VEHICLES.filter((vehicle) => vehicle.threeDConfig.driverView).map((vehicle) => vehicle.slug).sort();
    expect(offered).toEqual(["camry", "gr-supra"]);
  });

  it("looks forward (−Z) by default and clamps head turns", () => {
    const camera = new THREE.PerspectiveCamera();
    const look = new DriverLook(camera, new THREE.Vector3(0, 1.1, 0));
    look.apply();
    expect(camera.getWorldDirection(new THREE.Vector3()).z).toBeLessThan(-0.9);
    look.turnBy(10, 10);
    expect(look.yaw).toBe(MAX_YAW);
    expect(look.pitch).toBe(MAX_PITCH);
  });

});

describe("dimensions overlay", () => {
  it("labels with catalog inches plus millimetres, falling back to the measured size", () => {
    expect(formatDimension(191.3)).toBe("191.3 in · 4,859 mm");
  });

  it("reads the three overall dimensions from real catalog specs", () => {
    const fourRunner = VEHICLES.find((vehicle) => vehicle.slug === "4runner")!;
    const specs = dimensionSpecsFrom(fourRunner.specs);
    expect(specs.map((spec) => spec.inches)).toEqual([191.3, 75.8, 71.5]);
  });

  it("builds non-pickable lines and three anchored labels, and reports scale disagreement", () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-0.96, 0, -2.43), new THREE.Vector3(0.96, 1.82, 2.43));
    const specs = [
      { key: "length" as const, label: "Length", inches: 191.3 },
      { key: "width" as const, label: "Width", inches: 75.8 },
      { key: "height" as const, label: "Height", inches: 71.5 },
    ];
    const { group, labels } = buildDimensionsOverlay(bounds, specs);
    expect(labels.map((label) => label.key)).toEqual(["length", "width", "height"]);
    expect(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(group, true)).toEqual([]);
    const mismatch = scaleMismatch(bounds, specs);
    expect(Math.abs(mismatch.length!)).toBeLessThan(0.01);
    expect(Math.abs(mismatch.height!)).toBeLessThan(0.01);
  });

  it("draws only the dimensions the catalog publishes, never a measured stand-in", () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1.13, 0, -2.45), new THREE.Vector3(1.13, 1.44, 2.45));
    const camry = VEHICLES.find((vehicle) => vehicle.slug === "camry")!;
    const { group, labels } = buildDimensionsOverlay(bounds, dimensionSpecsFrom(camry.specs));
    expect(labels.map((label) => label.text)).toEqual(["Length 193.0 in · 4,902 mm"]);
    const lines = group.children[0] as THREE.LineSegments;
    expect(lines.geometry.getAttribute("position").count).toBe(2);
    expect(buildDimensionsOverlay(bounds, []).labels).toEqual([]);
  });
});

describe("hotspots", () => {
  const parts = [
    { id: "wheel.rear-right", type: "wheel", label: "Rear-right wheel" },
    { id: "wheel.front-left", type: "wheel", label: "Front-left wheel" },
    { id: "body.exterior", type: "body", label: "Exterior paint" },
    { id: "glass.windshield", type: "glass", label: "Windshield" },
    { id: "light.brakelight", type: "light", label: "Brake lights" },
  ];

  it("one per customisable category the vehicle serves, on the most recognisable part", () => {
    const hotspots = selectHotspots(parts, new Set(["wheels", "paint"]));
    expect(hotspots).toEqual([
      { partId: "wheel.front-left", category: "wheels", label: "Front-left wheel" },
      { partId: "body.exterior", category: "paint", label: "Exterior paint" },
    ]);
  });

  it("projects into the viewport and drops points behind the camera", () => {
    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(projectToScreen(new THREE.Vector3(0, 0, 0), camera, 800, 400)).toEqual({ x: 400, y: 200 });
    expect(projectToScreen(new THREE.Vector3(0, 0, 10), camera, 800, 400)).toBeNull();
  });

  it("anchors on the part's visible surface, and hides a part behind another", () => {
    const root = new THREE.Group();
    const near = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    near.position.set(0, 0, 1);
    const far = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    far.position.set(0, 0, -3);
    root.add(near, far);
    root.updateWorldMatrix(true, true);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const anchor = resolveHotspotAnchor(near, root, camera);
    expect(anchor?.z).toBeCloseTo(1.5, 5); // the near face, not the centre
    expect(resolveHotspotAnchor(far, root, camera)).toBeNull();
  });

  const cameraAt = (z: number) => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  };

  it("sees through glass: a seat behind a window still gets its hotspot", () => {
    const root = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshPhysicalMaterial({ transmission: 1 }));
    glass.position.set(0, 0, 2);
    root.add(seat, glass);
    root.updateWorldMatrix(true, true);
    expect(resolveHotspotAnchor(seat, root, cameraAt(6))?.z).toBeCloseTo(0.5, 5);
    // ...and glass that is itself the part (a headlamp lens) anchors on its own surface.
    expect(resolveHotspotAnchor(glass, root, cameraAt(6))?.z).toBeCloseTo(2, 5);
  });

  it("falls back to surface samples when the part's centre is covered (a rim inside its tyre)", () => {
    const root = new THREE.Group();
    // A ring-shaped "rim" around a solid "hub cover" that blocks the rim's own bounds centre.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 24), new THREE.MeshBasicMaterial());
    const cover = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), new THREE.MeshBasicMaterial());
    cover.position.set(0, 0, 0.5);
    root.add(rim, cover);
    root.updateWorldMatrix(true, true);
    const camera = cameraAt(6);
    expect(resolveHotspotAnchor(rim, root, camera)).toBeNull();
    const samples = surfaceSamples(rim);
    expect(samples.length).toBe(12);
    const anchor = resolveHotspotAnchor(rim, root, camera, samples);
    expect(anchor).not.toBeNull();
    expect(Math.hypot(anchor!.x, anchor!.y)).toBeGreaterThan(0.8);
  });
});
