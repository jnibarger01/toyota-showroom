import * as THREE from "three";

/**
 * Procedurally-built accessories and the low-detail fallback vehicle.
 *
 * These parts exist in code rather than in a GLB, but they join the scene under the same node-name
 * contract as authored geometry (`ACCESSORY_*`), so the customization catalog addresses them
 * exactly like GLB nodes. Catalog entries that target them set `geometrySource: "procedural-preview"`
 * so the UI can label them Preview. Replacing them with authored assets later means clearing that
 * flag (and usually switching to `mesh-replacement` + `assetUrl`) — the option ids, and therefore
 * every saved configuration, are unaffected.
 */

export const ACCESSORY_NODE_NAMES = {
  roofRack: "ACCESSORY_ROOF_RACK",
  lightBar: "ACCESSORY_LIGHT_BAR",
  rockSliders: "ACCESSORY_ROCK_SLIDERS",
  underglow: "ACCESSORY_UNDERGLOW",
  fogLights: "ACCESSORY_FOG_LIGHTS",
} as const;

/**
 * Attaches the accessory groups to a loaded vehicle root, hidden.
 *
 * Hidden is the correct initial state: a restored configuration turns on exactly what it recorded,
 * so anything not in the saved selections must start off. Building them eagerly (rather than on
 * first selection) keeps toggling allocation-free.
 */
export function buildProceduralAccessories(root: THREE.Object3D): void {
  const black = new THREE.MeshPhysicalMaterial({ color: "#080a0c", roughness: 0.34, metalness: 0.55 });
  const amber = new THREE.MeshStandardMaterial({ color: "#ffb000", emissive: "#ff8a00", emissiveIntensity: 5 });

  const roofRack = new THREE.Group();
  roofRack.name = ACCESSORY_NODE_NAMES.roofRack;
  roofRack.position.set(0, 1.88, -0.2);
  for (const x of [-0.76, 0.76]) roofRack.add(positionedBox(0.08, 0.09, 2.42, 0.025, black, x, 0, 0));
  for (const z of [-1.16, 1.16]) roofRack.add(positionedBox(1.6, 0.09, 0.08, 0.025, black, 0, 0, z));
  for (const z of [-0.78, -0.39, 0, 0.39, 0.78]) {
    roofRack.add(positionedBox(1.48, 0.055, 0.055, 0.018, black, 0, 0, z));
  }
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.88, 0.88]) roofRack.add(positionedBox(0.1, 0.15, 0.13, 0.02, black, x, -0.1, z));
  }

  const lightBar = new THREE.Group();
  lightBar.name = ACCESSORY_NODE_NAMES.lightBar;
  // Local +Z is the front of this asset: headlights sit at z ≈ 2.05 and the grille at z ≈ 2.31,
  // while the tail lights are at z ≈ -2.21. The root's Y rotation turns the whole group, children
  // included, so it does not change which local face is the front.
  lightBar.position.set(0, 0.72, 2.38);
  lightBar.add(roundedBox(1.46, 0.1, 0.12, 0.025, black));
  for (let i = -7; i <= 7; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), amber);
    lamp.position.set(i * 0.092, 0, 0.07);
    lightBar.add(lamp);
  }

  const sliders = new THREE.Group();
  sliders.name = ACCESSORY_NODE_NAMES.rockSliders;
  for (const x of [-1.01, 1.01]) {
    sliders.add(positionedBox(0.12, 0.1, 2.55, 0.03, black, x, 0.54, -0.04));
    for (const z of [-0.72, 0.72]) sliders.add(positionedBox(0.1, 0.2, 0.08, 0.02, black, x * 0.91, 0.63, z));
  }

  // A low LED strip tracing the rocker panels and bumpers. Emissive-only (`MeshBasicMaterial`
  // ignores scene lighting) so it reads as a lit LED under every environment preset, including
  // Daytime, rather than a coloured panel that only glows once the lights turn moody.
  const underglowMaterial = new THREE.MeshBasicMaterial({ color: "#5ad1ff", toneMapped: false });
  const underglow = new THREE.Group();
  underglow.name = ACCESSORY_NODE_NAMES.underglow;
  for (const x of [-1.06, 1.06]) underglow.add(positionedBox(0.05, 0.04, 3.7, 0.015, underglowMaterial, x, 0.1, 0));
  for (const z of [-2.28, 2.28]) underglow.add(positionedBox(1.9, 0.04, 0.05, 0.015, underglowMaterial, 0, 0.1, z));

  // Auxiliary fog lamps at the front bumper corners. Unlike every other accessory here, these
  // carry a real `PointLight` child, not just an emissive lens — selecting the option changes what
  // the scene illuminates, not only what it displays.
  const fogLights = new THREE.Group();
  fogLights.name = ACCESSORY_NODE_NAMES.fogLights;
  for (const x of [-0.62, 0.62]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 16), amber);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, 0.36, 2.26);
    fogLights.add(lens);

    const lamp = new THREE.PointLight("#ffdca8", 3, 5, 2);
    lamp.position.set(x, 0.36, 2.3);
    // Small accent lights, not the scene's shadow-casting key — a shadow-mapped point light is a
    // cube-map render per lamp per frame, real cost for a purely decorative accessory.
    lamp.castShadow = false;
    fogLights.add(lamp);
  }

  for (const group of [roofRack, lightBar, sliders, underglow, fogLights]) {
    group.visible = false;
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    root.add(group);
  }
}

/** Low-detail stand-in used when the detailed GLB cannot be fetched or decoded. */
export function createProceduralVehicle(): THREE.Group {
  const root = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color: "#1558d6",
    metalness: 0.72,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  paint.name = "body.carmain";

  const body = roundedBox(2.2, 1.1, 4.9, 0.18, paint);
  body.name = "BODY";
  body.position.y = 1.05;
  root.add(body);

  const rubber = new THREE.MeshStandardMaterial({ color: "#111214", roughness: 0.92 });
  rubber.name = "tire.sidewall";
  const alloy = new THREE.MeshStandardMaterial({ color: "#656b74", metalness: 0.82, roughness: 0.24 });
  alloy.name = "wheel.metal";

  // Named to match the detailed asset so the same catalog records resolve against the fallback.
  const placements: [string, string, number, number][] = [
    ["front_left", "front_left", 0.83, 1.53],
    ["front_right", "front_right", -0.83, 1.53],
    ["rear_left", "rear_left", 0.83, -1.28],
    ["rear_right", "rear_right", -0.83, -1.28],
  ];
  for (const [tireSuffix, wheelSuffix, x, z] of placements) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.15, 16, 32), rubber);
    tire.name = `PLACED_KO3_${tireSuffix}`;
    tire.rotation.y = Math.PI / 2;
    tire.position.set(x, 0.43, z);
    root.add(tire);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 20), alloy);
    rim.name = `PLACED_WEISU_${wheelSuffix}`;
    rim.rotation.z = Math.PI / 2;
    rim.position.set(x, 0.43, z);
    root.add(rim);
  }

  return root;
}

export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: radius * 0.55,
    bevelThickness: radius * 0.55,
  });
  geometry.center();
  return new THREE.Mesh(geometry, material);
}

export function positionedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = roundedBox(width, height, depth, radius, material);
  mesh.position.set(x, y, z);
  return mesh;
}
