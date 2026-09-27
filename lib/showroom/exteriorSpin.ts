import type { CustomizationOption, VehicleConfiguration } from "../types/customization";
import type { ExteriorSpin } from "../types/spin";
import type { Vehicle } from "../types/vehicle";

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function selectedPaintCode(
  vehicle: Vehicle,
  catalog: readonly CustomizationOption[],
  configuration: Pick<VehicleConfiguration, "gradeId" | "selections">,
): string | undefined {
  const selectedId = configuration.selections.paint?.[0];
  if (selectedId) {
    const selected = catalog.find((option) => option.id === selectedId);
    if (selected?.paintCode) return selected.paintCode;

    const byLabel = selected
      ? vehicle.exteriorColors.find((color) => normalized(color.name) === normalized(selected.label))
      : undefined;
    if (byLabel) return byLabel.code;
  }

  const grade = vehicle.grades.find((candidate) => candidate.id === configuration.gradeId);
  if (!grade) return undefined;
  return grade.availableExteriorColorCodes.find((code) =>
    vehicle.media.exteriorSpins?.some(
      (spin) => spin.gradeId === configuration.gradeId && normalized(spin.paintCode) === normalized(code),
    ),
  );
}

export function resolveExteriorSpin(
  vehicle: Vehicle,
  catalog: readonly CustomizationOption[],
  configuration: Pick<VehicleConfiguration, "gradeId" | "selections">,
): ExteriorSpin | undefined {
  const paintCode = selectedPaintCode(vehicle, catalog, configuration);
  if (!paintCode) return undefined;
  return vehicle.media.exteriorSpins?.find(
    (spin) =>
      spin.vehicleSlug === vehicle.slug &&
      spin.modelYear === vehicle.year &&
      spin.gradeId === configuration.gradeId &&
      normalized(spin.paintCode) === normalized(paintCode),
  );
}

export function exteriorSpinCatalogErrors(vehicle: Vehicle): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const spin of vehicle.media.exteriorSpins ?? []) {
    if (ids.has(spin.id)) errors.push(`${vehicle.slug}: duplicate exterior spin id ${spin.id}`);
    ids.add(spin.id);
    if (spin.vehicleSlug !== vehicle.slug) errors.push(`${spin.id}: vehicleSlug must be ${vehicle.slug}`);
    if (spin.modelYear !== vehicle.year) errors.push(`${spin.id}: modelYear must be ${vehicle.year}`);
    const grade = vehicle.grades.find((candidate) => candidate.id === spin.gradeId);
    if (!grade) {
      errors.push(`${spin.id}: unknown grade ${spin.gradeId}`);
      continue;
    }
    const color = vehicle.exteriorColors.find((candidate) => normalized(candidate.code) === normalized(spin.paintCode));
    if (!color) errors.push(`${spin.id}: unknown paint code ${spin.paintCode}`);
    else if (!grade.availableExteriorColorCodes.some((code) => normalized(code) === normalized(spin.paintCode))) {
      errors.push(`${spin.id}: paint ${spin.paintCode} is not offered on grade ${spin.gradeId}`);
    }
    if (spin.frameCount !== 24 || spin.frames.length !== 24) errors.push(`${spin.id}: exterior spins require exactly 24 frames`);
    if (spin.degreesPerFrame !== 15) errors.push(`${spin.id}: degreesPerFrame must be 15`);
    if (spin.width < 512 || spin.height < 512) errors.push(`${spin.id}: source dimensions must be at least 512px in both axes`);
  }

  return errors;
}