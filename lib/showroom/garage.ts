import {
  CATEGORY_APPLY_ORDER,
  type CustomizationCategory,
  type CustomizationOption,
  type VehicleConfiguration,
} from "../types/customization";
import { getPersistenceMode, getConfiguration, deleteConfiguration, listVehicleOptions } from "../api/configurations";
import { localConfigurationTransport } from "../api/localConfigurationTransport";
import { VEHICLES } from "../data/vehicles";

/**
 * Multi-vehicle garage (#17).
 *
 * Saved builds live in Worker/D1 or localConfigurationTransport; this module keeps a browser-side
 * *index* of configuration ids the user pinned via "Save build", plus helpers to load / group /
 * compare them. Mutable operations always go through `deleteConfiguration` / `updateConfiguration`
 * so owner-token rules stay enforced on the transport boundary — the garage never bypasses them.
 */

export const GARAGE_INDEX_KEY = "toyota-showroom:garage:v1";
export const OWNER_TOKENS_STORAGE_KEY = "toyota-showroom:ownerTokens";

/** Display order for garage groupings — matches issue #17's vehicle list. */
export const GARAGE_VEHICLE_ORDER = ["4runner", "ae86", "tacoma", "camry"] as const;

export type GarageVehicleId = (typeof GARAGE_VEHICLE_ORDER)[number];

export interface GaragePin {
  configurationId: string;
  vehicleId: string;
  modelYear: number;
  model: string;
  gradeId: string;
  /** ISO timestamp when the user pinned this build into the garage. */
  pinnedAt: string;
  label?: string;
}

export interface GarageGroup {
  vehicleId: string;
  model: string;
  year: number;
  builds: GarageBuildSummary[];
}

export interface GarageBuildSummary {
  pin: GaragePin;
  configuration: VehicleConfiguration | null;
  /** True when this browser holds the owner token for mutable ops. */
  canMutate: boolean;
  /** Load failure message when GET failed (deleted remotely, etc.). */
  loadError?: string;
}

export const CATEGORY_LABELS: Record<CustomizationCategory, string> = {
  paint: "Exterior",
  wheels: "Wheels & Tires",
  hood: "Hood",
  panel: "Performance",
  decal: "Accessories",
  trim: "Suspension",
  accessory: "Lighting",
  interior: "Interior",
};

type GarageIndex = Record<string, GaragePin>;

function readIndex(): GarageIndex {
  try {
    const raw = window.localStorage.getItem(GARAGE_INDEX_KEY);
    return raw ? (JSON.parse(raw) as GarageIndex) : {};
  } catch {
    return {};
  }
}

function writeIndex(index: GarageIndex): void {
  try {
    window.localStorage.setItem(GARAGE_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Quota / private mode: garage listing degrades; persistence of the config itself is unchanged.
  }
}

function readOwnerTokenMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(OWNER_TOKENS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Whether this browser can PATCH/DELETE the configuration (has a remembered owner token). */
export function canMutateConfiguration(configurationId: string): boolean {
  return Boolean(readOwnerTokenMap()[configurationId]);
}

export function listGaragePins(): GaragePin[] {
  return Object.values(readIndex()).sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt));
}

/**
 * Pin a configuration into the garage index. Idempotent for the same id — refreshes metadata and
 * `pinnedAt` so a re-save bubbles it to the top without creating duplicates.
 */
export function pinConfigurationToGarage(
  configuration: VehicleConfiguration,
  options: { label?: string } = {},
): GaragePin {
  const index = readIndex();
  const pin: GaragePin = {
    configurationId: configuration.configurationId,
    vehicleId: configuration.vehicleId,
    modelYear: configuration.modelYear,
    model: configuration.model,
    gradeId: configuration.gradeId,
    pinnedAt: new Date().toISOString(),
    ...(options.label ? { label: options.label } : index[configuration.configurationId]?.label
      ? { label: index[configuration.configurationId].label }
      : {}),
  };
  index[configuration.configurationId] = pin;
  writeIndex(index);
  return pin;
}

export function unpinConfigurationFromGarage(configurationId: string): void {
  const index = readIndex();
  delete index[configurationId];
  writeIndex(index);
}

/**
 * Discover configurations this browser knows about beyond explicit pins: owner-token map keys and
 * (when on local persistence) every record in the local store. Used to keep the garage useful even
 * if the user never clicked "Save build" after an auto-created session.
 */
export async function discoverOwnedConfigurationIds(): Promise<string[]> {
  const ids = new Set<string>(Object.keys(readOwnerTokenMap()));
  for (const pin of listGaragePins()) ids.add(pin.configurationId);

  if (getPersistenceMode() === "local" || typeof window !== "undefined") {
    try {
      for (const configuration of localConfigurationTransport.list()) {
        ids.add(configuration.configurationId);
      }
    } catch {
      // localStorage unavailable — stick to tokens + pins.
    }
  }

  return Array.from(ids);
}

function vehicleMeta(vehicleId: string): { model: string; year: number } {
  const catalog = VEHICLES.find((vehicle) => vehicle.slug === vehicleId);
  if (catalog) return { model: catalog.model, year: catalog.year };
  return { model: vehicleId, year: 0 };
}

