import { describe, expect, it } from "vitest";
import { canOfferCompare3d, columnViewports, fitDistance } from "../lib/three/compareLayout";

describe("compare stage layout", () => {
  it("splits the canvas into equal columns that never overlap", () => {
    const viewports = columnViewports(3, 1200, 400);
    expect(viewports).toHaveLength(3);
    expect(new Set(viewports.map((viewport) => viewport.width)).size).toBe(1);
    for (let index = 1; index < viewports.length; index += 1) {
      expect(viewports[index]!.x).toBeGreaterThanOrEqual(viewports[index - 1]!.x + viewports[index - 1]!.width);
    }
    expect(viewports.at(-1)!.x + viewports.at(-1)!.width).toBeLessThanOrEqual(1200);
    expect(columnViewports(0, 1200, 400)).toEqual([]);
  });

  it("backs the shared camera off far enough for the largest vehicle, and further in narrow columns", () => {
    const wide = fitDistance(3, 30, 1.6);
    const narrow = fitDistance(3, 30, 0.8);
    expect(narrow).toBeGreaterThan(wide);
    expect(fitDistance(4, 30, 1.6)).toBeGreaterThan(wide);
  });

  it("is only offered on wide screens with WebGL2 and without Save-Data", () => {
    expect(canOfferCompare3d({ width: 1280, hasWebGL2: true, saveData: false })).toBe(true);
    expect(canOfferCompare3d({ width: 700, hasWebGL2: true, saveData: false })).toBe(false);
    expect(canOfferCompare3d({ width: 1280, hasWebGL2: false, saveData: false })).toBe(false);
    expect(canOfferCompare3d({ width: 1280, hasWebGL2: true, saveData: true })).toBe(false);
  });
});
