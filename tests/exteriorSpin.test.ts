import { describe, expect, it } from "vitest";
import { rav4Hybrid } from "../lib/data/vehicles/rav4-hybrid";
import { rav4HybridOptions } from "../lib/data/options/rav4-hybrid";
import { exteriorSpinCatalogErrors, resolveExteriorSpin } from "../lib/showroom/exteriorSpin";
import type { VehicleConfiguration } from "../lib/types/customization";
import type { Vehicle } from "../lib/types/vehicle";

function configuration(
  gradeId: string,
  paintId?: string,
): Pick<VehicleConfiguration, "gradeId" | "selections"> {
  return {
    gradeId,
    selections: paintId ? { paint: [paintId] } : {},
  };
}

describe("exterior spin catalog", () => {
  it("accepts the RAV4 Hybrid pilot contract", () => {
    expect(exteriorSpinCatalogErrors(rav4Hybrid)).toEqual([]);
  });

  it("uses the first spin-backed grade paint when no explicit paint is selected", () => {
    const spin = resolveExteriorSpin(rav4Hybrid, rav4HybridOptions, configuration("xle"));
    expect(spin?.paintCode).toBe("040");
    expect(spin?.gradeId).toBe("xle");
  });

  it("resolves explicit OEM paint through its canonical paint code", () => {
    const spin = resolveExteriorSpin(
      rav4Hybrid,
      rav4HybridOptions,
      configuration("xle", "rav4h-paint-magnetic-gray"),
    );
    expect(spin?.paintCode).toBe("1G3");
  });

  it("falls back to 3D when a paint has no validated spin", () => {
    const spin = resolveExteriorSpin(
      rav4Hybrid,
      rav4HybridOptions,
      configuration("xle", "rav4h-paint-blueprint"),
    );
    expect(spin).toBeUndefined();
  });

  it("rejects a spin whose dimensions are below the production gate", () => {
    const vehicle = structuredClone(rav4Hybrid) as Vehicle;
    vehicle.media.exteriorSpins = vehicle.media.exteriorSpins?.map((spin, index) =>
      index === 0 ? { ...spin, width: 256, height: 256 } : spin,
    );
    expect(
      exteriorSpinCatalogErrors(vehicle).some((message) =>
        message.includes("source dimensions must be at least 512px in both axes"),
      ),
    ).toBe(true);
  });
});