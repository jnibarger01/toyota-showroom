import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ApiError } from "../lib/api/errors";
import {
  DEFAULT_CUSTOM_MATERIAL,
  HDRI_PRESETS,
  PAINT_CUSTOM_OPTION_ID,
  PAINT_CUSTOM_PRICE_DELTA,
  materialConfigFromPaintStudio,
  paintStudioPriceDelta,
} from "../lib/data/paintStudio";
import { encodeBuildDeepLink, validateBuildDeepLink } from "../lib/showroom/deepLink";
import { estimateBuildTotal } from "../lib/showroom/buildTools";
import { VehicleSceneController } from "../lib/three/sceneController";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { verifyNodeContract } from "../lib/three/nodes";
import { colorHexAt, createVehicleFixture, materialAt } from "./fixtures/scene";
import {
  priceConfiguration,
  validateCreateConfiguration,
  validatePaintStudio,
} from "../lib/validation/configuration";
import type { VehicleConfiguration } from "../lib/types/customization";

function expectApiError(fn: () => unknown, match?: RegExp): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    if (match) expect((error as ApiError).message).toMatch(match);
    return;
  }
  throw new Error("expected ApiError");
}

describe("paint studio catalog", () => {
  it("exposes HDRI presets without client-authored URLs in persisted ids", () => {
    expect(HDRI_PRESETS.every((preset) => preset.id.startsWith("hdri-"))).toBe(true);
    expect(HDRI_PRESETS.some((preset) => preset.hdrUrl)).toBe(true);
  });

  it("maps custom material params without GLB names", () => {
    const config = materialConfigFromPaintStudio(DEFAULT_CUSTOM_MATERIAL);
    expect(config).toEqual({
      color: DEFAULT_CUSTOM_MATERIAL.color,
      metalness: DEFAULT_CUSTOM_MATERIAL.metalness,
      roughness: DEFAULT_CUSTOM_MATERIAL.roughness,
      clearcoat: DEFAULT_CUSTOM_MATERIAL.clearcoat,
      clearcoatRoughness: DEFAULT_CUSTOM_MATERIAL.clearcoatRoughness,
    });
    expect(JSON.stringify(config)).not.toMatch(/body\.carmain|BODY/);
  });
});

describe("paint studio validation", () => {
  it("accepts OEM mode with a catalog HDRI preset", () => {
    const state = validatePaintStudio(
      { mode: "oem", hdriPresetId: "hdri-showroom" },
      { paint: ["paint-218-blueprint"] },
    );
    expect(state).toEqual({ mode: "oem", hdriPresetId: "hdri-showroom" });
  });

  it("rejects OEM mode that still selects paint-custom", () => {
    expectApiError(
      () => validatePaintStudio({ mode: "oem" }, { paint: [PAINT_CUSTOM_OPTION_ID] }),
      /OEM paint mode/,
    );
  });

  it("requires material params and paint-custom in custom mode", () => {
    expectApiError(
      () => validatePaintStudio({ mode: "custom" }, { paint: [PAINT_CUSTOM_OPTION_ID] }),
      /material/,
    );
    const state = validatePaintStudio(
      { mode: "custom", hdriPresetId: "hdri-sunset", material: DEFAULT_CUSTOM_MATERIAL },
      { paint: [PAINT_CUSTOM_OPTION_ID] },
    );
    expect(state?.mode).toBe("custom");
    expect(state?.material?.color).toBe("#1558d6");
  });

  it("rejects GLB material names smuggled into paintStudio", () => {
    expectApiError(
      () =>
        validatePaintStudio(
          {
            mode: "custom",
            material: { ...DEFAULT_CUSTOM_MATERIAL, color: "body.carmain" },
          },
          { paint: [PAINT_CUSTOM_OPTION_ID] },
        ),
      /#rrggbb/,
    );
  });

  it("round-trips create validation for a custom studio build", () => {
    const validated = validateCreateConfiguration({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
      selections: { paint: [PAINT_CUSTOM_OPTION_ID] },
      paintStudio: {
        mode: "custom",
        hdriPresetId: "hdri-studio",
        material: { ...DEFAULT_CUSTOM_MATERIAL, metalness: 0.8 },
      },
    });
    expect(validated.paintStudio?.mode).toBe("custom");
    expect(validated.paintStudio?.material?.metalness).toBe(0.8);
  });
});

describe("paint studio pricing", () => {
  it("includes paint-custom catalog fee and HDRI deltas", () => {
    const total = priceConfiguration(
      "4runner",
      { paint: [PAINT_CUSTOM_OPTION_ID] },
      { mode: "custom", hdriPresetId: "hdri-sunset", material: DEFAULT_CUSTOM_MATERIAL },
    );
    expect(total).toBe(PAINT_CUSTOM_PRICE_DELTA + 175);

    const configuration = {
      configurationId: "cfg",
      vehicleId: "4runner",
      modelYear: 2024,
      model: "4Runner",
      gradeId: "trd-pro",
      selections: { paint: [PAINT_CUSTOM_OPTION_ID] },
      paintStudio: {
        mode: "custom" as const,
        hdriPresetId: "hdri-sunset",
        material: DEFAULT_CUSTOM_MATERIAL,
      },
      revision: 1,
      schemaVersion: "1.0.0",
      createdAt: "",
      updatedAt: "",
    } satisfies VehicleConfiguration;

    expect(
      estimateBuildTotal(40_000, fourRunnerOptions, configuration) - 40_000,
    ).toBe(PAINT_CUSTOM_PRICE_DELTA + 175);
  });
});

describe("paint studio deep link", () => {
  it("encodes custom params without GLB names", () => {
    const encoded = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections: { paint: [PAINT_CUSTOM_OPTION_ID] },
      paintStudio: {
        mode: "custom",
        hdriPresetId: "hdri-overcast",
        material: { ...DEFAULT_CUSTOM_MATERIAL, roughness: 0.42 },
      },
    });
    const json = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString(
      "utf8",
    );
    expect(json).not.toMatch(/body\.carmain|BODY/);
    const validated = validateBuildDeepLink("4runner", 2024, encoded);
    expect(validated.paintStudio?.mode).toBe("custom");
    expect(validated.paintStudio?.material?.roughness).toBe(0.42);
    expect(validated.paintStudio?.hdriPresetId).toBe("hdri-overcast");
  });
});

describe("paint studio scene application", () => {
  it("applies custom material params to body.carmain via catalog targets", async () => {
    const fixture = createVehicleFixture();
    const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
    const controller = new VehicleSceneController(fixture.root, satisfied);

    await controller.applyConfiguration(
      { paint: [PAINT_CUSTOM_OPTION_ID] },
      {
        mode: "custom",
        hdriPresetId: "hdri-studio",
        material: {
          color: "#ff00aa",
          metalness: 0.2,
          roughness: 0.7,
          clearcoat: 0.5,
          clearcoatRoughness: 0.2,
        },
      },
    );

    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("ff00aa");
    const material = materialAt(fixture.root, "BODY", "body.carmain") as THREE.MeshPhysicalMaterial;
    expect(material.metalness).toBeCloseTo(0.2);
    expect(material.roughness).toBeCloseTo(0.7);
    expect(material.clearcoat).toBeCloseTo(0.5);
    expect(material.clearcoatRoughness).toBeCloseTo(0.2);
  });
});
