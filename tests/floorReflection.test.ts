import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FloorReflection } from "../lib/three/floorReflection";
import { EnvironmentController } from "../lib/three/environmentController";
import { qualitySettingsFor } from "../lib/three/quality";

function vehicle() {
  const root = new THREE.Group();
  root.name = "VEHICLE_ROOT";
  const body = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ name: "paint" }));
  body.name = "BODY";
  body.castShadow = true;
  const mount = new THREE.Group();
  mount.name = "WHEEL_MOUNT";
  root.add(body, mount);
  return { root, body, mount };
}

function mirrorOf(reflection: FloorReflection, name: string): THREE.Object3D {
  return reflection.group.getObjectByName(name)!;
}

describe("FloorReflection", () => {
  it("mirrors about the floor plane and shares geometry instead of copying it", () => {
    const { root, body } = vehicle();
    const reflection = new FloorReflection();
    reflection.setSource(root);
    reflection.setEnabled(true);
    expect(reflection.group.scale.y).toBe(-1);
    const mirrored = mirrorOf(reflection, "BODY") as THREE.Mesh;
    expect(mirrored).not.toBe(body);
    expect(mirrored.geometry).toBe(body.geometry);
    expect(reflection.group.visible).toBe(true);
  });

  it("follows material swaps, visibility and lift on every sync", () => {
    const { root, body } = vehicle();
    const reflection = new FloorReflection();
    reflection.setSource(root);
    reflection.setEnabled(true);

    // What MaterialWriter does on a repaint: replace the mesh's material reference with a clone.
    const repainted = new THREE.MeshPhysicalMaterial({ color: "#9d1d20" });
    body.material = repainted;
    body.visible = false;
    root.position.y = 0.2;
    reflection.sync();

    const mirrored = mirrorOf(reflection, "BODY") as THREE.Mesh;
    expect(mirrored.material).toBe(repainted);
    expect(mirrored.visible).toBe(false);
    expect(mirrorOf(reflection, "FLOOR_REFLECTION_ROOT").position.y).toBeCloseTo(0.2);
  });

  it("rebuilds when a mesh replacement adds children under a mount", () => {
    const { root, mount } = vehicle();
    const reflection = new FloorReflection();
    reflection.setSource(root);
    reflection.setEnabled(true);
    const before = reflection.mirroredNodeCount;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(), new THREE.MeshStandardMaterial());
    wheel.name = "REPLACEMENT_WHEEL";
    mount.add(wheel);
    reflection.sync();
    expect(reflection.mirroredNodeCount).toBe(before + 1);
    expect(mirrorOf(reflection, "REPLACEMENT_WHEEL")).toBeDefined();
  });

  it("is never picked and never casts a second shadow", () => {
    const { root } = vehicle();
    const reflection = new FloorReflection();
    reflection.setSource(root);
    reflection.setEnabled(true);
    const mirrored = mirrorOf(reflection, "BODY") as THREE.Mesh;
    expect(mirrored.castShadow).toBe(false);
    reflection.group.updateMatrixWorld(true);
    const hits = new THREE.Raycaster(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0)).intersectObject(reflection.group, true);
    expect(hits).toEqual([]);
  });

  it("stays hidden and skips syncing while disabled", () => {
    const { root, body } = vehicle();
    const reflection = new FloorReflection();
    reflection.setSource(root);
    expect(reflection.group.visible).toBe(false);
    body.material = new THREE.MeshBasicMaterial();
    reflection.sync();
    expect((mirrorOf(reflection, "BODY") as THREE.Mesh).material).not.toBe(body.material);
  });

  it("is a high-tier-only feature", () => {
    expect(qualitySettingsFor("high").floorReflection).toBe(true);
    expect(qualitySettingsFor("medium").floorReflection).toBe(false);
    expect(qualitySettingsFor("low").floorReflection).toBe(false);
  });
});

describe("EnvironmentController.setFloorReflective", () => {
  it("makes the floor translucent only while the reflection is on", () => {
    const controller = new EnvironmentController({
      scene: new THREE.Scene(),
      quality: { shadowsEnabled: true, shadowMapSize: 1024, secondaryLightScale: 1 },
      initialTerrain: "Studio",
      initialPreset: "Daytime",
    });
    controller.setFloorReflective(true);
    expect(controller.floor.material.transparent).toBe(true);
    expect(controller.floor.material.opacity).toBeLessThan(1);
    controller.setFloorReflective(false);
    expect(controller.floor.material.transparent).toBe(false);
    expect(controller.floor.material.opacity).toBe(1);
  });

  it("never lights the scene with mirrored copies of the vehicle's own lights", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const fogLamp = new THREE.PointLight("#fff", 2);
    fogLamp.visible = false;
    root.add(fogLamp);
    const reflection = new FloorReflection();
    reflection.setSource(root);
    reflection.setEnabled(true);
    fogLamp.visible = true; // the accessory is switched on
    reflection.sync();
    const mirroredLights: THREE.Light[] = [];
    reflection.group.traverse((object) => {
      if (object instanceof THREE.Light) mirroredLights.push(object);
    });
    expect(mirroredLights).toHaveLength(1);
    expect(mirroredLights[0]!.visible).toBe(false);
  });

  it("rebuilds when a mounted part is swapped for another (same child count, different child)", () => {
    const root = new THREE.Group();
    const mount = new THREE.Group();
    const stockWheel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mount.add(stockWheel);
    root.add(mount);
    const reflection = new FloorReflection();
    reflection.setSource(root);
    reflection.setEnabled(true);
    const replacement = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: "#f00" }));
    mount.remove(stockWheel);
    mount.add(replacement);
    reflection.sync();
    const mirroredMaterials: THREE.Material[] = [];
    reflection.group.traverse((object) => {
      if (object instanceof THREE.Mesh) mirroredMaterials.push(object.material as THREE.Material);
    });
    expect(mirroredMaterials).toEqual([replacement.material]);
  });
});
