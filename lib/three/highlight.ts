import * as THREE from "three";
import type { SceneRegistryEntry } from "./sceneRegistry";

/**
 * Visual feedback for hover/selection, addressed by `SceneRegistry` semantic ID.
 *
 * The one constraint that shapes this whole module: materials in this codebase are frequently
 * shared across nodes (`docs/INTEGRATION_GUIDE.md` §1 — `wheel.metal` alone is shared by the front
 * wheel pair and a hidden donor node; `MaterialWriter`, `lib/three/materials.ts`, exists
 * specifically to clone-on-write so repainting one target never repaints a sibling that happens to
 * share the instance). Tinting a shared material directly for a hover effect would hit the exact
 * same bug — highlighting `wheel.front-left` would visibly highlight `wheel.front-right` too,
 * since fixture and real asset alike give them one `THREE.Material` between them. So highlighting
 * clones per mesh, the same way `MaterialWriter` clones per write, and restores the mesh's
 * material reference — not the GLB-original one, whatever is *currently* assigned, so a highlight
 * cleared after a repaint gives back the repainted material rather than reverting it.
 */

export type HighlightState = "hover" | "selected";

const HIGHLIGHT_COLOR: Record<HighlightState, THREE.ColorRepresentation> = {
  hover: "#3d7dff",
  selected: "#ffb000",
};

const HIGHLIGHT_EMISSIVE_INTENSITY: Record<HighlightState, number> = {
  hover: 0.35,
  selected: 0.6,
};

interface RestoreEntry {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
}

export class PartHighlighter {
  private readonly restoreById = new Map<string, RestoreEntry[]>();

  /** Whether `id` currently carries a highlight (either state). */
  has(id: string): boolean {
    return this.restoreById.has(id);
  }

  /** Applies `state`'s tint to every mesh under `entry.object`, restoring any highlight already on `entry.id` first. */
  apply(entry: SceneRegistryEntry, state: HighlightState): void {
    this.clear(entry.id);

    const restores: RestoreEntry[] = [];
    for (const mesh of collectMeshes(entry.object)) {
      const original = mesh.material;
      restores.push({ mesh, original });
      mesh.material = tintMaterial(original, entry.materialNames, state);
    }
    this.restoreById.set(entry.id, restores);
  }

  /** Restores `id`'s meshes to whatever material was assigned when `apply` ran, disposing the tint clones. */
  clear(id: string): void {
    const restores = this.restoreById.get(id);
    if (!restores) return;
    for (const { mesh, original } of restores) {
      disposeMaterial(mesh.material, original);
      mesh.material = original;
    }
    this.restoreById.delete(id);
  }

  clearAll(): void {
    for (const id of [...this.restoreById.keys()]) this.clear(id);
  }
}

function collectMeshes(object: THREE.Object3D): THREE.Mesh[] {
  if (object instanceof THREE.Mesh) return [object];
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  return meshes;
}

/**
 * Clones and tints `material`. For a multi-material mesh belonging to a material-region entry
 * (`materialNames` set), only the named slot(s) are cloned — the rest of the array keeps its
 * existing references, untouched and undisposed, exactly like `MaterialWriter.applyMaterialConfig`.
 */
function tintMaterial(
  material: THREE.Material | THREE.Material[],
  materialNames: readonly string[] | undefined,
  state: HighlightState,
): THREE.Material | THREE.Material[] {
  if (!Array.isArray(material)) return tintOne(material, state);
  return material.map((slot) => (!materialNames || materialNames.includes(slot.name) ? tintOne(slot, state) : slot));
}

function tintOne(material: THREE.Material, state: HighlightState): THREE.Material {
  const clone = material.clone();
  clone.name = material.name;
  if (isEmissiveCapable(clone)) {
    clone.emissive = new THREE.Color(HIGHLIGHT_COLOR[state]);
    clone.emissiveIntensity = HIGHLIGHT_EMISSIVE_INTENSITY[state];
  }
  clone.needsUpdate = true;
  return clone;
}

function isEmissiveCapable(
  material: THREE.Material,
): material is THREE.Material & { emissive: THREE.Color; emissiveIntensity: number } {
  return "emissive" in material && "emissiveIntensity" in material;
}

/** Disposes the tint clone(s) in `current`, skipping any slot that was left as the original (unlensed) reference. */
function disposeMaterial(current: THREE.Material | THREE.Material[], original: THREE.Material | THREE.Material[]): void {
  const originals = new Set(Array.isArray(original) ? original : [original]);
  for (const material of Array.isArray(current) ? current : [current]) {
    if (!originals.has(material)) material.dispose();
  }
}
