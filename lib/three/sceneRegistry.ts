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
   * `materialName` disambiguates a material-region entry when several share one mesh (the object
   * itself resolves to a `BODY` mesh; the material index on the intersected face says which
   * region). Falls back up the ancestor chain so a child mesh of a registered group — an
   * accessory's individual boxes, none of which are registered themselves — resolves to the
   * group's own semantic ID.
   */
  resolve(object: THREE.Object3D, materialName?: string): SceneRegistryEntry | undefined {
    let current: THREE.Object3D | null = object;
    while (current) {
      const bucket = this.byObjectUuid.get(current.uuid);
      if (bucket) {
        if (materialName) {
          const region = bucket.find((entry) => entry.materialNames?.includes(materialName));
          if (region) return region;
        }
        const whole = bucket.find((entry) => !entry.materialNames);
        if (whole) return whole;
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
      registry.register(entry.id, object, {
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
