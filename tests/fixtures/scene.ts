import * as THREE from "three";

/**
 * A synthetic stand-in for `modsnation_7416_assets_assembled.glb`.
 *
 * It reproduces the three structural properties that actually break naive integrations, all of
 * which were read out of the real asset:
 *
 *  - `BODY` is one mesh carrying ten materials, with `body.carmain` at slot 0 and glass, chrome,
 *    and emissive lamp materials in the other slots.
 *  - Materials are shared across nodes: `wheel.metal` is on the front wheels *and* on the hidden
 *    donor `322-1790(MD010)`; `tire.sidewall` is on all four tyres and on the donor tyre.
 *  - Wheel positions come from siblings of the `MOUNT_WHEEL_*` nodes, not from their children.
 *
 * Tests assert against these names, never against child indices.
 */

export const BODY_MATERIAL_NAMES = [
  "body.carmain",
  "metal.chrome.004",
  "glass.windows",
  "glass.windows.windshield",
  "glass.windows.rear.windshield",
  "plastik.all.004",
  "glass.light.002",
  "emissive.foglight",
  "emissive.brakelights.001",
  "emissive.turnsignal.002",
];

function physical(name: string, color = "#808080"): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color });
  material.name = name;
  return material;
}

function mesh(name: string, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  object.name = name;
  return object;
}

export interface SceneFixture {
  root: THREE.Group;
  /** The exact instances the fixture created, so tests can assert on identity and sharing. */
  materials: {
    bodyPaint: THREE.MeshPhysicalMaterial;
    bodyGlass: THREE.MeshPhysicalMaterial;
    wheelFront: THREE.MeshPhysicalMaterial;
    wheelRear: THREE.MeshPhysicalMaterial;
    tire: THREE.MeshPhysicalMaterial;
    grille: THREE.MeshPhysicalMaterial;
  };
}

export function createVehicleFixture(): SceneFixture {
  const root = new THREE.Group();
  root.name = "VEHICLE_ROOT";

  const bodyMaterials = BODY_MATERIAL_NAMES.map((name) => physical(name, "#1558d6"));
  const body = mesh("BODY", bodyMaterials);
  root.add(body);

  // Shared across the front pair and the donor node — the case that makes clone-on-write necessary.
  const wheelFront = physical("wheel.metal", "#656b74");
  const wheelRear = physical("wheel.metal.001", "#656b74");
  const tire = physical("tire.sidewall", "#111214");

  for (const [name, material, x, z] of [
    ["PLACED_WEISU_front_left", wheelFront, 0.834, 1.527],
    ["PLACED_WEISU_front_right", wheelFront, -0.834, 1.527],
    ["PLACED_WEISU_rear_left", wheelRear, 0.834, -1.281],
    ["PLACED_WEISU_rear_right", wheelRear, -0.834, -1.281],
  ] as const) {
    const wheel = mesh(name, material);
    wheel.position.set(x, 0.395, z);
    body.add(wheel);
  }

  for (const [name, x, z] of [
    ["PLACED_KO3_front_left", 0.834, 1.527],
    ["PLACED_KO3_front_right", -0.834, 1.527],
    ["PLACED_KO3_rear_left", 0.834, -1.281],
    ["PLACED_KO3_rear_right", -0.834, -1.281],
  ] as const) {
    const wheel = mesh(name, tire);
    wheel.position.set(x, 0.395, z);
    body.add(wheel);
  }

  // Empty transform nodes; the wheels above are siblings, exactly as in the real export.
  for (const [name, x, z] of [
    ["MOUNT_WHEEL_FRONT_LEFT", 0.834, 1.527],
    ["MOUNT_WHEEL_FRONT_RIGHT", -0.834, 1.527],
    ["MOUNT_WHEEL_REAR_LEFT", 0.834, -1.281],
    ["MOUNT_WHEEL_REAR_RIGHT", -0.834, -1.281],
  ] as const) {
    const mount = new THREE.Object3D();
    mount.name = name;
    mount.position.set(x, 0.395, z);
    body.add(mount);
  }

  const grille = physical("plastik.all.003", "#2a2a2a");
  body.add(mesh("Tun_GRILLE", grille));

  // Donor geometry retained at the origin, sharing materials with the placed parts.
  root.add(mesh("322-1790(MD010)", wheelFront));
  root.add(mesh("BFGoodrich_ALL_Terrain_TA_KO2", tire));

  for (const name of ["ACCESSORY_ROOF_RACK", "ACCESSORY_LIGHT_BAR", "ACCESSORY_ROCK_SLIDERS"]) {
    const group = new THREE.Group();
    group.name = name;
    group.visible = false;
    group.add(mesh(`${name}_RAIL`, physical(`${name}_MAT`)));
    root.add(group);
  }

  return {
    root,
    materials: {
      bodyPaint: bodyMaterials[0],
      bodyGlass: bodyMaterials[2],
      wheelFront,
      wheelRear,
      tire,
      grille,
    },
  };
}

/** Resolves the live material occupying a named slot of a named mesh. */
export function materialAt(root: THREE.Object3D, nodeName: string, materialName: string): THREE.Material | undefined {
  const node = root.getObjectByName(nodeName);
  if (!(node instanceof THREE.Mesh)) return undefined;
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  return materials.find((material) => material?.name === materialName);
}

export function colorHexAt(root: THREE.Object3D, nodeName: string, materialName: string): string | undefined {
  const material = materialAt(root, nodeName, materialName) as THREE.MeshStandardMaterial | undefined;
  return material?.color?.getHexString();
}
