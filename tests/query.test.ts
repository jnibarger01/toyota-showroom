import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  matchesFilters,
  paginateAndFilter,
  queryVehicles,
  type VehicleFilters,
} from "../lib/api/query";
import { VEHICLES } from "../lib/data/vehicles";
import type { VehicleQueryFacts } from "../lib/types/vehicle";

/**
 * `matchesFilters`/`paginateAndFilter` are the one filter/pagination implementation shared by
 * `GET /api/v1/vehicles` (server, over full `Vehicle` records via `queryVehicles`) and
 * `lib/api/client.ts`'s `listVehicles` (browser, over the cached static `VehicleSummary` snapshot)
 * — see that file's top comment. Neither had a direct test until now; both were only exercised
 * indirectly through `transport.test.ts`'s catalog-read cases.
 */

function facts(overrides: Partial<VehicleQueryFacts> = {}): VehicleQueryFacts {
  return {
    bodyStyle: "suv",
    categories: ["suv"],
    availability: "in_production",
    drivetrains: ["4wd"],
    powertrainTypes: ["gas"],
    maxSeating: 5,
    maxTowingLbs: 5000,
    startingMsrp: 40000,
    ...overrides,
  };
}

describe("matchesFilters", () => {
  it("matches everything when no filter is set", () => {
    expect(matchesFilters(facts(), {})).toBe(true);
  });

  it("filters by bodyStyle", () => {
    expect(matchesFilters(facts({ bodyStyle: "truck" }), { bodyStyle: ["suv"] })).toBe(false);
    expect(matchesFilters(facts({ bodyStyle: "truck" }), { bodyStyle: ["truck", "suv"] })).toBe(true);
  });

  it("filters by category as an any-of match against the vehicle's category list", () => {
    const item = facts({ categories: ["suv", "off-road", "truck-based"] });
    expect(matchesFilters(item, { category: ["off-road"] })).toBe(true);
    expect(matchesFilters(item, { category: ["luxury"] })).toBe(false);
  });

  it("filters by availability", () => {
    expect(matchesFilters(facts({ availability: "coming_soon" }), { availability: ["in_production"] })).toBe(false);
    expect(matchesFilters(facts({ availability: "coming_soon" }), { availability: ["coming_soon", "discontinued"] })).toBe(true);
  });

  it("filters by drivetrain as an any-of match against every powertrain the vehicle offers", () => {
    const item = facts({ drivetrains: ["fwd", "awd"] });
    expect(matchesFilters(item, { drivetrain: ["awd"] })).toBe(true);
    expect(matchesFilters(item, { drivetrain: ["4wd"] })).toBe(false);
  });

  it("filters by powertrainType the same way", () => {
    const item = facts({ powertrainTypes: ["gas", "hybrid"] });
    expect(matchesFilters(item, { powertrainType: ["hybrid"] })).toBe(true);
    expect(matchesFilters(item, { powertrainType: ["bev"] })).toBe(false);
  });

  it("filters by price range, inclusive at both ends", () => {
    const item = facts({ startingMsrp: 40000 });
    expect(matchesFilters(item, { minPrice: 40000 })).toBe(true);
    expect(matchesFilters(item, { minPrice: 40001 })).toBe(false);
    expect(matchesFilters(item, { maxPrice: 40000 })).toBe(true);
    expect(matchesFilters(item, { maxPrice: 39999 })).toBe(false);
  });

  it("filters by minSeating against the vehicle's maximum, not every grade", () => {
    expect(matchesFilters(facts({ maxSeating: 7 }), { minSeating: 7 })).toBe(true);
    expect(matchesFilters(facts({ maxSeating: 5 }), { minSeating: 7 })).toBe(false);
  });

  it("filters by minTowingLbs, where a vehicle with no towing spec facts to 0", () => {
    expect(matchesFilters(facts({ maxTowingLbs: 0 }), { minTowingLbs: 1 })).toBe(false);
    expect(matchesFilters(facts({ maxTowingLbs: 6500 }), { minTowingLbs: 6000 })).toBe(true);
  });

  it("requires every provided filter dimension to match, not just one", () => {
    const item = facts({ bodyStyle: "suv", startingMsrp: 60000 });
    const filters: VehicleFilters = { bodyStyle: ["suv"], maxPrice: 50000 };
    expect(matchesFilters(item, filters)).toBe(false);
  });

  it("an empty filter array for a dimension is treated as unset, not as excluding everything", () => {
    expect(matchesFilters(facts(), { bodyStyle: [] })).toBe(true);
  });
});

