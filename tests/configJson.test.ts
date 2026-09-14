import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import { CUSTOMIZATION_SCHEMA_VERSION } from "../lib/types/customization";
import type { CameraState, SelectionMap } from "../lib/types/customization";
import {
  CONFIG_JSON_KIND,
  CONFIG_JSON_SCHEMA_VERSION,
  exportConfigurationJson,
  formatConfigurationJsonError,
  validateConfigurationJson,
} from "../lib/showroom/configJson";

const heroCamera: CameraState = {
  presetId: "hero",
  position: [7.5, 4.0, 8.5],
  target: [0, 1.1, 0],
};

const fourRunnerSelections: SelectionMap = {
  paint: ["paint-3u5-barcelona-red"],
  wheels: ["wheels-weisu-bronze"],
  accessory: ["accessory-roof-rack", "accessory-rock-sliders"],
};

describe("configuration JSON export / import", () => {
  it("round-trips a validated 4Runner build (selections + camera)", () => {
    const json = exportConfigurationJson({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
      selections: fourRunnerSelections,
      cameraState: heroCamera,
      exportedAt: "2026-09-14T15:00:00.000Z",
    });

    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.kind).toBe(CONFIG_JSON_KIND);
    expect(parsed.schemaVersion).toBe(CONFIG_JSON_SCHEMA_VERSION);
    expect(parsed.customizationSchemaVersion).toBe(CUSTOMIZATION_SCHEMA_VERSION);
    expect(parsed.exportedAt).toBe("2026-09-14T15:00:00.000Z");
    expect(parsed.vehicleId).toBe("4runner");
    expect(parsed.model).toBe("4Runner");
    expect(parsed.gradeId).toBe("trd-pro");
    expect(parsed.selections).toEqual(fourRunnerSelections);
    expect(parsed.cameraState).toEqual(heroCamera);

    const imported = validateConfigurationJson(json, {
      expectedVehicleId: "4runner",
      expectedModelYear: 2024,
    });
    expect(imported.gradeId).toBe("trd-pro");
    expect(imported.selections).toEqual(fourRunnerSelections);
    expect(imported.cameraState).toEqual(heroCamera);
    expect(imported.model).toBe("4Runner");
  });

  it("round-trips paint-studio custom mode with catalog paint-custom", () => {
    const selections: SelectionMap = { paint: ["paint-custom"] };
    const paintStudio = {
      mode: "custom" as const,
      hdriPresetId: "hdri-studio",
      material: {
        color: "#1558d6",
        metalness: 0.65,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      },
    };
    const json = exportConfigurationJson({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
      selections,
      paintStudio,
    });
    const imported = validateConfigurationJson(json);
    expect(imported.selections).toEqual(selections);
    expect(imported.paintStudio?.mode).toBe("custom");
    expect(imported.paintStudio?.material?.color).toBe("#1558d6");
  });

  it("rejects invalid JSON, wrong kind, and schema version mismatches with clear errors", () => {
    expect(() => validateConfigurationJson("{")).toThrow(/not valid JSON/i);
    expect(() => validateConfigurationJson("{}")).toThrow(/Not a Toyota Showroom configuration export/);
    expect(() =>
      validateConfigurationJson(
        JSON.stringify({
          kind: CONFIG_JSON_KIND,
          schemaVersion: 99,
          vehicleId: "4runner",
          modelYear: 2024,
          gradeId: "trd-pro",
          selections: {},
        }),
      ),
    ).toThrow(/Unsupported configuration JSON schema version "99"/);

    expect(() =>
      validateConfigurationJson(
        JSON.stringify({
          kind: CONFIG_JSON_KIND,
          schemaVersion: CONFIG_JSON_SCHEMA_VERSION,
          customizationSchemaVersion: "0.0.0",
          vehicleId: "4runner",
          modelYear: 2024,
          gradeId: "trd-pro",
          selections: {},
        }),
      ),
    ).toThrow(/Unsupported customization schema version "0.0.0"/);

    const mismatch = exportConfigurationJson({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
      selections: { paint: ["paint-1j9-ice-cap"] },
    });
    expect(() =>
      validateConfigurationJson(mismatch, { expectedVehicleId: "rav4", expectedModelYear: 2024 }),
    ).toThrow(/open that vehicle to import/i);
  });

  it("rejects unknown option ids via the same validators as Worker/local transports", () => {
    const payload = {
      kind: CONFIG_JSON_KIND,
      schemaVersion: CONFIG_JSON_SCHEMA_VERSION,
      customizationSchemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      exportedAt: "2026-09-14T15:00:00.000Z",
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
      selections: { paint: ["paint-does-not-exist"] },
    };
    expect(() => validateConfigurationJson(JSON.stringify(payload))).toThrow(ApiError);
    expect(() => validateConfigurationJson(JSON.stringify(payload))).toThrow(/Unknown option id/);

    // Solar Octane is TRD Pro-only — SR5 must reject it the same way a saved config would.
    const gradeClash = {
      ...payload,
      gradeId: "sr5",
      selections: { paint: ["paint-0r2-solar-octane"] },
    };
    expect(() => validateConfigurationJson(JSON.stringify(gradeClash))).toThrow(
      /not available on grade/i,
    );
  });

  it("formats ApiError messages for import UX", () => {
    try {
      validateConfigurationJson("not-json");
    } catch (error) {
      expect(formatConfigurationJsonError(error)).toMatch(/not valid JSON/i);
    }
  });
});
