import * as THREE from "three";
import type { SceneMapEntry, SemanticCapability } from "../types/sceneMap";

/**
 * Stable semantic identity for a loaded vehicle scene.
 *
 * Everything downstream of the GLB loader (picking, `VehicleSceneController` selection, a future
 * agent-facing API) addresses vehicle parts through IDs registered here — never by walking
 * `THREE.Object3D` children or depending on Blender node names directly. `buildSceneRegistry`
 * below is the mapping/validation layer that populates one of these from a `SceneMapEntry[]` and
 * the actual loaded root, the same "declare the contract, verify it against what's really there"
 * shape `verifyNodeContract` (`lib/three/nodes.ts`) already uses for customization options.
 */

export interface SceneRegistryMetadata {
  type: string;
  label: string;
  capabilities: readonly SemanticCapability[];
  /** Present only for a material-region entry — the material name(s) it owns on a shared mesh. */
  materialNames?: readonly string[];
}

export interface SceneRegistryEntry extends SceneRegistryMetadata {
  id: string;
  object: THREE.Object3D;
}

export class SceneRegistry {
  private readonly entries = new Map<string, SceneRegistryEntry>();
  /** Reverse index: an object's uuid to every entry registered against it — a single mesh (e.g.
   * the 4Runner's `BODY`) can carry several material-region entries at once. */
  private readonly byObjectUuid = new Map<string, SceneRegistryEntry[]>();

  register(id: string, object: THREE.Object3D, metadata: SceneRegistryMetadata): void {
    this.unregister(id);
    const entry: SceneRegistryEntry = { id, object, ...metadata };
    this.entries.set(id, entry);
    const bucket = this.byObjectUuid.get(object.uuid);
    if (bucket) bucket.push(entry);
    else this.byObjectUuid.set(object.uuid, [entry]);
  }

  unregister(id: string): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    this.entries.delete(id);
    const bucket = this.byObjectUuid.get(existing.object.uuid);
    if (!bucket) return;
    const next = bucket.filter((entry) => entry.id !== id);
    if (next.length > 0) this.byObjectUuid.set(existing.object.uuid, next);
    else this.byObjectUuid.delete(existing.object.uuid);
  }

  get(id: string): SceneRegistryEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  findByType(type: string): SceneRegistryEntry[] {
    return [...this.entries.values()].filter((entry) => entry.type === type);
  }

  findByCapability(capability: SemanticCapability): SceneRegistryEntry[] {
    return [...this.entries.values()].filter((entry) => entry.capabilities.includes(capability));
  }

  /** Every registered entry, semantic-ID order not guaranteed — for part lists / agent inspection. */
  list(): SceneRegistryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Reverse lookup from a raycast hit to its semantic ID — the join point between picking
   * (`lib/three/picking.ts`) and this registry.
   *
   * A material-region entry is registered (`buildSceneRegistry`) against its own dedicated mesh —
   * the one real, `GLTFLoader`-produced child whose single material carries the named slot — so
   * the common case is an unambiguous one-entry bucket, returned directly regardless of whether
   * that entry happens to carry `materialNames` metadata (kept for highlighting, not for
   * disambiguation here). `materialName` only matters when a bucket genuinely holds more than one
   * entry for the same object — a hand-built or non-`GLTFLoader` scene where several regions
   * legitimately share one multi-material mesh; no asset in this repo produces that shape, but the
   * registry itself does not assume otherwise. Falls back up the ancestor chain so a child mesh of
   * a registered group — an accessory's individual boxes, none of which are registered themselves
   * — resolves to the group's own semantic ID.
   */
  resolve(object: THREE.Object3D, materialName?: string): SceneRegistryEntry | undefined {
    let current: THREE.Object3D | null = object;
    while (current) {
      const bucket = this.byObjectUuid.get(current.uuid);
      if (bucket) {
        if (bucket.length === 1) return bucket[0];
        if (materialName) {
          const region = bucket.find((entry) => entry.materialNames?.includes(materialName));
          if (region) return region;
        }
        const whole = bucket.find((entry) => !entry.materialNames);
        if (whole) return whole;
        // More than one region entry shares this object and none matches — genuinely ambiguous;
        // keep walking up rather than guessing.
      }
      current = current.parent;
    }
    return undefined;
  }

  clear(): void {
    this.entries.clear();
    this.byObjectUuid.clear();
  }
}

export interface SceneMapReport {
  satisfied: SceneMapEntry[];
  unsatisfied: { entry: SceneMapEntry; reason: string }[];
}

