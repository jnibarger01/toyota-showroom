import type { CustomizationOption, CustomizationCategory } from "../../types/customization";
import { fourRunnerOptions } from "./4runner";
import { tacomaOptions } from "./tacoma";
import { camryOptions } from "./camry";

/**
 * Server-side source of truth for customization options. The browser receives these records from
 * `GET /api/v1/vehicles/:slug/options`; it never invents them, and it never sends node names,
 * material names, or asset paths back — only option ids, which are resolved here.
 */
const OPTIONS_BY_VEHICLE: Record<string, CustomizationOption[]> = {
  "4runner": fourRunnerOptions,
  tacoma: tacomaOptions,
  camry: camryOptions,
};

export const ALL_OPTIONS: readonly CustomizationOption[] = Object.values(OPTIONS_BY_VEHICLE).flat();

export function getOptionsForVehicle(vehicleId: string): CustomizationOption[] {
  return OPTIONS_BY_VEHICLE[vehicleId] ?? [];
}

export function getOptionById(vehicleId: string, optionId: string): CustomizationOption | undefined {
  return getOptionsForVehicle(vehicleId).find((option) => option.id === optionId);
}

export function getOptionsByCategory(
  vehicleId: string,
  category: CustomizationCategory,
): CustomizationOption[] {
  return getOptionsForVehicle(vehicleId).filter((option) => option.category === category);
}

/**
 * Options a given grade may select. A grade restriction is expressed on the option
 * (`compatibleGradeIds`); absent means "every grade of a compatible vehicle".
 */
export function isOptionAvailableForGrade(option: CustomizationOption, gradeId: string): boolean {
  return !option.compatibleGradeIds?.length || option.compatibleGradeIds.includes(gradeId);
}
