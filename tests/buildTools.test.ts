import { describe, expect, it } from "vitest";
import { calculateBuildProgress, createConfigurationShareUrl, createRandomSelections, estimateBuildTotal, filterBuildOptions, formatBuildSummary, readSharedConfigurationId } from "../lib/showroom/buildTools";

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
});
