import * as THREE from "three";

/**
 * A showroom-floor reflection of the vehicle, drawn as a mirrored copy beneath a semi-transparent
 * floor.
 *
 * ## Why not `Reflector` / a planar-reflection render target
 *
 * `three/examples/jsm/objects/Reflector` is WebGL-only, and this app prefers WebGPU; its WebGPU
 * counterpart is a node-material reflector that does not exist on the WebGL path. Either route means
 * a second render pipeline per backend — the cost that kept postprocessing out
 * (docs/POSTPROCESSING_EVALUATION.md). Mirroring the geometry is backend-agnostic: it is just more
 * meshes. For a flat floor at y = 0 a mirrored copy is also *exactly* what a planar reflection
 * computes, minus the render-target resolution loss.
 *
 * ## Cost and when it runs
 *
 * It doubles the vehicle's draw calls, so the caller enables it on the `high` tier only
 * (`QualitySettings.floorReflection`) — and it is the first thing `QualityGovernor` sheds, because
 * `high` is the only tier that has it. Geometry and materials are *shared* with the source, never
 * copied: the mirror costs draw calls, not memory or uploads.
 *
 * ## Staying in sync
 *
 * The vehicle is mutated after load — paint (`MaterialWriter` swaps in cloned materials), lift (root
 * position), accessory visibility, mesh replacement (new children under mounts). `sync()` runs once
 * per frame and copies transforms, visibility and material references pair-by-pair; a node whose
 * child count no longer matches its mirror triggers a rebuild, which is how a mesh-replacement
 * option shows up in the reflection without this module knowing options exist.
 */
export class FloorReflection {
  /** Scaled `y = -1` about the floor plane; holds the mirrored copy. Add it to the scene once. */
  readonly group: THREE.Group;

  private source: THREE.Object3D | null = null;
  private mirror: THREE.Object3D | null = null;
  private pairs: Array<[THREE.Object3D, THREE.Object3D]> = [];
  /** Each source node's children when the mirror was built — the structure `sync()` checks against. */
  private childrenAtBuild = new Map<THREE.Object3D, THREE.Object3D[]>();
  private enabled = false;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "FLOOR_REFLECTION";
    this.group.scale.set(1, -1, 1);
    this.group.visible = false;
  }

  /** Points the reflection at a (new) vehicle root. `null` detaches it. */
  setSource(root: THREE.Object3D | null): void {
    this.source = root;
    this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.group.visible = enabled && this.mirror !== null;
    if (enabled) this.sync();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Number of mirrored nodes — a test/diagnostic hook. */
  get mirroredNodeCount(): number {
    return this.pairs.length;
  }

  /** Copies the source's live state onto the mirror. Call once per frame; a no-op while disabled. */
  sync(): void {
    if (!this.enabled || !this.source || !this.mirror) return;
    // Structure check by identity, not just count: replacing a mounted part swaps one child for
    // another and leaves the count unchanged, and the mirror would keep syncing the detached one.
    for (const [from] of this.pairs) {
      const recorded = this.childrenAtBuild.get(from);
      if (!recorded || recorded.length !== from.children.length || recorded.some((child, index) => child !== from.children[index])) {
        this.rebuild();
        return;
      }
    }
    for (const [from, to] of this.pairs) {
      // A mirrored light (a fog-lamp accessory's PointLight) would light the real vehicle from
      // under the floor — doubling the accessory's light and its cost — so it never switches on.
      to.visible = to instanceof THREE.Light ? false : from.visible;
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
      to.scale.copy(from.scale);
      if (from instanceof THREE.Mesh && to instanceof THREE.Mesh) to.material = from.material;
    }
  }

  private rebuild(): void {
    if (this.mirror) this.group.remove(this.mirror);
    this.mirror = null;
    this.pairs = [];
    if (!this.source) {
      this.group.visible = false;
      return;
    }
    // `clone(true)` shares geometry and material by reference — exactly what is wanted.
    const mirror = this.source.clone(true);
    mirror.name = "FLOOR_REFLECTION_ROOT";
    const pairs: Array<[THREE.Object3D, THREE.Object3D]> = [];
    this.childrenAtBuild = new Map();
    const walk = (from: THREE.Object3D, to: THREE.Object3D) => {
      pairs.push([from, to]);
      this.childrenAtBuild.set(from, [...from.children]);
      // Never picked (the raycaster would otherwise find a part "under the floor"), never casts or
      // receives shadow (the real vehicle already does, and a mirrored caster would double it).
      to.raycast = () => {};
      if (to instanceof THREE.Light) to.visible = false;
      if (to instanceof THREE.Mesh) {
        to.castShadow = false;
        to.receiveShadow = false;
      }
      for (let index = 0; index < from.children.length; index += 1) {
        walk(from.children[index]!, to.children[index]!);
      }
    };
    walk(this.source, mirror);
    this.mirror = mirror;
    this.pairs = pairs;
    this.group.add(mirror);
    this.group.visible = this.enabled;
    if (this.enabled) this.sync();
  }

  /** Detaches the mirror. Shared geometry/materials belong to the source and are not disposed. */
  dispose(): void {
    this.setSource(null);
    this.group.removeFromParent();
  }
}

/** How much of the mirrored vehicle shows through the floor: `1 - floor opacity`. */
export const FLOOR_REFLECTION_STRENGTH = 0.12;
