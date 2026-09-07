import {
  CATEGORY_APPLY_ORDER,
  isMultiSelect,
  type CustomizationOption,
  type SelectionMap,
  type VehicleConfiguration,
} from "../types/customization";
import type { Vehicle } from "../types/vehicle";
import { paintStudioPriceDelta, PAINT_CUSTOM_OPTION_ID } from "../data/paintStudio";

/**
 * Grade sticker price for a build total. Falls back to the vehicle's cheapest published MSRP when
 * the grade id is missing or unknown — never trusts a client-supplied dollar figure.
 */
export function resolveGradeMsrp(vehicle: Vehicle | null | undefined, gradeId: string | null | undefined): number {
  if (!vehicle) return 0;
  const grade = gradeId ? vehicle.grades.find((candidate) => candidate.id === gradeId) : undefined;
  if (grade) return grade.msrp;
  return Math.min(vehicle.pricing.baseMsrp, ...vehicle.grades.map((candidate) => candidate.msrp));
}

/**
 * Live build estimate: grade MSRP + sum of selected options' catalog `priceDelta`s.
 *
 * Derived from selections + trusted catalog on every call (including restore). Not persisted on
 * `VehicleConfiguration` — keeping the schema selection-only keeps D1 / localConfigurationTransport
 * offline round-trips simple and avoids accepting client-authored dollar figures.
 */
export function estimateBuildTotal(baseMsrp: number, catalog: CustomizationOption[], configuration: VehicleConfiguration | null): number {
  if (!configuration) return baseMsrp;
  const selected = new Set(Object.values(configuration.selections).flat());
  const optionsTotal = catalog.reduce((total, option) => total + (selected.has(option.id) ? (option.priceDelta ?? 0) : 0), 0);
  // Custom studio fee lives on paint-custom's catalog priceDelta; HDRI presets add on top.
  const hdriExtra = paintStudioPriceDelta(
    configuration.paintStudio ? { ...configuration.paintStudio, mode: "oem" } : undefined,
  );
  return baseMsrp + optionsTotal + hdriExtra;
}

/**
 * Standard amortizing-loan monthly payment: M = P * r(1+r)^n / ((1+r)^n - 1), where `r` is the
 * monthly interest rate and `n` the term in months. Falls back to a straight-line P/n split when
 * `aprPercent` is 0, since the amortization formula divides by zero there.
 *
 * An estimate only — real financing terms depend on credit, lender, and incentives this catalog
 * has no data for, same disclaimer this repo already applies to MSRP figures themselves.
 */
export function estimateMonthlyPayment(principal: number, aprPercent: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (aprPercent <= 0) return principal / termMonths;

  const monthlyRate = aprPercent / 100 / 12;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return (principal * monthlyRate * factor) / (factor - 1);
}

export function createConfigurationShareUrl(origin: string, pathname: string, configurationId: string): string {
  return `${origin}${pathname}#configuration=${encodeURIComponent(configurationId)}`;
}

export function readSharedConfigurationId(hash: string): string | null {
  const id = new URLSearchParams(hash.replace(/^#/, "")).get("configuration");
  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

export function filterBuildOptions(
  catalog: CustomizationOption[],
  query: string,
  selectedIds: ReadonlySet<string>,
  selectedOnly: boolean,
): CustomizationOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  return catalog.filter((option) => {
    if (selectedOnly && !selectedIds.has(option.id)) return false;
    return !normalized || option.label.toLocaleLowerCase().includes(normalized);
  });
}

export function calculateBuildProgress(configuration: VehicleConfiguration | null): number {
  if (!configuration) return 0;
  const completed = ["paint", "wheels", "trim", "accessory"].filter(
    (category) => (configuration.selections[category as keyof SelectionMap] ?? []).length > 0,
  ).length;
  return Math.round((completed / 4) * 100);
}

export function createRandomSelections(
  catalog: CustomizationOption[],
  random: () => number = Math.random,
): SelectionMap {
  const selections: SelectionMap = {};
  for (const category of CATEGORY_APPLY_ORDER) {
    const options = catalog.filter(
      (option) => option.category === category && option.id !== PAINT_CUSTOM_OPTION_ID,
    );
    if (options.length === 0) continue;
    const count = isMultiSelect(category) ? Math.min(options.length, random() > 0.65 ? 2 : 1) : 1;
    const shuffled = [...options];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    selections[category] = shuffled.slice(0, count).map((option) => option.id);
  }
  return selections;
}

export function formatBuildSummary(
  vehicleLabel: string,
  baseMsrp: number,
  catalog: CustomizationOption[],
  configuration: VehicleConfiguration,
): string {
  const selected = new Set(Object.values(configuration.selections).flat());
  const lines = catalog
    .filter((option) => selected.has(option.id))
    .map((option) => `- ${option.label}${option.priceDelta ? ` (+$${option.priceDelta.toLocaleString()})` : ""}`);
  return [
    `${vehicleLabel} build`,
    `Configuration: ${configuration.configurationId}`,
    `Grade: ${configuration.gradeId}`,
    `Base MSRP: $${baseMsrp.toLocaleString()}`,
    `Estimated total: $${estimateBuildTotal(baseMsrp, catalog, configuration).toLocaleString()}`,
    "",
    "Selected options:",
    ...(lines.length ? lines : ["- No upgrades selected"]),
  ].join("\n");
}
