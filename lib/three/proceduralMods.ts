import * as THREE from "three";

export const RUNTIME_MOD_NODE_NAMES = {
  rims: "RUNTIME_MOD_RIMS",
  tires: "RUNTIME_MOD_TIRES",
  brakes: "RUNTIME_MOD_BRAKES",
  exhaust: "RUNTIME_MOD_EXHAUST",
  ducktail: "RUNTIME_MOD_DUCKTAIL",
  splitter: "RUNTIME_MOD_FRONT_SPLITTER",
  sideSkirts: "RUNTIME_MOD_SIDE_SKIRTS",
  diffuser: "RUNTIME_MOD_REAR_DIFFUSER",
  carbon: "RUNTIME_MOD_CARBON_HOOD",
  trim: "RUNTIME_MOD_BLACKOUT_TRIM",
  underglow: "RUNTIME_MOD_UNDERGLOW",
} as const;

const VEHICLE_PROFILES: Record<string, { wheelRadius: number; axleInset: number; trackInset: number }> = {
  "4runner": { wheelRadius: 0.22, axleInset: 0.29, trackInset: 0.09 },
  tacoma: { wheelRadius: 0.22, axleInset: 0.29, trackInset: 0.09 },
  rav4: { wheelRadius: 0.20, axleInset: 0.30, trackInset: 0.08 },
  camry: { wheelRadius: 0.19, axleInset: 0.31, trackInset: 0.08 },
  "gr-corolla": { wheelRadius: 0.19, axleInset: 0.31, trackInset: 0.08 },
  "gr-supra": { wheelRadius: 0.20, axleInset: 0.30, trackInset: 0.07 },
  ae86: { wheelRadius: 0.19, axleInset: 0.31, trackInset: 0.08 },
};

function localBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const result = new THREE.Box3();
  const transformed = new THREE.Box3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.name.startsWith("RUNTIME_MOD_")) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    transformed.copy(object.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld));
    result.union(transformed);
  });
  return result;
}

function box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function wheelAnchors(bounds: THREE.Box3, profile: { wheelRadius: number; axleInset: number; trackInset: number }) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(size.y * profile.wheelRadius, Math.min(size.x, size.z) * 0.08);
  const x = size.x * (0.5 - profile.trackInset);
  const z = size.z * (0.5 - profile.axleInset);
  const y = bounds.min.y + radius;
  return {
    radius,
    points: [
      new THREE.Vector3(center.x + x, y, center.z + z),
      new THREE.Vector3(center.x - x, y, center.z + z),
      new THREE.Vector3(center.x + x, y, center.z - z),
      new THREE.Vector3(center.x - x, y, center.z - z),
    ],
  };
}

function rimAssembly(radius: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.58, radius * 0.07, 10, 32), material);
  ring.rotation.y = Math.PI / 2;
  group.add(ring);
  for (let i = 0; i < 5; i += 1) {
    const spoke = box(radius * 0.09, radius * 0.92, radius * 0.08, material);
    spoke.rotation.x = (Math.PI * 2 * i) / 5;
    group.add(spoke);
  }
  return group;
}

function brakeAssembly(radius: number, rotor: THREE.Material, caliper: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, radius * 0.07, 28), rotor);
  disc.rotation.z = Math.PI / 2;
  group.add(disc);
  const block = box(radius * 0.12, radius * 0.48, radius * 0.20, caliper);
  block.position.set(radius * 0.08, radius * 0.08, radius * 0.34);
  group.add(block);
  return group;
}

