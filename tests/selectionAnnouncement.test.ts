import { describe, expect, it } from "vitest";
import { describeGradeChange, describeSelectionChange } from "../lib/showroom/selectionAnnouncement";
import type { CustomizationOption, SelectionMap } from "../lib/types/customization";

const catalog = [
  { id: "paint-red", label: "Barcelona Red", category: "paint" },
  { id: "paint-blue", label: "Blueprint", category: "paint" },
  { id: "wheel-trd", label: "TRD Bronze", category: "wheels" },
  { id: "acc-rack", label: "Roof Rack", category: "accessory" },
] as unknown as CustomizationOption[];

const map = (entries: Partial<Record<string, string[]>>): SelectionMap => entries as SelectionMap;

describe("describeSelectionChange", () => {
  it("returns null when nothing changed, so the live region is not re-announced", () => {
    const selections = map({ paint: ["paint-red"] });
    expect(describeSelectionChange(selections, selections, catalog)).toBeNull();
  });

  it("announces a first selection with its category", () => {
    expect(describeSelectionChange(map({}), map({ paint: ["paint-red"] }), catalog)).toBe(
      "Paint: Barcelona Red selected.",
    );
  });

  it("announces only the arrival when one option replaces another", () => {
    // What a sighted viewer perceives is the new paint, not the departure of the old one —
    // mentioning both would describe the mechanism rather than the change.
    expect(
      describeSelectionChange(map({ paint: ["paint-red"] }), map({ paint: ["paint-blue"] }), catalog),
    ).toBe("Paint: Blueprint selected.");
  });

  it("announces a removal on its own", () => {
    expect(describeSelectionChange(map({ accessory: ["acc-rack"] }), map({ accessory: [] }), catalog)).toBe(
      "Accessory: Roof Rack removed.",
    );
  });

  it("summarises a multi-category change by count rather than reading every option", () => {
    // A grade switch can drop several incompatible options at once; reading each aloud buries what
    // the viewer actually did.
    const before = map({ paint: ["paint-red"], wheels: ["wheel-trd"], accessory: ["acc-rack"] });
    const after = map({ paint: ["paint-blue"], wheels: [], accessory: [] });
    expect(describeSelectionChange(before, after, catalog)).toBe("1 option added, 3 options removed.");
  });

  it("falls back to the option id when the catalog has no label for it", () => {
    expect(describeSelectionChange(map({}), map({ paint: ["paint-unknown"] }), catalog)).toBe(
      "Paint: paint-unknown selected.",
    );
  });

  it("treats an absent category and an empty one as the same", () => {
    expect(describeSelectionChange(map({ paint: [] }), map({}), catalog)).toBeNull();
  });
});

describe("describeGradeChange", () => {
  it("names the grade, which selections alone cannot convey", () => {
    expect(describeGradeChange("TRD Pro")).toBe("Grade changed to TRD Pro.");
  });
});
