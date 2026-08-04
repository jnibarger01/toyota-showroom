import { describe, expect, it } from "vitest";
import { createConfigurationShareUrl, estimateBuildTotal, readSharedConfigurationId } from "../lib/showroom/buildTools";

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
});