describe("paginateAndFilter", () => {
  const items = Array.from({ length: 25 }, (_, i) => facts({ startingMsrp: i }));

  it("defaults to page 1 at DEFAULT_PAGE_SIZE when no pagination is given", () => {
    const result = paginateAndFilter(items);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(result.data).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(result.totalItems).toBe(25);
    expect(result.totalPages).toBe(Math.ceil(25 / DEFAULT_PAGE_SIZE));
  });

  it("slices later pages correctly, including a partial final page", () => {
    const pageSize = 10;
    const last = paginateAndFilter(items, {}, { page: 3, pageSize });
    expect(last.data).toHaveLength(5); // 25 items, page 3 of size 10 → items 21-25
    expect(last.totalPages).toBe(3);
  });

  it("clamps a requested page below 1 up to 1", () => {
    const result = paginateAndFilter(items, {}, { page: 0, pageSize: 10 });
    expect(result.page).toBe(1);
  });

  it("clamps a requested page past the last one down to the last page", () => {
    const result = paginateAndFilter(items, {}, { page: 999, pageSize: 10 });
    expect(result.page).toBe(3);
    expect(result.data).toHaveLength(5);
  });

  it("clamps pageSize to MAX_PAGE_SIZE", () => {
    const result = paginateAndFilter(items, {}, { page: 1, pageSize: 1000 });
    expect(result.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("clamps pageSize up to at least 1", () => {
    const result = paginateAndFilter(items, {}, { page: 1, pageSize: 0 });
    expect(result.pageSize).toBe(1);
  });

  it("reports totalPages: 1 (not 0) when a filter matches nothing, and page 1 with no data", () => {
    const result = paginateAndFilter(items, { minPrice: 999 });
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
    expect(result.data).toEqual([]);
  });

  it("applies filtering before pagination, so totalItems reflects the filtered set", () => {
    const result = paginateAndFilter(items, { minPrice: 20 }, { page: 1, pageSize: 10 });
    expect(result.totalItems).toBe(5); // startingMsrp 20..24
  });
});

describe("queryVehicles (real catalog)", () => {
  it("finds exactly the Tacoma when filtering by bodyStyle truck", () => {
    const result = queryVehicles(VEHICLES, { bodyStyle: ["truck"] });
    expect(result.data.map((v) => v.slug)).toEqual(["tacoma"]);
  });

  it("excludes the Camry (no towing spec) when a minimum towing capacity is required", () => {
    const result = queryVehicles(VEHICLES, { minTowingLbs: 1 });
    expect(result.data.map((v) => v.slug).sort()).toEqual(["4runner", "tacoma"]);
  });

  it("finds the Camry via its hybrid powertrain and awd drivetrain facts", () => {
    expect(queryVehicles(VEHICLES, { powertrainType: ["hybrid"] }).data.map((v) => v.slug)).toContain("camry");
    expect(queryVehicles(VEHICLES, { drivetrain: ["awd"] }).data.map((v) => v.slug)).toEqual(["camry"]);
  });

  it("paginates the real three-vehicle catalog one at a time in a stable order", () => {
    const first = queryVehicles(VEHICLES, {}, { page: 1, pageSize: 1 });
    const second = queryVehicles(VEHICLES, {}, { page: 2, pageSize: 1 });
    const third = queryVehicles(VEHICLES, {}, { page: 3, pageSize: 1 });
    expect(first.totalItems).toBe(VEHICLES.length);
    expect([first, second, third].map((r) => r.data[0]?.slug)).toEqual(VEHICLES.map((v) => v.slug));
  });
});
