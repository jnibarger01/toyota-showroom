import type { CustomizationOption, VehicleConfiguration } from "../types/customization";

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
