import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Procedurally-built wheel-and-tyre packages.
 *
 * ## Why procedural rather than authored GLBs
 *
 * The six vehicles in this showroom come from six unrelated sources, and their running gear is
 * modelled six different ways: the 4Runner/Tacoma carry separate `PLACED_WEISU_*` rims and
 * `PLACED_KO3_*` tyres, the GR Supra has four `Wheel_01_*` groups sharing one `Wheel1A` material,
 * the Camry shatters each corner into hundreds of `polySurface*` primitives, the AE86 bakes rim and
 * tyre into a single lit-texture `Body` material, and the RAV4 capture has no wheel geometry at all
 * — only four empty `MOUNT_WHEEL_*` transforms. An authored wheel GLB would have to be re-fitted,
 * re-scaled and re-licensed per vehicle, and it still could not give the RAV4 wheels it does not
 * have.
 *
 * Geometry built here is generated *to the fitment measured off each vehicle's own scene graph*
 * (`lib/data/wheelFitment.ts`), so one catalog of wheel packages fits every vehicle — including
 * ones whose stock wheels cannot be addressed by material at all. The parts join the scene under
 * the same exact-name contract as authored geometry (`WHEELSET_*`), so the customization catalog
 * addresses them exactly like GLB nodes and `verifyNodeContract` checks them the same way.
 *
 * ## Renderer neutrality (WebGPU and WebGL2)
 *
 * `RenderController` prefers `three/webgpu`'s `WebGPURenderer` and falls back to WebGL2. Everything
 * here is plain `BufferGeometry` plus `MeshStandardMaterial`/`MeshPhysicalMaterial`, which both
 * backends render identically — `WebGPURenderer` converts those materials to node materials
 * internally. Nothing in this module reaches for TSL, compute shaders, or a WebGPU-only feature,
 * because a wheel that only appears on one of the two backends is worse than no wheel at all.
 *
 * ## Cost
 *
 * Every corner of a package shares one merged `BufferGeometry` per material (rim, tyre, rotor,
 * caliper), so a package costs four geometries regardless of how many corners it is mounted at, and
 * sixteen draw calls while it is the visible one. Geometry is cached by package *and fitment*, so a
 * vehicle whose four corners measure the same builds each geometry exactly once.
 */

/** Rim face treatment. Drives spoke shape and the presence of beadlock hardware. */
export type SpokeStyle = "tapered" | "mesh" | "beadlock" | "dish";

export interface WheelDesignSpec {
  /** Rim outer radius as a fraction of the tyre's outer radius — the "plus sizing" of the package. */
  rimFraction: number;
  spokeCount: number;
  spokeStyle: SpokeStyle;
  /** Rim finish. Applied to the `wheel.metal` slot, so catalog finish options can still retint it. */
  finish: { color: string; metalness: number; roughness: number };
  /** Centre cap colour, kept separate from the rim so a dark cap reads against a bright rim. */
  capColor: string;
}

export interface TireSpec {
  /** Sidewall bulge beyond the tread radius, as a fraction of sidewall height. 0 is a flat wall. */
  shoulderBulge: number;
  /** Tread blocks around the circumference. 0 is a street tyre with no modelled blocks. */
  treadBlocks: number;
  /** Tread width as a fraction of the fitment width. <1 leaves a visible shoulder. */
  treadWidthFraction: number;
  sidewall: { color: string; roughness: number };
}

export interface WheelPackageSpec {
  /** Stable id. Becomes the `WHEELSET_<id>` node name and the customization option id suffix. */
  id: string;
  label: string;
  design: WheelDesignSpec;
  tire: TireSpec;
}

/**
 * One measured corner, in the vehicle root's local space.
 *
 * `radius` is the tyre's outer radius and `width` the tread width — both taken from the vehicle's
 * own stock running gear (or its wheel mounts) rather than assumed, which is what lets one package
 * catalog fit a 1980s coupe and a midsize truck without per-vehicle geometry.
 */
export interface WheelFitment {
  position: THREE.Vector3;
  radius: number;
  width: number;
  /** +1 when the corner sits on the root's +X side, -1 on the -X side. Faces the rim outward. */
  side: 1 | -1;
}