/**
 * Populates a `SceneRegistry` from a declared `SceneMapEntry[]` against the actual loaded root,
 * validating every entry the same way `verifyNodeContract` validates customization options: an
 * entry whose node or material slot is not present on this asset is reported unsatisfied and left
 * unregistered, rather than registered against nothing or thrown as a load-time error. That is
 * what makes a partially-modeled vehicle (or the procedural fallback) a normal, typed outcome for
 * every caller instead of a special case each one has to guard against separately.
 */
export function buildSceneRegistry(
  root: THREE.Object3D,
  entries: readonly SceneMapEntry[],
): { registry: SceneRegistry; report: SceneMapReport } {
  const registry = new SceneRegistry();
  const report: SceneMapReport = { satisfied: [], unsatisfied: [] };

  for (const entry of entries) {
    const object = root.getObjectByName(entry.match.objectName);
    if (!object) {
      report.unsatisfied.push({ entry, reason: `missing node "${entry.match.objectName}"` });
      continue;
    }

    if (entry.match.kind === "material-region") {
      const present = materialNamesOn(object);
      const missing = entry.match.materialNames.filter((name) => !present.has(name));
      if (missing.length > 0) {
        report.unsatisfied.push({
          entry,
          reason: `missing material slot(s) on "${entry.match.objectName}": ${missing.join(", ")}`,
        });
        continue;
      }

      // Every material name is present *somewhere* under this node, but picking needs the exact
      // mesh to register — see `findDedicatedMeshForMaterials`'s own comment for why "the mesh
      // whose material array/single slot carries this name" is not the same object as `object`
      // itself for a real, GLTFLoader-produced multi-material node.
      const dedicated = findDedicatedMeshForMaterials(object, entry.match.materialNames);
      if (dedicated.length !== 1) {
        report.unsatisfied.push({
          entry,
          reason:
            dedicated.length === 0
              ? `material(s) ${entry.match.materialNames.join(", ")} reported present under "${entry.match.objectName}" but no single mesh carries them all`
              : `material(s) ${entry.match.materialNames.join(", ")} appear on ${dedicated.length} separate meshes under "${entry.match.objectName}" — ambiguous, not registered`,
        });
        continue;
      }

      registry.register(entry.id, dedicated[0]!, {
        type: entry.type,
        label: entry.label,
        capabilities: entry.capabilities,
        materialNames: entry.match.materialNames,
      });
    } else {
      registry.register(entry.id, object, {
        type: entry.type,
        label: entry.label,
        capabilities: entry.capabilities,
      });
    }
    report.satisfied.push(entry);
  }

  return { registry, report };
}

function materialNamesOn(object: THREE.Object3D): Set<string> {
  const names = new Set<string>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (material?.name) names.add(material.name);
    }
  });
  return names;
}

/**
 * Finds the mesh(es) under `node` whose material — single or array-slot — matches every name in
 * `materialNames`, for registering a material-region entry against the *exact* object picking
 * needs to resolve directly, rather than against `node` itself.
 *
 * This exists because of a real gap between two things that look similar but are not: a glTF
 * "mesh" with several primitives (the 4Runner's and RAV4's `BODY`, ten primitives, one glTF
 * material each) is not loaded by `GLTFLoader` as one `THREE.Mesh` with a ten-slot material array.
 * `GLTFLoader.loadMesh` (`three/examples/jsm/loaders/GLTFLoader.js`) creates one `THREE.Mesh` per
 * primitive and, whenever a glTF mesh has more than one, wraps them in a plain `THREE.Group` — so
 * `root.getObjectByName("BODY")` on the real, running app returns a `Group` of ten single-material
 * child meshes, never a single multi-material `Mesh`. A material-region entry registered against
 * that `Group` with a `materialNames` filter (this file's previous behavior) could never be found
 * by a raycast hit, because the hit object is always one specific child mesh with one plain
 * `.material`, and nothing pointed a semantic ID at that child directly — every paint/glass/chrome/
 * light part on both real vehicles was unselectable despite `buildSceneRegistry` reporting them
 * "satisfied". Finding and registering the dedicated child mesh here is the actual fix; the
 * multi-material-array case is kept as a fallback below only because a hand-built fixture or a
 * different loader could still produce one, not because real assets in this repo ever do.
 */
function findDedicatedMeshForMaterials(node: THREE.Object3D, materialNames: readonly string[]): THREE.Mesh[] {
  const wanted = new Set(materialNames);
  const matches: THREE.Mesh[] = [];
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const names = new Set(materials.map((m) => m?.name).filter((name): name is string => Boolean(name)));
    if (materialNames.length > 0 && materialNames.every((name) => names.has(name)) && names.size >= wanted.size) {
      matches.push(child);
    }
  });
  return matches;
}
