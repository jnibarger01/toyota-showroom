import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type { SceneRegistry, SceneRegistryEntry } from "./sceneRegistry";

/**
 * Accelerated pointer picking for direct vehicle-part interaction.
 *
 * `three-mesh-bvh` replaces three's default per-triangle linear raycast with a bounding-volume
 * hierarchy, which is the difference between "scan every triangle of a ~35k-tri wheel on every
 * pointer move" and "descend a tree". The vehicle body alone (`BODY`, one mesh, ten material
 * slots) is large enough that a hover-driven raycast without this would be a real per-frame cost,
 * not a rounding error — see `docs/PERF_BUDGETS.md`.
 *
 * The monkey-patch below (`computeBoundsTree`/`disposeBoundsTree` on `BufferGeometry.prototype`,
 * `acceleratedRaycast` on `Mesh.prototype.raycast`) is the library's documented integration point,
 * applied once at module load. It is safe for meshes that never call `computeBoundsTree()` — the
 * floor, grid, starfield, contact shadow, trail rocks — because `acceleratedRaycast` falls back to
 * three's original per-triangle path whenever `geometry.boundsTree` is absent; nothing here changes
 * behaviour for a mesh that was never opted in.
 */
let patched = false;
export function installAcceleratedRaycasting(): void {
  if (patched) return;
  patched = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

export interface PickResult {
  entry: SceneRegistryEntry;
  point: THREE.Vector3;
  distance: number;
  object: THREE.Object3D;
}

/**
 * Builds (and later disposes) bounds trees for every mesh under `root`, then resolves raycast
 * intersections to `SceneRegistry` semantic IDs.
 *
 * One instance per loaded vehicle scene, mirroring `VehicleSceneController`'s lifecycle — bounds
 * trees are per-geometry state, and geometry belongs to a specific loaded root, so this is
 * `prepare`/`dispose` rather than a singleton.
 */
export class VehiclePicker {
  /**
   * Deliberately *not* a running list of every mesh a bounds tree was ever built for: a
   * mesh-replacement option (a wheel/tire style swap) detaches and disposes the previous mesh
   * mid-session, well before this picker's own `dispose()` runs at controller teardown. A
   * remembered array would keep referencing — and so keep alive — every such retired mesh's
   * geometry (bounds tree included) for the rest of the session, one leaked mesh per swap. Instead
   * `dispose()` below re-traverses whatever is actually under `root` *at teardown time*, which only
   * ever touches geometry that is still live.
   */
  private root: THREE.Object3D | null = null;
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly registry: SceneRegistry) {
    installAcceleratedRaycasting();
    // `firstHitOnly` skips sorting the full intersection list — picking only ever needs the
    // nearest hit, and this is what lets a BVH raycast return in roughly O(log n) rather than
    // O(n log n) for a mesh with many triangles. Three's built-in raycast ignores this flag, so it
    // is inert (not incorrect) for the meshes below that never get a bounds tree.
    this.raycaster.firstHitOnly = true;
  }

  /**
   * Computes a bounds tree for every mesh with geometry under `root`. Call once after the vehicle
   * root (and its registry) settle; safe to call again after mounting new geometry (e.g. an
   * accessory attach) since it only (re)builds meshes that do not already carry a tree.
   */
  prepare(root: THREE.Object3D): void {
    this.root = root;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      if (!geometry || geometry.attributes.position === undefined) return;
      if (geometry.boundsTree) return;
      // Bounded cost: `computeBoundsTree` is a one-time O(n log n) build, not a per-frame cost, and
      // is skipped entirely for empty/placeholder geometry above.
      geometry.computeBoundsTree();
    });
  }

  /**
   * Raycasts from a normalized device coordinate (`pointer`, each axis in [-1, 1]) against
   * `root`, and resolves the nearest hit to a semantic ID via the registry. Returns `null` for a
   * miss, or a hit that resolves to no registered part (unselectable geometry — the floor, grid,
   * set dressing, or a vehicle whose scene map does not cover the hit node).
   */
  pick(pointer: THREE.Vector2, camera: THREE.Camera, root: THREE.Object3D): PickResult | null {
    this.raycaster.setFromCamera(pointer, camera);
    const hits = this.raycaster.intersectObject(root, true);
    const hit = hits[0];
    if (!hit) return null;

    const materialName = materialNameAtHit(hit);
    const entry = this.registry.resolve(hit.object, materialName);
    if (!entry) return null;

    return { entry, point: hit.point, distance: hit.distance, object: hit.object };
  }

  /**
   * Releases the bounds tree of every mesh still under `root` at call time. Call from the same
   * teardown that disposes the root — after this, `root`'s geometries no longer carry a bounds
   * tree for `acceleratedRaycast` to fall back from, matching their disposed state.
   */
  dispose(): void {
    this.root?.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry?.boundsTree) {
        object.geometry.disposeBoundsTree();
      }
    });
    this.root = null;
  }
}

/**
 * The material name at a raycast hit, for a mesh with per-face materials (three's multi-material
 * convention: `geometry.groups[i].materialIndex` selects `material[materialIndex]` for the faces
 * in that group, and `intersection.face.materialIndex` reports which group a hit face belongs to).
 * `undefined` for a single-material mesh, which is exactly what `SceneRegistry.resolve` expects for
 * an object-level (non-region) entry.
 */
function materialNameAtHit(hit: THREE.Intersection): string | undefined {
  const object = hit.object;
  if (!(object instanceof THREE.Mesh) || !Array.isArray(object.material)) return undefined;
  const index = hit.face?.materialIndex ?? 0;
  return object.material[index]?.name;
}

/** Normalized device coordinates from a client-space pointer event, for `VehiclePicker.pick`. */
export function pointerToNdc(clientX: number, clientY: number, bounds: DOMRect): THREE.Vector2 {
  return new THREE.Vector2(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -((clientY - bounds.top) / bounds.height) * 2 + 1,
  );
}
