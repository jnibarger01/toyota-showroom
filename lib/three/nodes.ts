import * as THREE from "three";
import type { CustomizationOption } from "../types/customization";

/**
 * Exact-name node resolution. Nothing in this module walks children by index or depends on
 * traversal order — `getObjectByName` performs a depth-first search keyed on `Object3D.name`,
 * which is stable across Blender re-exports as long as object names are unchanged.
 */

export interface NodeLookupResult {
  found: THREE.Object3D[];
  missing: string[];
}

export function resolveNodes(root: THREE.Object3D, names: readonly string[]): NodeLookupResult {
  const found: THREE.Object3D[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const object = root.getObjectByName(name);
    if (object) found.push(object);
    else missing.push(name);
  }
  return { found, missing };
}

/** Meshes only — resolves the named nodes and keeps those that can actually carry a material. */
export function resolveMeshes(root: THREE.Object3D, names: readonly string[]): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const name of names) {
    const object = root.getObjectByName(name);
    if (object instanceof THREE.Mesh) {
      meshes.push(object);
      continue;
    }
    // A named group may wrap its meshes (procedural accessories do). Collect them by descent,
    // which is order-independent: every mesh under the named node is included.
    if (object) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
    }
  }
  return meshes;
}

export function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Every distinct node name an option needs to be applicable. */
export function requiredNodeNames(option: CustomizationOption): string[] {
  return [
    ...(option.targetNodes ?? []),
    ...(option.hidesNodes ?? []),
    ...(option.mountNodes ?? []),
  ];
}

export interface ContractReport {
  satisfied: CustomizationOption[];
  unsatisfied: { option: CustomizationOption; missingNodes: string[]; missingMaterials: string[] }[];
}

/**
 * Load-time gate. Checks every option's node and material names against the GLB that was actually
 * loaded, so a missing name surfaces once, at startup, with the option's id attached — instead of
 * as a silent no-op the first time a user clicks the control.
 *
 * Options reported as unsatisfied are removed from the catalog the UI renders, which is what keeps
 * "every customization button updates the intended 3D component" true even while the asset
 * pipeline is mid-migration.
 */
export function verifyNodeContract(
  root: THREE.Object3D,
  options: readonly CustomizationOption[],
): ContractReport {
  const report: ContractReport = { satisfied: [], unsatisfied: [] };

  for (const option of options) {
    const { missing } = resolveNodes(root, requiredNodeNames(option));
    const missingMaterials = missingMaterialNames(root, option);

    if (missing.length === 0 && missingMaterials.length === 0) {
      report.satisfied.push(option);
    } else {
      report.unsatisfied.push({ option, missingNodes: missing, missingMaterials });
    }
  }

  return report;
}

function missingMaterialNames(root: THREE.Object3D, option: CustomizationOption): string[] {
  if (!option.targetMaterials?.length || !option.targetNodes?.length) return [];

  const present = new Set<string>();
  for (const mesh of resolveMeshes(root, option.targetNodes)) {
    for (const material of materialsOf(mesh)) {
      if (material?.name) present.add(material.name);
    }
  }
  // An option may legitimately name both `wheel.metal` and `wheel.metal.001` when the front and
  // rear pairs differ; it is unsatisfied only when *none* of its named slots exist.
  const anyPresent = option.targetMaterials.some((name) => present.has(name));
  return anyPresent ? [] : [...option.targetMaterials];
}

/**
 * Development utility: prints the loaded hierarchy so option records can be written against real
 * names. Call from the browser console via `window.__dumpVehicleHierarchy()` (wired in
 * `VehicleCanvas` when `import.meta.env.DEV`).
 */
export function logHierarchy(root: THREE.Object3D): void {
  root.traverse((object) => {
    console.log({
      name: object.name,
      type: object.type,
      visible: object.visible,
      material:
        object instanceof THREE.Mesh
          ? Array.isArray(object.material)
            ? object.material.map((material) => material.name)
            : object.material?.name
          : undefined,
    });
  });
}
