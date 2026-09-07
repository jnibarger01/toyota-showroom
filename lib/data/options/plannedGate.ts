import type { CustomizationOption } from "../../types/customization";
import { requiredNodeNames } from "../../three/nodes";
import type { GlbInspection } from "../../tooling/glbInspect";

/**
 * Promotion gate for forward-declared catalog entries.
 *
 * Planned options (e.g. `plannedFourRunnerOptions`) stay out of `getOptionsForVehicle` until every
 * required node — and, when declared, every material slot on those nodes — exists in the shipped
 * GLB. Callers move an entry into the served catalog only after this returns it (and CI's
 * `glbContract` test would then enforce the same names without a synthetic-node exception).
 *
 * Procedural `ACCESSORY_*` stand-ins are *not* promoted through this gate: they are served as
 * `geometrySource: "procedural-preview"` until authored meshes replace them.
 */
export function plannedOptionsEligibleForCatalog(
  planned: readonly CustomizationOption[],
  inspection: Pick<GlbInspection, "nodeNames" | "materialsByNode">,
): CustomizationOption[] {
  return planned.filter((option) => optionResolvesAgainstGlb(option, inspection));
}

export function optionResolvesAgainstGlb(
  option: CustomizationOption,
  inspection: Pick<GlbInspection, "nodeNames" | "materialsByNode">,
): boolean {
  const missingNodes = requiredNodeNames(option).filter((name) => !inspection.nodeNames.has(name));
  if (missingNodes.length > 0) return false;

  if (!option.targetMaterials?.length || !option.targetNodes?.length) return true;

  const present = new Set<string>();
  for (const nodeName of option.targetNodes) {
    for (const materialName of inspection.materialsByNode.get(nodeName) ?? []) {
      present.add(materialName);
    }
  }
  return option.targetMaterials.every((name) => present.has(name));
}

/** Ids that must never appear in the served catalog while they remain planned. */
export function plannedOptionIds(planned: readonly CustomizationOption[]): string[] {
  return planned.map((option) => option.id);
}