/**
 * Load garage builds: prefer explicit pins; when empty, surface discovered owned configs so a
 * first visit after saving still shows something. Groups by vehicle in `GARAGE_VEHICLE_ORDER`.
 */
export async function loadGarageGroups(): Promise<GarageGroup[]> {
  let pins = listGaragePins();

  if (pins.length === 0) {
    const discovered = await discoverOwnedConfigurationIds();
    const synthesized: GaragePin[] = [];
    for (const configurationId of discovered) {
      try {
        const configuration = await getConfiguration(configurationId);
        const pin = pinConfigurationToGarage(configuration);
        synthesized.push(pin);
      } catch {
        // Stale id — skip.
      }
    }
    pins = synthesized;
  }

  const summaries: GarageBuildSummary[] = await Promise.all(
    pins.map(async (pin) => {
      try {
        const configuration = await getConfiguration(pin.configurationId);
        return {
          pin: {
            ...pin,
            vehicleId: configuration.vehicleId,
            modelYear: configuration.modelYear,
            model: configuration.model,
            gradeId: configuration.gradeId,
          },
          configuration,
          canMutate: canMutateConfiguration(pin.configurationId),
        };
      } catch (error) {
        return {
          pin,
          configuration: null,
          canMutate: canMutateConfiguration(pin.configurationId),
          loadError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const byVehicle = new Map<string, GarageBuildSummary[]>();
  for (const summary of summaries) {
    const key = summary.pin.vehicleId;
    const list = byVehicle.get(key) ?? [];
    list.push(summary);
    byVehicle.set(key, list);
  }

  const orderedIds = [
    ...GARAGE_VEHICLE_ORDER.filter((id) => byVehicle.has(id)),
    ...Array.from(byVehicle.keys()).filter((id) => !(GARAGE_VEHICLE_ORDER as readonly string[]).includes(id)),
  ];

  return orderedIds.map((vehicleId) => {
    const meta = vehicleMeta(vehicleId);
    const builds = byVehicle.get(vehicleId) ?? [];
    const sample = builds.find((b) => b.configuration)?.configuration;
    return {
      vehicleId,
      model: sample?.model ?? meta.model,
      year: sample?.modelYear ?? meta.year,
      builds,
    };
  });
}

/**
 * Remove from the garage index and, when this browser owns the token, delete the durable record.
 * Read-only visitors (shared link, no token) can only unpin locally — never mutate the remote row.
 */
export async function removeGarageBuild(configurationId: string): Promise<{ deleted: boolean; unpinned: boolean }> {
  const owned = canMutateConfiguration(configurationId);
  if (owned) {
    await deleteConfiguration(configurationId);
    unpinConfigurationFromGarage(configurationId);
    return { deleted: true, unpinned: true };
  }
  unpinConfigurationFromGarage(configurationId);
  return { deleted: false, unpinned: true };
}

/** Row for side-by-side build comparison — one option category shared across selected builds. */
export interface BuildCompareRow {
  category: CustomizationCategory;
  label: string;
  /** configurationId → human-readable selection labels (joined), or "—" when empty/unknown. */
  byBuild: Map<string, string>;
}

/**
 * Build comparison rows from shared option categories. Categories appear when at least one build
 * has a selection in that category (or the category exists in any of the loaded catalogs).
 */
export function buildSharedOptionRows(
  builds: VehicleConfiguration[],
  catalogsByVehicle: Map<string, CustomizationOption[]>,
): BuildCompareRow[] {
  const rows: BuildCompareRow[] = [];

  for (const category of CATEGORY_APPLY_ORDER) {
    const byBuild = new Map<string, string>();
    let anyValue = false;

    for (const build of builds) {
      const ids = build.selections[category] ?? [];
      const catalog = catalogsByVehicle.get(build.vehicleId) ?? [];
      if (ids.length === 0) {
        byBuild.set(build.configurationId, "—");
        continue;
      }
      anyValue = true;
      const labels = ids.map((id) => catalog.find((option) => option.id === id)?.label ?? id);
      byBuild.set(build.configurationId, labels.join(", "));
    }

    if (!anyValue) continue;
    rows.push({ category, label: CATEGORY_LABELS[category], byBuild });
  }

  return rows;
}

/** Load option catalogs for every distinct vehicleId among the builds. */
export async function loadCatalogsForBuilds(
  builds: VehicleConfiguration[],
): Promise<Map<string, CustomizationOption[]>> {
  const vehicleIds = Array.from(new Set(builds.map((build) => build.vehicleId)));
  const entries = await Promise.all(
    vehicleIds.map(async (vehicleId) => {
      const options = await listVehicleOptions(vehicleId);
      return [vehicleId, options] as const;
    }),
  );
  return new Map(entries);
}

/** Parse `?builds=id1,id2` from a search string. */
export function parseBuildIdsFromSearch(search: string): string[] {
  const raw = new URLSearchParams(search).get("builds") ?? "";
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  return Array.from(new Set(ids));
}

/** Test hook: clear the garage index. */
export function resetGarageIndex(): void {
  try {
    window.localStorage.removeItem(GARAGE_INDEX_KEY);
  } catch {
    /* ignore */
  }
}
