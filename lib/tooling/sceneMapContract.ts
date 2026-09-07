import type { GlbInspection } from "./glbInspect";
import type { SceneMapEntry } from "../types/sceneMap";

/**
 * The same "declare the semantic contract, verify it against what's actually in the file" check
 * `buildSceneRegistry` (`lib/three/sceneRegistry.ts`) performs at runtime against a loaded
 * `THREE.Object3D` scene graph — reimplemented here against `GlbInspection`'s dependency-free GLB
 * JSON parse, so the asset build pipeline (a plain Node script, no WebGL context, no `three`) can
 * run the identical check as a build-time gate rather than only discovering a broken semantic
 * mapping the first time a browser loads the asset.
 */

export interface SceneMapContractReport {
  satisfied: SceneMapEntry[];
  unsatisfied: { entry: SceneMapEntry; reason: string }[];
}

export function checkSceneMapContract(
  inspection: GlbInspection,
  entries: readonly SceneMapEntry[],
): SceneMapContractReport {
  const report: SceneMapContractReport = { satisfied: [], unsatisfied: [] };

  for (const entry of entries) {
    if (!inspection.nodeNames.has(entry.match.objectName)) {
      report.unsatisfied.push({ entry, reason: `missing node "${entry.match.objectName}"` });
      continue;
    }

    if (entry.match.kind === "material-region") {
      const present = materialNamesUnderNode(inspection, entry.match.objectName);
      const missing = entry.match.materialNames.filter((name) => !present.has(name));
      if (missing.length > 0) {
        report.unsatisfied.push({
          entry,
          reason: `missing material slot(s) on "${entry.match.objectName}": ${missing.join(", ")}`,
        });
        continue;
      }
    }

    report.satisfied.push(entry);
  }

  return report;
}

/**
 * `GlbInspection.materialsByNode` is keyed by every named node with a mesh, including a plain
 * transform node's descendants only if they are themselves named — which matches how
 * `SceneRegistry`'s runtime equivalent (`materialNamesOn` in `lib/three/sceneRegistry.ts`) walks a
 * live scene graph by traversal, not by a single map lookup. A node whose mesh sits directly on it
 * hits the map directly; this is the build-time reduction to the common case this pipeline's
 * declared scene-map entries actually use (a mesh's own name).
 */
function materialNamesUnderNode(inspection: GlbInspection, nodeName: string): Set<string> {
  return inspection.materialsByNode.get(nodeName) ?? new Set();
}