/** Builds hidden, lightweight modification geometry sized from the loaded vehicle's own bounds. */
export function buildRuntimeModificationKit(root: THREE.Object3D, vehicleId: string): void {
  if (root.getObjectByName(RUNTIME_MOD_NODE_NAMES.rims)) return;
  const bounds = localBounds(root);
  if (bounds.isEmpty()) return;

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const profile = VEHICLE_PROFILES[vehicleId] ?? { wheelRadius: 0.20, axleInset: 0.30, trackInset: 0.08 };
  const { radius, points } = wheelAnchors(bounds, profile);

  const alloy = new THREE.MeshStandardMaterial({ color: "#3e444c", metalness: 0.92, roughness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#0b0c0e", metalness: 0.02, roughness: 0.96 });
  const rotor = new THREE.MeshStandardMaterial({ color: "#777d84", metalness: 0.9, roughness: 0.28 });
  const red = new THREE.MeshStandardMaterial({ color: "#c21f2b", metalness: 0.55, roughness: 0.24 });
  const titanium = new THREE.MeshStandardMaterial({ color: "#777f8f", metalness: 0.95, roughness: 0.16 });
  const aero = new THREE.MeshPhysicalMaterial({ color: "#111317", metalness: 0.45, roughness: 0.28, clearcoat: 0.8 });
  const carbon = new THREE.MeshStandardMaterial({ color: "#17191d", metalness: 0.58, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: "#69d7ff", toneMapped: false });

  const rims = new THREE.Group(); rims.name = RUNTIME_MOD_NODE_NAMES.rims;
  const tires = new THREE.Group(); tires.name = RUNTIME_MOD_NODE_NAMES.tires;
  const brakes = new THREE.Group(); brakes.name = RUNTIME_MOD_NODE_NAMES.brakes;
  for (const point of points) {
    const rim = rimAssembly(radius, alloy); rim.position.copy(point); rims.add(rim);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.19, 14, 36), rubber);
    tire.rotation.y = Math.PI / 2; tire.position.copy(point); tires.add(tire);
    const brake = brakeAssembly(radius, rotor, red); brake.position.copy(point); brakes.add(brake);
  }

  const frontZ = bounds.min.z;
  const rearZ = bounds.max.z;
  const exhaust = new THREE.Group(); exhaust.name = RUNTIME_MOD_NODE_NAMES.exhaust;
  for (const x of [-size.x * 0.27, size.x * 0.27]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.13, radius * 0.15, size.z * 0.10, 18, 1, true), titanium);
    tip.rotation.x = Math.PI / 2; tip.position.set(center.x + x, bounds.min.y + size.y * 0.16, rearZ - size.z * 0.03); exhaust.add(tip);
  }

  const ducktail = new THREE.Group(); ducktail.name = RUNTIME_MOD_NODE_NAMES.ducktail;
  const wing = box(size.x * 0.72, size.y * 0.035, size.z * 0.10, aero); wing.position.set(center.x, bounds.max.y - size.y * 0.12, rearZ - size.z * 0.08); ducktail.add(wing);
  for (const x of [-size.x * 0.24, size.x * 0.24]) { const support = box(size.x * 0.035, size.y * 0.10, size.z * 0.035, aero); support.position.set(center.x + x, wing.position.y - size.y * 0.06, wing.position.z); ducktail.add(support); }

  const splitter = new THREE.Group(); splitter.name = RUNTIME_MOD_NODE_NAMES.splitter;
  const splitterBlade = box(size.x * 0.90, size.y * 0.025, size.z * 0.10, carbon); splitterBlade.position.set(center.x, bounds.min.y + size.y * 0.08, frontZ + size.z * 0.035); splitter.add(splitterBlade);

  const sideSkirts = new THREE.Group(); sideSkirts.name = RUNTIME_MOD_NODE_NAMES.sideSkirts;
  for (const x of [bounds.min.x + size.x * 0.02, bounds.max.x - size.x * 0.02]) { const skirt = box(size.x * 0.035, size.y * 0.04, size.z * 0.65, aero); skirt.position.set(x, bounds.min.y + size.y * 0.12, center.z); sideSkirts.add(skirt); }

  const diffuser = new THREE.Group(); diffuser.name = RUNTIME_MOD_NODE_NAMES.diffuser;
  const diffuserBase = box(size.x * 0.68, size.y * 0.035, size.z * 0.11, carbon); diffuserBase.position.set(center.x, bounds.min.y + size.y * 0.10, rearZ - size.z * 0.045); diffuser.add(diffuserBase);
  for (const x of [-0.24, -0.08, 0.08, 0.24]) { const fin = box(size.x * 0.025, size.y * 0.10, size.z * 0.12, carbon); fin.position.set(center.x + size.x * x, diffuserBase.position.y + size.y * 0.035, diffuserBase.position.z); diffuser.add(fin); }

  const carbonHood = new THREE.Group(); carbonHood.name = RUNTIME_MOD_NODE_NAMES.carbon;
  const hood = box(size.x * 0.62, size.y * 0.012, size.z * 0.27, carbon); hood.position.set(center.x, bounds.max.y - size.y * 0.24, frontZ + size.z * 0.24); carbonHood.add(hood);

  const trim = new THREE.Group(); trim.name = RUNTIME_MOD_NODE_NAMES.trim;
  for (const x of [bounds.min.x + size.x * 0.015, bounds.max.x - size.x * 0.015]) { const strip = box(size.x * 0.02, size.y * 0.035, size.z * 0.46, aero); strip.position.set(x, center.y + size.y * 0.10, center.z); trim.add(strip); }

  const underglow = new THREE.Group(); underglow.name = RUNTIME_MOD_NODE_NAMES.underglow;
  for (const x of [bounds.min.x + size.x * 0.07, bounds.max.x - size.x * 0.07]) { const strip = box(size.x * 0.018, size.y * 0.018, size.z * 0.70, glow); strip.position.set(x, bounds.min.y + size.y * 0.035, center.z); underglow.add(strip); }
  for (const z of [frontZ + size.z * 0.08, rearZ - size.z * 0.08]) { const strip = box(size.x * 0.70, size.y * 0.018, size.z * 0.018, glow); strip.position.set(center.x, bounds.min.y + size.y * 0.035, z); underglow.add(strip); }

  for (const group of [rims, tires, brakes, exhaust, ducktail, splitter, sideSkirts, diffuser, carbonHood, trim, underglow]) {
    group.visible = false;
    group.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    root.add(group);
  }
}
