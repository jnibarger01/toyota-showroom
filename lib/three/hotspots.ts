import * as THREE from "three";
import type { CustomizationCategory } from "../types/customization";
import { WHEEL_CORNER_TAG } from "./proceduralWheels";

/**
 * Feature hotspots: small labelled buttons pinned to parts of the vehicle, each opening the
 * configurator category that customises that part.
 *
 * Real DOM buttons over the canvas, not sprites drawn into it — the one piece of the 3D stage a
 * screen reader and a keyboard can reach directly (the axe gate excludes `.vehicle-canvas` because a
 * canvas has no accessible content; these do). Their text is the part's own scene-map label, never
 * marketing copy invented here.
 *
 * Positions are re-projected every frame by writing `style.transform` on the button elements
 * directly, not through React state: a re-render per frame for a handful of buttons would cost more
 * than the frame. Occlusion (a hotspot on the far side of the car) is a raycast, so it runs only
 * every few frames.
 */

/**
 * Which configurator categories a part type can lead to, in preference order; the first one the
 * vehicle's catalog actually serves wins. Scene maps type parts coarsely ("brake", "trim"), and
 * catalogs differ in where they file the same thing — a brake caliper is a Brakes option on one
 * vehicle and an Accessory on another — so a type lists every category it can stand for rather
 * than guessing one. Types with no customisation (glass, badge, mirror) get no hotspot.
 */
const CATEGORIES_FOR_PART_TYPE: Record<string, readonly CustomizationCategory[]> = {
  body: ["paint"],
  wheel: ["wheels"],
  tire: ["tires"],
  light: ["lighting"],
  interior: ["interior"],
  brake: ["brakes", "accessory"],
  trim: ["trim"],
  accessory: ["accessory"],
};

/** Preferred anchor part per category, when the scene map has it — the most recognisable instance. */
const PREFERRED_PART: Partial<Record<CustomizationCategory, string>> = {
  paint: "body.exterior",
  wheels: "wheel.front-left",
  tires: "tire.front-left",
  lighting: "headlight.assembly",
};

export interface HotspotPart {
  id: string;
  type: string;
  label: string;
}

export interface Hotspot {
  partId: string;
  category: CustomizationCategory;
  label: string;
}

/**
 * One hotspot per customisable category this vehicle actually offers, anchored to a part the scene
 * map registered. Categories the catalog does not serve for this vehicle are skipped — a hotspot that
 * opens an empty panel is worse than none.
 */
export function selectHotspots(parts: readonly HotspotPart[], availableCategories: ReadonlySet<CustomizationCategory>): Hotspot[] {
  const byCategory = new Map<CustomizationCategory, HotspotPart>();
  for (const part of parts) {
    const category = CATEGORIES_FOR_PART_TYPE[part.type]?.find((candidate) => availableCategories.has(candidate));
    if (!category) continue;
    const current = byCategory.get(category);
    if (!current || part.id === PREFERRED_PART[category]) byCategory.set(category, part);
  }
  return [...byCategory.entries()].map(([category, part]) => ({ partId: part.id, category, label: part.label }));
}

/**
 * Projects a world point to CSS pixels in a `width`×`height` viewport. `null` when the point is
 * behind the camera or outside the view.
 */
export function projectToScreen(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number): { x: number; y: number } | null {
  const ndc = point.clone().project(camera);
  if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

/**
 * A few points on the part's own surface (vertices spread evenly through its meshes, in world
 * space), used as aim points for the occlusion raycast. Computed once per part per settled vehicle —
 * geometry does not change while it is shown; world matrices do (lift), so the caller passes the
 * current root and these are re-derived when it moves.
 */
export function surfaceSamples(part: THREE.Object3D, count = 12): THREE.Vector3[] {
  part.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  part.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry?.getAttribute("position")) meshes.push(object);
  });
  const total = meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0);
  if (total === 0) return [];
  const samples: THREE.Vector3[] = [];
  const stride = total / count;
  for (let i = 0; i < count; i += 1) {
    let index = Math.floor(i * stride + stride / 2);
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute("position");
      if (index < position.count) {
        samples.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
        break;
      }
      index -= position.count;
    }
  }
  return samples;
}

/**
 * Where a part's hotspot sits right now: the first point on the part's *visible surface* found by
 * aiming at its bounds centre and then at `samples` on its surface, or `null` when every one of those
 * lines reaches other opaque geometry first (the part is on the far side of the car).
 *
 * A bounds centre alone is not a usable anchor. For a paint region spanning the whole body it is
 * inside the car; for a rim it sits behind the tyre's sidewall; for a seat, behind the glass. Aiming
 * at real surface points and looking *through* see-through materials (glass, lenses) is what lets
 * those parts resolve at all. Anchoring to the surface hit keeps the label on the part and gets
 * occlusion from the same raycast.
 */
export function resolveHotspotAnchor(
  part: THREE.Object3D,
  root: THREE.Object3D,
  camera: THREE.Camera,
  samples: readonly THREE.Vector3[] = [],
  raycaster = new THREE.Raycaster(),
): THREE.Vector3 | null {
  const box = new THREE.Box3().setFromObject(part);
  if (box.isEmpty()) return null;
  const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const targets = [box.getCenter(new THREE.Vector3()), ...samples];
  raycaster.far = Infinity;
  for (const target of targets) {
    raycaster.set(origin, target.clone().sub(origin).normalize());
    // Glass in front of the part hides nothing; glass that *is* the part (a headlamp lens) is it.
    const first = raycaster
      .intersectObject(root, true)
      .find((hit) => isVisibleInScene(hit.object) && (isWithin(hit.object, part) || !isSeeThrough(hit.object)));
    if (first && isWithin(first.object, part)) return first.point;
  }
  return null;
}

/**
 * What a hotspot should anchor to right now. Normally the part itself; but a wheel package hides
 * the factory wheel a `wheel.*` / `tire.*` part names and shows its own corner in the same spot,
 * so for a hidden part the nearest visible package corner stands in. `null` when neither is shown.
 */
export function visibleStandIn(part: THREE.Object3D, root: THREE.Object3D): THREE.Object3D | null {
  if (isVisibleInScene(part)) return part;
  const partCenter = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3());
  let best: THREE.Object3D | null = null;
  let bestDistance = Infinity;
  const center = new THREE.Vector3();
  root.traverse((object) => {
    if (!object.userData[WHEEL_CORNER_TAG] || !isVisibleInScene(object)) return;
    const distance = new THREE.Box3().setFromObject(object).getCenter(center).distanceTo(partCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = object;
    }
  });
  return best;
}

function isWithin(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node && node !== ancestor) node = node.parent;
  return node === ancestor;
}

/** Glass and lenses: geometry a viewer sees through, so it hides nothing behind it. */
function isSeeThrough(object: THREE.Object3D): boolean {
  const material = (object as THREE.Mesh).material;
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  return materials.length > 0 && materials.every((entry) => {
    const physical = entry as THREE.MeshPhysicalMaterial;
    return (entry.transparent && entry.opacity < 0.9) || (physical.transmission ?? 0) > 0;
  });
}

function isVisibleInScene(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}
