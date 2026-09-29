import { describe, expect, it } from "vitest";
import { reconcileCompareSelection } from "../lib/showroom/compareSelection";

const CATALOG = ["rav4", "gr-supra", "camry", "tacoma"];

describe("reconcileCompareSelection", () => {
  it("keeps a selection the catalog fully knows, in the order it was picked", () => {
    expect(reconcileCompareSelection(["gr-supra", "rav4"], CATALOG)).toEqual({
      selected: ["gr-supra", "rav4"],
      dropped: [],
    });
  });

  it("splits an unknown slug out of the selection and reports it", () => {
    expect(reconcileCompareSelection(["rav4", "ghost-model"], CATALOG)).toEqual({
      selected: ["rav4"],
      dropped: ["ghost-model"],
    });
  });

  it("drops every unknown slug when none of the link's vehicles exist", () => {
    expect(reconcileCompareSelection(["ghost", "phantom"], CATALOG)).toEqual({
      selected: [],
      dropped: ["ghost", "phantom"],
    });
  });

  it("does not count an unknown slug toward the selection, so the cap stays honest", () => {
    // The regression this guards: `?vehicles=rav4,gr-supra,camry,ghost` used to leave four entries
    // in the selection, consuming the whole `MAX_COMPARE` (4) budget while the picker could only
    // show three checked boxes — every remaining vehicle was disabled with nothing to explain it.
    const { selected, dropped } = reconcileCompareSelection(["rav4", "gr-supra", "camry", "ghost"], CATALOG);

    expect(selected).toHaveLength(3);
    expect(dropped).toEqual(["ghost"]);
  });

  it("removes duplicates on both sides so a hand-typed URL cannot inflate the count", () => {
    expect(reconcileCompareSelection(["rav4", "rav4", "ghost", "ghost"], CATALOG)).toEqual({
      selected: ["rav4"],
      dropped: ["ghost"],
    });
  });

  it("is order-preserving for the dropped list too, so the notice names them as the link did", () => {
    expect(reconcileCompareSelection(["zzz", "rav4", "aaa"], CATALOG).dropped).toEqual(["zzz", "aaa"]);
  });

  it("accepts any iterable of known slugs", () => {
    expect(reconcileCompareSelection(["rav4", "ghost"], new Set(CATALOG)).selected).toEqual(["rav4"]);
    expect(reconcileCompareSelection(["rav4", "ghost"], []).selected).toEqual([]);
  });
});