import {
  CATEGORY_APPLY_ORDER,
  isMultiSelect,
  type CustomizationOption,
  type SelectionMap,
  type VehicleConfiguration,
} from "../types/customization";

export function estimateBuildTotal(baseMsrp: number, catalog: CustomizationOption[], configuration: VehicleConfiguration | null): number {
  if (!configuration) return baseMsrp;
  const selected = new Set(Object.values(configuration.selections).flat());
  return baseMsrp + catalog.reduce((total, option) => total + (selected.has(option.id) ? (option.priceDelta ?? 0) : 0), 0);
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
    const options = catalog.filter((option) => option.category === category);
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
