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

type TestVehicle = VehicleQueryFacts & { id: string };

const baseVehicle: TestVehicle = {
  id: "base",
  bodyStyle: "suv",
  categories: ["suv", "off-road"],
  availability: "in_production",
  drivetrains: ["4wd"],
  powertrainTypes: ["gas"],
  maxSeating: 5,
  maxTowingLbs: 5_000,
  startingMsrp: 40_000,
};

function vehicle(id: string, overrides: Partial<TestVehicle> = {}): TestVehicle {
  return { ...baseVehicle, id, ...overrides };
}

describe("matchesFilters", () => {
  const dimensions: Array<{
    name: string;
    matching: VehicleFilters;
    rejecting: VehicleFilters;
  }> = [
    { name: "body style", matching: { bodyStyle: ["suv"] }, rejecting: { bodyStyle: ["sedan"] } },
    { name: "category", matching: { category: ["off-road"] }, rejecting: { category: ["electrified"] } },
    { name: "availability", matching: { availability: ["in_production"] }, rejecting: { availability: ["discontinued"] } },
    { name: "drivetrain", matching: { drivetrain: ["4wd"] }, rejecting: { drivetrain: ["fwd", "awd"] } },
    { name: "powertrain type", matching: { powertrainType: ["gas"] }, rejecting: { powertrainType: ["hybrid"] } },
    { name: "minimum price", matching: { minPrice: 40_000 }, rejecting: { minPrice: 40_001 } },
    { name: "maximum price", matching: { maxPrice: 40_000 }, rejecting: { maxPrice: 39_999 } },
    { name: "minimum seating", matching: { minSeating: 5 }, rejecting: { minSeating: 6 } },
    { name: "minimum towing", matching: { minTowingLbs: 5_000 }, rejecting: { minTowingLbs: 5_001 } },
  ];

  for (const { name, matching, rejecting } of dimensions) {
    it(`applies the ${name} filter`, () => {
      expect(matchesFilters(baseVehicle, matching)).toBe(true);
      expect(matchesFilters(baseVehicle, rejecting)).toBe(false);
    });
  }

  it("treats values within each array filter as alternatives", () => {
    expect(
      matchesFilters(baseVehicle, {
        bodyStyle: ["sedan", "suv"],
        category: ["hybrid", "off-road"],
        drivetrain: ["awd", "4wd"],
        powertrainType: ["bev", "gas"],
      }),
    ).toBe(true);
  });

  it("treats empty filter arrays and an empty filter object as unrestricted", () => {
    expect(matchesFilters(baseVehicle, {})).toBe(true);
    expect(
      matchesFilters(baseVehicle, {
        bodyStyle: [],
        category: [],
        availability: [],
        drivetrain: [],
        powertrainType: [],
      }),
    ).toBe(true);
  });

  it("requires every populated filter dimension to match", () => {
    const combined: VehicleFilters = {
      bodyStyle: ["suv"],
      category: ["off-road"],
      availability: ["in_production"],
      drivetrain: ["4wd"],
      powertrainType: ["gas"],
      minPrice: 35_000,
      maxPrice: 45_000,
      minSeating: 5,
      minTowingLbs: 4_500,
    };

    expect(matchesFilters(baseVehicle, combined)).toBe(true);
    expect(matchesFilters(baseVehicle, { ...combined, minTowingLbs: 5_001 })).toBe(false);
  });
});

describe("paginateAndFilter", () => {
  const items = Array.from({ length: 75 }, (_, index) =>
    vehicle(`vehicle-${index + 1}`, {
      bodyStyle: index % 2 === 0 ? "suv" : "sedan",
      startingMsrp: 30_000 + index * 1_000,
    }),
  );

  it("uses the documented default pagination", () => {
    const result = paginateAndFilter(items);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(result.totalItems).toBe(75);
    expect(result.totalPages).toBe(7);
    expect(result.data.map((item) => item.id)).toEqual(
      Array.from({ length: DEFAULT_PAGE_SIZE }, (_, index) => `vehicle-${index + 1}`),
    );
  });

  it("filters before calculating totals and slicing a page", () => {
    const result = paginateAndFilter(items, { bodyStyle: ["sedan"], maxPrice: 60_000 }, { page: 2, pageSize: 5 });

    expect(result).toMatchObject({ page: 2, pageSize: 5, totalItems: 15, totalPages: 3 });
    expect(result.data.map((item) => item.id)).toEqual(["vehicle-12", "vehicle-14", "vehicle-16", "vehicle-18", "vehicle-20"]);
  });

  it("clamps a page beyond the result set to the final page", () => {
    const result = paginateAndFilter(items.slice(0, 11), {}, { page: 99, pageSize: 5 });

    expect(result).toMatchObject({ page: 3, pageSize: 5, totalItems: 11, totalPages: 3 });
    expect(result.data.map((item) => item.id)).toEqual(["vehicle-11"]);
  });

  it("clamps non-positive pages to the first page", () => {
    const result = paginateAndFilter(items, {}, { page: 0, pageSize: 3 });

    expect(result.page).toBe(1);
    expect(result.data.map((item) => item.id)).toEqual(["vehicle-1", "vehicle-2", "vehicle-3"]);
  });

  it("clamps page size to the inclusive range from 1 to MAX_PAGE_SIZE", () => {
    const minimum = paginateAndFilter(items, {}, { page: 1, pageSize: 0 });
    const maximum = paginateAndFilter(items, {}, { page: 1, pageSize: MAX_PAGE_SIZE + 100 });

    expect(minimum.pageSize).toBe(1);
    expect(minimum.data).toHaveLength(1);
    expect(maximum.pageSize).toBe(MAX_PAGE_SIZE);
    expect(maximum.data).toHaveLength(MAX_PAGE_SIZE);
  });

  it("returns a stable first page for an empty result set", () => {
    const result = paginateAndFilter(items, { availability: ["discontinued"] }, { page: 4, pageSize: 10 });

    expect(result).toEqual({ data: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
  });

  it("preserves the generic item type and original item order", () => {
    const result = paginateAndFilter(items.slice(0, 5), {}, { page: 1, pageSize: 5 });

    expect(result.data).toEqual(items.slice(0, 5));
    expect(result.data[0]?.id).toBe("vehicle-1");
  });
});

describe("queryVehicles", () => {
  it("projects full catalog records to summaries before filtering and pagination", () => {
    const result = queryVehicles(VEHICLES, { powertrainType: ["hybrid"] }, { page: 1, pageSize: 10 });

    expect(result.data.map((summary) => summary.slug)).toEqual(["tacoma", "camry"]);
    expect(result.data[0]).toMatchObject({ model: "Tacoma", maxTowingLbs: 6_500, startingMsrp: 31_500 });
    expect(result.data[0]).not.toHaveProperty("grades");
  });
});
