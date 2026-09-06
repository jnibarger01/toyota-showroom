import { describe, expect, it } from "vitest";
import { calculateBuildProgress, createConfigurationShareUrl, createRandomSelections, estimateBuildTotal, estimateMonthlyPayment, filterBuildOptions, formatBuildSummary, readSharedConfigurationId, resolveGradeMsrp } from "../lib/showroom/buildTools";
import { fourRunner } from "../lib/data/vehicles/4runner";
import { fourRunnerOptions } from "../lib/data/options/4runner";

describe("showroom build tools", () => {
  it("calculates a configuration total from selected catalog options", () => {
    expect(estimateBuildTotal(50_000, [
      { id: "rack", category: "accessory", label: "Rack", operation: "mesh-visibility", priceDelta: 500, compatibleVehicleIds: ["4runner"] },
      { id: "paint", category: "paint", label: "Paint", operation: "material-update", priceDelta: 200, compatibleVehicleIds: ["4runner"] },
    ], { configurationId: "build-1", vehicleId: "4runner", modelYear: 2024, model: "4Runner", gradeId: "trd-pro", selections: { accessory: ["rack"] }, revision: 1, schemaVersion: "1", createdAt: "", updatedAt: "" })).toBe(50_500);
  });

  it("round-trips a safe share identifier and rejects malformed fragments", () => {
    expect(createConfigurationShareUrl("https://example.test", "/showroom/", "build_123")).toBe("https://example.test/showroom/#configuration=build_123");
    expect(readSharedConfigurationId("#configuration=build_123")).toBe("build_123");
    expect(readSharedConfigurationId("#configuration=../../bad")).toBeNull();
  });

  const catalog = [
    { id: "rack", category: "accessory" as const, label: "Roof Rack", operation: "mesh-visibility" as const, priceDelta: 500, compatibleVehicleIds: ["4runner"] },
    { id: "paint", category: "paint" as const, label: "Red Paint", operation: "material-update" as const, priceDelta: 200, compatibleVehicleIds: ["4runner"] },
  ];
  const configuration = { configurationId: "build-1", vehicleId: "4runner", modelYear: 2024, model: "4Runner", gradeId: "trd-pro", selections: { accessory: ["rack"], paint: ["paint"] }, revision: 1, schemaVersion: "1", createdAt: "", updatedAt: "" };

  it("filters options by query and selected state", () => {
    expect(filterBuildOptions(catalog, "roof", new Set(["rack"]), false).map((item) => item.id)).toEqual(["rack"]);
    expect(filterBuildOptions(catalog, "", new Set(["paint"]), true).map((item) => item.id)).toEqual(["paint"]);
  });

  it("measures progress across the guided build systems", () => {
    expect(calculateBuildProgress(configuration)).toBe(50);
  });

  it("creates deterministic random selections and a portable summary", () => {
    expect(createRandomSelections(catalog, () => 0)).toEqual({ paint: ["paint"], accessory: ["rack"] });
    expect(formatBuildSummary("2024 Toyota 4Runner", 50_000, catalog, configuration)).toContain("Estimated total: $50,700");
  });

  it("estimates a monthly financing payment via standard amortization", () => {
    // $30,000 at 6% APR over 60 months — a commonly-cited reference figure for this exact loan.
    expect(estimateMonthlyPayment(30_000, 6, 60)).toBeCloseTo(579.98, 1);
  });

  it("falls back to a straight-line split at 0% APR, where the amortization formula divides by zero", () => {
    expect(estimateMonthlyPayment(12_000, 0, 12)).toBe(1000);
  });

  it("returns 0 for a non-positive principal or term rather than dividing by zero or going negative", () => {
    expect(estimateMonthlyPayment(0, 6, 60)).toBe(0);
    expect(estimateMonthlyPayment(30_000, 6, 0)).toBe(0);
    expect(estimateMonthlyPayment(-500, 6, 60)).toBe(0);
  });

  it("resolves grade sticker price and falls back to the cheapest published MSRP", () => {
    expect(resolveGradeMsrp(fourRunner, "trd-pro")).toBe(53_900);
    expect(resolveGradeMsrp(fourRunner, "sr5")).toBe(40_455);
    expect(resolveGradeMsrp(fourRunner, "missing-grade")).toBe(40_455);
    expect(resolveGradeMsrp(null, "trd-pro")).toBe(0);
  });

  it("derives the same live total after a selection round-trip (restore path)", () => {
    const base = resolveGradeMsrp(fourRunner, "trd-pro");
    const configuration = {
      configurationId: "build-restore",
      vehicleId: "4runner",
      modelYear: 2024,
      model: "4Runner",
      gradeId: "trd-pro",
      selections: { paint: ["paint-0r2-solar-octane"], accessory: ["accessory-roof-rack"] },
      revision: 2,
      schemaVersion: "1.0.0",
      createdAt: "",
      updatedAt: "",
    };
    const before = estimateBuildTotal(base, fourRunnerOptions, configuration);
    // Simulate restore: only selections + grade come back; total is re-derived, never stored.
    const restored = { ...configuration, configurationId: "build-restore-copy" };
    expect(estimateBuildTotal(resolveGradeMsrp(fourRunner, restored.gradeId), fourRunnerOptions, restored)).toBe(before);
    expect(before).toBe(53_900 + 425 + 1_150);
  });
});
