import type { CustomizationOption, CustomizationCategory } from "../../types/customization";
import { fourRunnerOptions } from "./4runner";
import { tacomaOptions } from "./tacoma";
import { camryOptions } from "./camry";
import { grCorollaOptions } from "./gr-corolla";
import { ae86Options } from "./ae86";
import { rav4Options } from "./rav4";
import { grSupraOptions } from "./gr-supra";
import { rav4HybridOptions } from "./rav4-hybrid";
import { landCruiserOptions } from "./land-cruiser";
import { getGlobalWheelOptions } from "../wheels";
import { getRunningGearOptions } from "./runningGear";
import { createRuntimeModificationOptions } from "./runtimeMods";
import { getPaintProgramOptions } from "./paintProgram";

/**
 * Server-side source of truth for customization options. The browser receives these records from
 * `GET /api/v1/vehicles/:slug/options`; it never invents them, and it never sends node names,
 * material names, or asset paths back — only option ids, which are resolved here.
 */
const BASE_OPTIONS_BY_VEHICLE: Record<string, CustomizationOption[]> = {
  "4runner": [...fourRunnerOptions.filter((option) => option.id !== "wheels-trd-pro-global"), ...getGlobalWheelOptions("4runner")],
  tacoma: tacomaOptions,
  camry: camryOptions,
  "gr-corolla": grCorollaOptions,
  ae86: ae86Options,
  rav4: rav4Options,
  "rav4-hybrid": rav4HybridOptions,
  "land-cruiser": landCruiserOptions,
  "gr-supra": grSupraOptions,
};

/**
 * Generated layers, applied on top of each vehicle's own asset-derived catalog.
 *
 * `getRunningGearOptions` contributes wheel-and-tyre packages and sidewall finishes, built for every
 * vehicle from its *measured* fitment (`lib/data/wheelFitment.ts`). They live here rather than in
 * the per-vehicle files because the geometry is shared and generated: those files describe what is
 * in that vehicle's GLB, and none of this is. It is also the only path by which some vehicles get a
 * wheel configurator at all — the RAV4 capture has no wheel geometry, and the AE86 bakes rim and
 * tyre into a single material.
 *
 * `createRuntimeModificationOptions` contributes the shared runtime mod kit (aero, exhaust, brakes,
 * carbon, and its own single rim/tyre pair). Both are generated, and both are appended; see
 * `lib/three/proceduralMods.ts` and `lib/three/proceduralWheels.ts` for how the two differ.
 *
 * `getPaintProgramOptions` contributes paint finishes and the Paint Studio sentinel, borrowing each
 * vehicle's own paint targets rather than assuming a shared slot name. It runs against the base
 * options so its template is an authored colour, not one of the generated entries.
 */
const OPTIONS_BY_VEHICLE: Record<string, CustomizationOption[]> = Object.fromEntries(
  Object.entries(BASE_OPTIONS_BY_VEHICLE).map(([vehicleId, options]) => [
    vehicleId,
    [
      ...options,
      ...createRuntimeModificationOptions(vehicleId, options),
      ...getRunningGearOptions(vehicleId),
      ...getPaintProgramOptions(vehicleId, options),
    ],
  ]),
);

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

export {
  plannedOptionsEligibleForCatalog,
  optionResolvesAgainstGlb,
  plannedOptionIds,
} from "./plannedGate";
