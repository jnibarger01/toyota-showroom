import { describe, expect, it } from "vitest";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import {
  BUYER_STEPS,
  buyerStepForCategory,
  categoriesForBuyerStep,
  firstCategoryForBuyerStep,
} from "../lib/showroom/buyerFlow";

describe("OEM buyer flow", () => {
  it("keeps the public Build & Price step order stable", () => {
    expect(BUYER_STEPS.map((step) => step.id)).toEqual([
      "model",
      "grade",
      "exterior",
      "interior",
      "packages",
      "accessories",
      "summary",
    ]);
  });

  it("maps buyer-facing categories without swallowing 3D-only systems", () => {
    expect(buyerStepForCategory("paint")).toBe("exterior");
    expect(buyerStepForCategory("wheels")).toBe("exterior");
    expect(buyerStepForCategory("interior")).toBe("interior");
    expect(buyerStepForCategory("accessory")).toBe("accessories");
    expect(buyerStepForCategory("brakes")).toBeNull();
    expect(buyerStepForCategory("aero")).toBeNull();
  });

  it("only exposes categories that the vehicle catalog actually offers", () => {
    const exterior = categoriesForBuyerStep("exterior", fourRunnerOptions);
    expect(exterior).toContain("paint");
    expect(exterior).toContain("wheels");
    expect(firstCategoryForBuyerStep("exterior", fourRunnerOptions)).toBe("paint");
    expect(categoriesForBuyerStep("packages", fourRunnerOptions)).toEqual([]);
  });
});
