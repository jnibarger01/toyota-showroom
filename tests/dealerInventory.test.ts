import { describe, expect, it } from "vitest";
import {
  CsvDealerInventoryAdapter,
  createCsvFixtureAdapter,
  DEALER_INVENTORY_CSV_FIXTURE,
  exploreBadgesForVehicle,
  matchBuildToInventory,
  parseDealerInventoryCsv,
  unitMatchesBuild,
} from "../lib/dealerInventory";

describe("CsvDealerInventoryAdapter", () => {
  it("parses the shipped CSV fixture into units keyed by stable option ids", async () => {
    const adapter = createCsvFixtureAdapter();
    expect(adapter.id).toBe("csv-fixture");

    const units = await adapter.load();
    expect(units.length).toBeGreaterThanOrEqual(4);

    const near = units.find((unit) => unit.id === "inv-4r-near");
    expect(near).toMatchObject({
      vehicleId: "4runner",
      dealerId: "dealer-austin",
      availability: "in_stock",
      distanceMiles: 12,
    });
    expect(near?.optionIds).toEqual([
      "paint-218-blueprint",
      "wheels-weisu-machined",
      "trim-grille-blackout",
    ]);
    // Labels must never appear in the feed — only kebab-case option ids.
    for (const id of near?.optionIds ?? []) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(id).not.toMatch(/\s/);
    }
  });

  it("rejects rows that only carry display labels instead of option ids", () => {
    const bad = `unit_id,vehicle_id,option_ids,dealer_id,availability
x,4runner,,dealer-a,in_stock
`;
    expect(() => parseDealerInventoryCsv(bad)).toThrow(/option_ids/);
  });

  it("supports a custom loadText provider (pluggable feed seam)", async () => {
    const csv = `unit_id,vehicle_id,option_ids,dealer_id,availability
u1,camry,paint-040-super-white,dealer-x,buildable
`;
    const adapter = new CsvDealerInventoryAdapter({
      id: "csv-custom",
      loadText: async () => csv,
    });
    const units = await adapter.load();
    expect(adapter.id).toBe("csv-custom");
    expect(units).toEqual([
      {
        id: "u1",
        vehicleId: "camry",
        optionIds: ["paint-040-super-white"],
        dealerId: "dealer-x",
        availability: "buildable",
      },
    ]);
  });
});

describe("matchBuildToInventory", () => {
  const units = parseDealerInventoryCsv(DEALER_INVENTORY_CSV_FIXTURE);

  it("matches on stable option ids and ignores display labels", () => {
    const buildIds = ["paint-218-blueprint", "wheels-weisu-machined", "trim-grille-blackout"];
    expect(unitMatchesBuild(units[0]!, "4runner", buildIds)).toBe(true);

    // Same human-facing paint described by label text must not match — ids only.
    expect(
      unitMatchesBuild(units[0]!, "4runner", ["Blueprint", "wheels-weisu-machined", "trim-grille-blackout"]),
    ).toBe(false);

    const result = matchBuildToInventory("4runner", buildIds, units);
    expect(result.matches.map((u) => u.id)).toContain("inv-4r-near");
    expect(result.nearMe.map((u) => u.id)).toEqual(["inv-4r-near"]);
    expect(result.buildable.map((u) => u.id)).not.toContain("inv-4r-near");
  });

  it("requires every build option id to be present on the unit", () => {
    const partial = matchBuildToInventory(
      "4runner",
      ["paint-218-blueprint", "wheels-weisu-machined", "accessory-underglow"],
      units,
    );
    expect(partial.matches).toEqual([]);
  });

  it("surfaces buildable matches outside the near-me radius", () => {
    const result = matchBuildToInventory(
      "4runner",
      ["paint-070-midnight-black", "wheels-weisu-bronze", "accessory-roof-rack"],
      units,
    );
    expect(result.matches.map((u) => u.id)).toEqual(["inv-4r-build"]);
    expect(result.nearMe).toEqual([]);
    expect(result.buildable.map((u) => u.id)).toEqual(["inv-4r-build"]);
  });
});

describe("exploreBadgesForVehicle", () => {
  const units = parseDealerInventoryCsv(DEALER_INVENTORY_CSV_FIXTURE);

  it("marks near-me and buildable independently per vehicle", () => {
    expect(exploreBadgesForVehicle("4runner", units)).toEqual(["near_me", "buildable"]);
    expect(exploreBadgesForVehicle("tacoma", units)).toEqual(["near_me"]);
    expect(exploreBadgesForVehicle("camry", units)).toEqual(["buildable"]);
    // Far in-stock unit (>50mi default) does not earn Near me.
    expect(exploreBadgesForVehicle("ae86", units)).toEqual([]);
    expect(exploreBadgesForVehicle("rav4", units)).toEqual([]);
  });
});
