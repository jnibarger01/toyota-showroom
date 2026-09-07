import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMIZATION_SCHEMA_VERSION, type CustomizationOption, type VehicleConfiguration } from "../lib/types/customization";
import {
  buildSharedOptionRows,
  canMutateConfiguration,
  listGaragePins,
  parseBuildIdsFromSearch,
  pinConfigurationToGarage,
  removeGarageBuild,
  resetGarageIndex,
  unpinConfigurationFromGarage,
  GARAGE_VEHICLE_ORDER,
  OWNER_TOKENS_STORAGE_KEY,
} from "../lib/showroom/garage";
import { localConfigurationTransport } from "../lib/api/localConfigurationTransport";

/** Minimal `window.localStorage` so garage + local transport run under the node test environment. */
function installLocalStorage(): void {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => void data.clear(),
  };
  (globalThis as Record<string, unknown>).window = { localStorage: storage };
  (globalThis as Record<string, unknown>).localStorage = storage;
}

function config(
  overrides: Partial<VehicleConfiguration> & Pick<VehicleConfiguration, "configurationId" | "vehicleId">,
): VehicleConfiguration {
  return {
    modelYear: 2024,
    model: overrides.vehicleId,
    gradeId: "sr5",
    selections: {},
    revision: 1,
    schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function option(
  overrides: Pick<CustomizationOption, "id" | "category" | "label" | "operation"> &
    Partial<CustomizationOption>,
): CustomizationOption {
  return {
    priceDelta: 0,
    compatibleVehicleIds: ["4runner", "tacoma"],
    ...overrides,
  };
}

describe("multi-vehicle garage", () => {
  beforeEach(() => {
    installLocalStorage();
    resetGarageIndex();
    vi.restoreAllMocks();
  });

  it("pins configs without duplicating and groups vehicle ids in issue order", () => {
    pinConfigurationToGarage(config({ configurationId: "cfg_tacoma_1", vehicleId: "tacoma", model: "Tacoma" }));
    pinConfigurationToGarage(config({ configurationId: "cfg_4r_1", vehicleId: "4runner", model: "4Runner" }));
    pinConfigurationToGarage(config({ configurationId: "cfg_ae86_1", vehicleId: "ae86", model: "AE86" }));
    pinConfigurationToGarage(config({ configurationId: "cfg_camry_1", vehicleId: "camry", model: "Camry" }));
    // Re-pin updates metadata rather than duplicating.
    pinConfigurationToGarage(
      config({ configurationId: "cfg_4r_1", vehicleId: "4runner", model: "4Runner", gradeId: "trd-pro" }),
    );

    const pins = listGaragePins();
    expect(pins).toHaveLength(4);
    expect(pins.find((p) => p.configurationId === "cfg_4r_1")?.gradeId).toBe("trd-pro");
    expect(GARAGE_VEHICLE_ORDER).toEqual(["4runner", "ae86", "tacoma", "camry"]);

    const byVehicle = new Map<string, string[]>();
    for (const pin of pins) {
      const list = byVehicle.get(pin.vehicleId) ?? [];
      list.push(pin.configurationId);
      byVehicle.set(pin.vehicleId, list);
    }
    const ordered = [
      ...GARAGE_VEHICLE_ORDER.filter((id) => byVehicle.has(id)),
      ...Array.from(byVehicle.keys()).filter((id) => !(GARAGE_VEHICLE_ORDER as readonly string[]).includes(id)),
    ];
    expect(ordered).toEqual(["4runner", "ae86", "tacoma", "camry"]);
  });

  it("buildSharedOptionRows aligns shared categories across vehicles", () => {
    const builds = [
      config({
        configurationId: "cfg_a",
        vehicleId: "4runner",
        model: "4Runner",
        selections: { paint: ["paint-a"], wheels: ["wheel-a"], accessory: ["light-a"] },
      }),
      config({
        configurationId: "cfg_b",
        vehicleId: "tacoma",
        model: "Tacoma",
        selections: { paint: ["paint-b"], wheels: ["wheel-b"] },
      }),
    ];

    const catalogs = new Map<string, CustomizationOption[]>([
      [
        "4runner",
        [
          option({ id: "paint-a", category: "paint", label: "Blue", operation: "material-update" }),
          option({ id: "wheel-a", category: "wheels", label: "Trail wheels", operation: "mesh-replacement", priceDelta: 100 }),
          option({ id: "light-a", category: "accessory", label: "Light bar", operation: "mesh-visibility", priceDelta: 50 }),
        ],
      ],
      [
        "tacoma",
        [
          option({ id: "paint-b", category: "paint", label: "Red", operation: "material-update" }),
          option({ id: "wheel-b", category: "wheels", label: "Off-road", operation: "mesh-replacement", priceDelta: 200 }),
        ],
      ],
    ]);

    const rows = buildSharedOptionRows(builds, catalogs);
    const byCategory = Object.fromEntries(rows.map((row) => [row.category, row]));

    expect(byCategory.paint.byBuild.get("cfg_a")).toBe("Blue");
    expect(byCategory.paint.byBuild.get("cfg_b")).toBe("Red");
    expect(byCategory.wheels.byBuild.get("cfg_a")).toBe("Trail wheels");
    expect(byCategory.accessory.byBuild.get("cfg_a")).toBe("Light bar");
    expect(byCategory.accessory.byBuild.get("cfg_b")).toBe("—");
  });

  it("canMutateConfiguration reflects remembered owner tokens", () => {
    expect(canMutateConfiguration("cfg_x")).toBe(false);
    localStorage.setItem(OWNER_TOKENS_STORAGE_KEY, JSON.stringify({ cfg_x: "tok" }));
    expect(canMutateConfiguration("cfg_x")).toBe(true);
  });

  it("removeGarageBuild deletes when owner token present and only unpins otherwise", async () => {
    const configurationsApi = await import("../lib/api/configurations");
    const deleteSpy = vi.spyOn(configurationsApi, "deleteConfiguration").mockResolvedValue(undefined);

    pinConfigurationToGarage(config({ configurationId: "cfg_owned", vehicleId: "4runner", model: "4Runner" }));
    pinConfigurationToGarage(config({ configurationId: "cfg_shared", vehicleId: "camry", model: "Camry" }));
    localStorage.setItem(OWNER_TOKENS_STORAGE_KEY, JSON.stringify({ cfg_owned: "token-plaintext" }));

    await expect(removeGarageBuild("cfg_owned")).resolves.toEqual({ deleted: true, unpinned: true });
    expect(deleteSpy).toHaveBeenCalledWith("cfg_owned");
    expect(listGaragePins().some((p) => p.configurationId === "cfg_owned")).toBe(false);

    deleteSpy.mockClear();
    await expect(removeGarageBuild("cfg_shared")).resolves.toEqual({ deleted: false, unpinned: true });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(listGaragePins().some((p) => p.configurationId === "cfg_shared")).toBe(false);

    deleteSpy.mockRestore();
  });

  it("unpinConfigurationFromGarage leaves the durable record alone", () => {
    pinConfigurationToGarage(config({ configurationId: "cfg_keep", vehicleId: "ae86", model: "AE86" }));
    unpinConfigurationFromGarage("cfg_keep");
    expect(listGaragePins()).toHaveLength(0);
  });

  it("parseBuildIdsFromSearch dedupes and trims", () => {
    expect(parseBuildIdsFromSearch("?builds=cfg_a,%20cfg_b,cfg_a")).toEqual(["cfg_a", "cfg_b"]);
    expect(parseBuildIdsFromSearch("?vehicles=4runner")).toEqual([]);
  });

  it("localConfigurationTransport.list returns stored configs", async () => {
    const { configuration: a } = await localConfigurationTransport.create({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
      selections: { paint: ["paint-218-blueprint"] },
    });
    const { configuration: b } = await localConfigurationTransport.create({
      vehicleId: "tacoma",
      modelYear: 2024,
      gradeId: "sr",
      selections: {},
    });
    const listed = localConfigurationTransport.list();
    expect(listed.map((c) => c.configurationId).sort()).toEqual(
      [a.configurationId, b.configurationId].sort(),
    );
  });
});
