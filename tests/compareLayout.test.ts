import { describe, expect, it } from "vitest";
import { canOfferCompare3d, columnViewports, compareKeyAction, fitDistance, withCompareModels } from "../lib/three/compareLayout";
import { VEHICLES } from "../lib/data/vehicles";

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

  it("counts only vehicles that ship a model (the Tacoma does not)", () => {
    const bySlug = (slug: string) => VEHICLES.find((vehicle) => vehicle.slug === slug)!;
    expect(withCompareModels([bySlug("tacoma"), bySlug("camry")]).map((vehicle) => vehicle.slug)).toEqual(["camry"]);
    expect(withCompareModels([bySlug("camry"), bySlug("land-cruiser")])).toHaveLength(2);
  });

  it("maps arrows to orbit, plus/minus to zoom and Home to re-frame, leaving other keys alone", () => {
    expect(compareKeyAction("ArrowLeft")).toMatchObject({ kind: "orbit", phi: 0 });
    expect((compareKeyAction("ArrowLeft") as { theta: number }).theta).toBeLessThan(0);
    expect((compareKeyAction("ArrowDown") as { phi: number }).phi).toBeGreaterThan(0);
    expect((compareKeyAction("+") as { factor: number }).factor).toBeLessThan(1);
    expect((compareKeyAction("-") as { factor: number }).factor).toBeGreaterThan(1);
    expect(compareKeyAction("Home")).toEqual({ kind: "reset" });
    expect(compareKeyAction("Tab")).toBeNull();
  });
});