export const WHEELSET_NODE_PREFIX = "WHEELSET_";
export const TIRES_NODE_PREFIX = "TIRES_";

/** Exact `Object3D.name` of the group holding one package's four assemblies. */
export function wheelsetNodeName(packageId: string): string {
  return `${WHEELSET_NODE_PREFIX}${packageId}`;
}

/** Exact `Object3D.name` of the tyre-only subgroup, addressed by the `tire` catalog options. */
export function tiresNodeName(packageId: string): string {
  return `${TIRES_NODE_PREFIX}${packageId}`;
}

/** Material names procedural running gear exposes, matching the shipped 4Runner asset's own slots. */
/** `userData` flag on each package corner's rim assembly and tyre — what steering turns (`steering.ts`). */
export const WHEEL_CORNER_TAG = "wheelPackageCorner";

export const WHEEL_MATERIAL_NAME = "wheel.metal";
export const TIRE_MATERIAL_NAME = "tire.sidewall";
export const ROTOR_MATERIAL_NAME = "brake.rotor";
export const CALIPER_MATERIAL_NAME = "brake.caliper";

/**
 * Builds one package's running gear, hidden, ready to be added to a vehicle root.
 *
 * Hidden is the correct initial state for the same reason the procedural accessories are: a
 * restored configuration turns on exactly what it recorded, so anything not in the saved selections
 * must start off — and the vehicle's own stock wheels are what shows until a package is chosen.
 */
export function buildWheelPackage(
  spec: WheelPackageSpec,
  fitments: readonly WheelFitment[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = wheelsetNodeName(spec.id);
  group.visible = false;

  const tires = new THREE.Group();
  tires.name = tiresNodeName(spec.id);
  group.add(tires);

  const rimMaterial = new THREE.MeshPhysicalMaterial({
    color: spec.design.finish.color,
    metalness: spec.design.finish.metalness,
    roughness: spec.design.finish.roughness,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });
  rimMaterial.name = WHEEL_MATERIAL_NAME;

  const capMaterial = new THREE.MeshStandardMaterial({
    color: spec.design.capColor,
    metalness: 0.5,
    roughness: 0.35,
  });
  capMaterial.name = WHEEL_MATERIAL_NAME;

  const tireMaterial = new THREE.MeshStandardMaterial({
    color: spec.tire.sidewall.color,
    roughness: spec.tire.sidewall.roughness,
    metalness: 0,
  });
  tireMaterial.name = TIRE_MATERIAL_NAME;

  const rotorMaterial = new THREE.MeshStandardMaterial({ color: "#6b6f75", metalness: 0.9, roughness: 0.42 });
  rotorMaterial.name = ROTOR_MATERIAL_NAME;

  const caliperMaterial = new THREE.MeshStandardMaterial({ color: "#1d2024", metalness: 0.5, roughness: 0.4 });
  caliperMaterial.name = CALIPER_MATERIAL_NAME;

  // Geometry is shared across corners with equal fitment; `geometryCache` is scoped to this call so
  // nothing outlives the group it was built for and `disposeSubtree` stays the only teardown path.
  const geometryCache = new Map<string, CornerGeometry>();

  for (const fitment of fitments) {
    const geometry = cornerGeometry(geometryCache, spec, fitment);

    const corner = new THREE.Group();
    corner.position.copy(fitment.position);
    // Every part below is authored around +Y; this turns the assembly so its axle runs along the
    // root's X axis and its face points away from the vehicle, which is the layout all six assets
    // share (the axle is each stock wheel's smallest measured extent, always X).
    corner.rotation.z = fitment.side === 1 ? -Math.PI / 2 : Math.PI / 2;

    const rim = new THREE.Mesh(geometry.rim, rimMaterial);
    const cap = new THREE.Mesh(geometry.cap, capMaterial);
    const rotor = new THREE.Mesh(geometry.rotor, rotorMaterial);
    const caliper = new THREE.Mesh(geometry.caliper, caliperMaterial);
    corner.add(rim, cap, rotor, caliper);
    corner.userData[WHEEL_CORNER_TAG] = true;
    group.add(corner);

    // The tyre lives under `TIRES_<id>` rather than beside the rim so a `tire` catalog option can
    // name one node per package instead of one per corner. It carries the corner's transform
    // itself, since it is not a child of the corner group.
    const tire = new THREE.Mesh(geometry.tire, tireMaterial);
    tire.position.copy(fitment.position);
    tire.rotation.z = corner.rotation.z;
    tire.userData[WHEEL_CORNER_TAG] = true;
    tires.add(tire);
  }

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return group;
}

interface CornerGeometry {
  rim: THREE.BufferGeometry;
  cap: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  rotor: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
}

function cornerGeometry(
  cache: Map<string, CornerGeometry>,
  spec: WheelPackageSpec,
  fitment: WheelFitment,
): CornerGeometry {
  // Rounded so corners that measure identically to within a tenth of a millimetre share geometry
  // rather than missing the cache on floating-point noise from the bounding-box measurement.
  const key = `${fitment.radius.toFixed(4)}:${fitment.width.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const built: CornerGeometry = {
    rim: buildRimGeometry(spec.design, fitment),
    cap: buildCapGeometry(spec.design, fitment),
    tire: buildTireGeometry(spec, fitment),
    rotor: buildRotorGeometry(spec.design, fitment),
    caliper: buildCaliperGeometry(spec.design, fitment),
  };
  cache.set(key, built);
  return built;
}

/** Radial segment count for every revolved part. Low on purpose — see the cost note above. */
const RADIAL_SEGMENTS = 24;

function rimRadiusOf(design: WheelDesignSpec, fitment: WheelFitment): number {
  return fitment.radius * design.rimFraction;
}

/**
 * Barrel + outer lip + face (hub, spokes, outer ring) merged into one geometry.
 *
 * Merged rather than left as a group because the parts all carry the `wheel.metal` slot: one
 * geometry is one draw call per corner, and it is also one `MaterialWriter` slot, so a wheel-finish
 * option repaints the whole rim in a single write instead of five.
 */
function buildRimGeometry(design: WheelDesignSpec, fitment: WheelFitment): THREE.BufferGeometry {
  const rimRadius = rimRadiusOf(design, fitment);
  const halfWidth = fitment.width / 2;
  const parts: THREE.BufferGeometry[] = [];

  // Open-ended: the face below closes the outboard side, and the inboard side is never visible.
  parts.push(new THREE.CylinderGeometry(rimRadius * 0.86, rimRadius * 0.86, fitment.width, RADIAL_SEGMENTS, 1, true));

  const lip = new THREE.TorusGeometry(rimRadius * 0.95, rimRadius * 0.06, 6, RADIAL_SEGMENTS);
  lip.rotateX(Math.PI / 2);
  lip.translate(0, halfWidth * 0.92, 0);
  parts.push(lip);

  // A dished face sits inboard of the lip; a flush face sits level with it. This is the single
  // control that separates a deep-dish classic rim from a flat modern one.
  const faceY = design.spokeStyle === "dish" ? halfWidth * 0.3 : halfWidth * 0.78;
  const faceThickness = Math.max(fitment.width * 0.09, rimRadius * 0.04);

  const hubRadius = rimRadius * 0.28;
  const hub = new THREE.CylinderGeometry(hubRadius, hubRadius, faceThickness * 2.2, 16);
  hub.translate(0, faceY, 0);
  parts.push(hub);

  const outerRing = new THREE.TorusGeometry(rimRadius * 0.88, faceThickness * 0.6, 6, RADIAL_SEGMENTS);
  outerRing.rotateX(Math.PI / 2);
  outerRing.translate(0, faceY, 0);
  parts.push(outerRing);

  parts.push(...buildSpokes(design, rimRadius, hubRadius, faceThickness, faceY));

  if (design.spokeStyle === "beadlock") {
    // Beadlock ring hardware: bolt heads around the lip. Purely cosmetic, but it is what makes an
    // off-road rim read as one at showroom distance.
    const boltCount = 16;
    for (let i = 0; i < boltCount; i++) {
      const angle = (i / boltCount) * Math.PI * 2;
      const bolt = new THREE.CylinderGeometry(rimRadius * 0.035, rimRadius * 0.035, faceThickness, 6);
      bolt.translate(Math.cos(angle) * rimRadius * 0.88, faceY + faceThickness * 0.6, Math.sin(angle) * rimRadius * 0.88);
      parts.push(bolt);
    }
  }

  return mergeAndDispose(parts);
}

function buildSpokes(
  design: WheelDesignSpec,
  rimRadius: number,
  hubRadius: number,
  faceThickness: number,
  faceY: number,
): THREE.BufferGeometry[] {
  const spokes: THREE.BufferGeometry[] = [];
  const innerRadius = hubRadius * 0.9;
  const outerRadius = rimRadius * 0.9;
  const length = outerRadius - innerRadius;
  const midRadius = (innerRadius + outerRadius) / 2;

  // A mesh rim's many thin spokes and a beadlock's few wide ones are the same primitive with a
  // different width, so style stays one number rather than four geometry code paths.
  const widthFactor =
    design.spokeStyle === "mesh" ? 0.5 : design.spokeStyle === "beadlock" ? 1.5 : design.spokeStyle === "dish" ? 0.8 : 1;
  const width = ((rimRadius * 2 * Math.PI) / design.spokeCount) * 0.42 * widthFactor;

  for (let i = 0; i < design.spokeCount; i++) {
    const angle = (i / design.spokeCount) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(width, faceThickness, length);
    spoke.translate(0, 0, midRadius);
    spoke.rotateY(-angle);
    spoke.translate(0, faceY, 0);
    spokes.push(spoke);

    // Tapered spokes get a second, shorter rib stacked slightly proud of the first, which reads as
    // a Y-spoke without needing a lathe profile or a boolean cut.
    if (design.spokeStyle === "tapered") {
      const rib = new THREE.BoxGeometry(width * 0.5, faceThickness * 0.8, length * 0.55);
      rib.translate(0, 0, midRadius + length * 0.2);
      rib.rotateY(-angle);
      rib.translate(0, faceY + faceThickness * 0.5, 0);
      spokes.push(rib);
    }
  }
  return spokes;
}

function buildCapGeometry(design: WheelDesignSpec, fitment: WheelFitment): THREE.BufferGeometry {
  const rimRadius = rimRadiusOf(design, fitment);
  const halfWidth = fitment.width / 2;
  const faceY = design.spokeStyle === "dish" ? halfWidth * 0.3 : halfWidth * 0.78;
  const capRadius = rimRadius * 0.2;
  const cap = new THREE.CylinderGeometry(capRadius, capRadius * 1.05, fitment.width * 0.1, 14);
  cap.translate(0, faceY + fitment.width * 0.08, 0);
  return cap;
}

/**
 * Tyre carcass as a lathe of its cross-section, plus tread blocks for the aggressive specs.
 *
 * The profile runs bead → sidewall → shoulder → tread → shoulder → sidewall → bead, so sidewall
 * height (and therefore how the package reads as "low profile" or "all-terrain") falls straight out
 * of the package's `rimFraction` against the vehicle's measured tyre radius — no per-vehicle
 * tuning, and no chance of a tyre that does not meet the rim it is mounted on.
 */
function buildTireGeometry(spec: WheelPackageSpec, fitment: WheelFitment): THREE.BufferGeometry {
  const { design, tire } = spec;
  const outerRadius = fitment.radius;
  const beadRadius = rimRadiusOf(design, fitment) * 0.86;
  const halfWidth = fitment.width / 2;
  const sidewallHeight = outerRadius - beadRadius;
  const treadHalf = halfWidth * tire.treadWidthFraction;

  // Tread blocks stand proud of the groove base, so a blocked tyre's carcass is lathed to a
  // slightly smaller radius and the blocks bring it back to exactly `outerRadius`. Without this the
  // blocks would push the tyre past the diameter it was measured at — through the floor at the
  // bottom of the wheel and into the arch at the top.
  const blockDepth = tire.treadBlocks > 0 ? outerRadius * 0.05 : 0;
  const carcassRadius = outerRadius - blockDepth;
  const shoulderRadius = carcassRadius - sidewallHeight * 0.12;
  /**
   * Radius at which the tyre is at its widest.
   *
   * Sidewall bulge is a *radial* profile control, never an axial one: a tyre's widest point is its
   * sidewall (`±halfWidth`) and its largest radius is its tread, and the two are different places.
   * Letting bulge push past the tread radius, as an earlier version did, quietly made every tyre
   * bigger than the fitment it was measured to.
   */
  const bulgeRadius = beadRadius + sidewallHeight * (0.5 + tire.shoulderBulge);

  const profile = [
    new THREE.Vector2(beadRadius, -halfWidth * 0.72),
    new THREE.Vector2(bulgeRadius, -halfWidth),
    new THREE.Vector2(shoulderRadius, -treadHalf),
    new THREE.Vector2(carcassRadius, -treadHalf * 0.82),
    new THREE.Vector2(carcassRadius, treadHalf * 0.82),
    new THREE.Vector2(shoulderRadius, treadHalf),
    new THREE.Vector2(bulgeRadius, halfWidth),
    new THREE.Vector2(beadRadius, halfWidth * 0.72),
  ];

  const parts: THREE.BufferGeometry[] = [new THREE.LatheGeometry(profile, RADIAL_SEGMENTS)];

  for (let i = 0; i < tire.treadBlocks; i++) {
    const angle = (i / tire.treadBlocks) * Math.PI * 2;
    // Alternating inboard/outboard blocks: a staggered pattern at a fraction of the cost of
    // modelling both rows.
    const offset = (i % 2 === 0 ? 1 : -1) * treadHalf * 0.42;
    const depth = blockDepth * 2;
    // x runs along the circumference, y along the axle, z radially — matching the lathe, which
    // revolves its profile about Y. (Stepping the blocks around therefore rotates about Y as well:
    // rotating about X would sweep them through the axle instead of around the tread.)
    const arc = ((2 * Math.PI * outerRadius) / tire.treadBlocks) * 0.55;
    const block = new THREE.BoxGeometry(arc, treadHalf * 0.55, depth);
    // Half sunk into the carcass, half proud of it, so the outer face lands on `outerRadius`.
    block.translate(0, offset, outerRadius - depth / 2);
    block.rotateY(angle);
    parts.push(block);
  }

  return mergeAndDispose(parts);
}

function buildRotorGeometry(design: WheelDesignSpec, fitment: WheelFitment): THREE.BufferGeometry {
  const rimRadius = rimRadiusOf(design, fitment);
  return new THREE.CylinderGeometry(rimRadius * 0.68, rimRadius * 0.68, fitment.width * 0.09, 20);
}

function buildCaliperGeometry(design: WheelDesignSpec, fitment: WheelFitment): THREE.BufferGeometry {
  const rimRadius = rimRadiusOf(design, fitment);
  // x along the circumference, y along the axle, z radial — the same convention as the tread blocks.
  const caliper = new THREE.BoxGeometry(rimRadius * 0.24, fitment.width * 0.22, rimRadius * 0.36);
  // Trailing edge of the rotor, inboard of the rim face, where a real caliper sits.
  caliper.translate(0, -fitment.width * 0.12, rimRadius * 0.58);
  return caliper;
}

/**
 * Merges the parts into one geometry and disposes the inputs.
 *
 * `mergeGeometries` copies attribute data, so the source geometries are garbage the moment it
 * returns — they have not been uploaded to the GPU yet, but disposing them keeps this module's
 * "one geometry per material per fitment" claim literally true rather than approximately.
 */
function mergeAndDispose(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) {
    // `mergeGeometries` returns null only for mismatched attribute sets, which cannot happen for
    // the primitives above. Failing loudly beats silently mounting a wheel with no geometry.
    throw new Error("[wheels] procedural wheel geometry could not be merged");
  }
  return merged;
}
