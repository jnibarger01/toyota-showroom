import { describe, expect, it } from "vitest";
import {
  EMPTY_EXPLORE_QUERY,
  EXPLORE_BODY_STYLES,
  EXPLORE_POWERTRAIN_TYPES,
  buildExploreQuery,
  parseExploreQuery,
  type ExploreQueryState,
} from "../lib/showroom/exploreQuery";
import { parseVehicleQuery } from "../lib/validation/vehicle-query";

function state(overrides: Partial<ExploreQueryState> = {}): ExploreQueryState {
  return { ...EMPTY_EXPLORE_QUERY, ...overrides };
}

describe("buildExploreQuery", () => {
  it("keeps the unfiltered first page on a clean URL", () => {
    expect(buildExploreQuery(EMPTY_EXPLORE_QUERY)).toBe("");
  });

  it("serializes every facet the page can set", () => {
    const query = buildExploreQuery(
      state({ bodyStyle: "truck", powertrainTypes: ["gas", "hybrid"], minPrice: 40000, maxPrice: 60000, minSeating: 6, page: 2 }),
    );

    expect(query).toBe("?bodyStyle=truck&powertrainType=gas%2Chybrid&minPrice=40000&maxPrice=60000&minSeating=6&page=2");
  });

  it("omits a default page and keeps a real one", () => {
    expect(buildExploreQuery(state({ page: 1 }))).toBe("");
    expect(buildExploreQuery(state({ page: 4 }))).toBe("?page=4");
  });

  it("drops facet values it cannot serialize instead of writing them into a link", () => {
    expect(buildExploreQuery(state({ minPrice: Number.NaN, maxPrice: -5, minSeating: -1 }))).toBe("");
    // 0 is a legitimate bound (`minSeating=0` matches everything) — only negatives and non-finite
    // values are unserializable.
    expect(buildExploreQuery(state({ minSeating: 0 }))).toBe("?minSeating=0");
  });

  it("is deterministic: the same lineup always builds the identical string", () => {
    const a = buildExploreQuery(state({ powertrainTypes: ["hybrid", "gas"], bodyStyle: "suv" }));
    const b = buildExploreQuery(state({ powertrainTypes: ["gas", "hybrid"], bodyStyle: "suv" }));

    expect(a).toBe("?bodyStyle=suv&powertrainType=gas%2Chybrid");
    expect(b).toBe(a);
  });
});

describe("parseExploreQuery", () => {
  it("round-trips everything it serialized", () => {
    const original = state({
      bodyStyle: "crossover",
      powertrainTypes: ["hybrid", "bev"],
      minPrice: 35000,
      maxPrice: 55000,
      minSeating: 5,
      page: 3,
    });

    expect(parseExploreQuery(buildExploreQuery(original))).toEqual({
      ...original,
      powertrainTypes: ["hybrid", "bev"],
    });
  });

  it("returns the unfiltered defaults for an empty search", () => {
    expect(parseExploreQuery("")).toEqual(EMPTY_EXPLORE_QUERY);
  });

  it("ignores parameters it doesn't own, unknown enum values, and malformed numbers", () => {
    // Every one of these is something a hand-edited, truncated, or third-party-appended link can
    // carry; none may reach the render.
    const parsed = parseExploreQuery(
      "?bodyStyle=flying&powertrainType=hybrid,steam&minPrice=abc&maxPrice=-5&minSeating=&page=0&pageSize=99&utm_source=chat",
    );

    expect(parsed).toEqual({ ...EMPTY_EXPLORE_QUERY, powertrainTypes: ["hybrid"] });
  });

  it("normalizes duplicate, padded and out-of-order powertrain values", () => {
    expect(parseExploreQuery("?powertrainType=%20hybrid%20,hybrid,gas").powertrainTypes).toEqual(["gas", "hybrid"]);
  });

  it("falls back to page 1 for non-integer pages", () => {
    expect(parseExploreQuery("?page=2").page).toBe(2);
    expect(parseExploreQuery("?page=2.5").page).toBe(1);
    expect(parseExploreQuery("?page=-2").page).toBe(1);
  });
});

describe("explore query vocabulary vs the vehicles API", () => {
  // The point of sharing these names with `GET /api/v1/vehicles` is that a shared lineup link means
  // the same thing on both sides. If a body style or powertrain is added to the schema and this
  // module isn't updated, the page would silently be unable to serialize (or restore) it — the API
  // parser accepting every value below is what makes that failure mode impossible.
  it("only serializes body styles the API accepts", () => {
    for (const bodyStyle of EXPLORE_BODY_STYLES) {
      expect(() => parseVehicleQuery(new URLSearchParams({ bodyStyle }))).not.toThrow();
    }
    expect(() => parseVehicleQuery(new URLSearchParams({ bodyStyle: "flying" }))).toThrow();
  });

  it("only serializes powertrains the API accepts", () => {
    for (const powertrainType of EXPLORE_POWERTRAIN_TYPES) {
      expect(() => parseVehicleQuery(new URLSearchParams({ powertrainType }))).not.toThrow();
    }
    expect(() => parseVehicleQuery(new URLSearchParams({ powertrainType: "steam" }))).toThrow();
  });

  it("builds a query the API parser resolves to the same filters", () => {
    const query = buildExploreQuery(
      state({ bodyStyle: "truck", powertrainTypes: ["hybrid", "gas"], minPrice: 40000, maxPrice: 60000, minSeating: 6, page: 2 }),
    );

    const { filters, pagination } = parseVehicleQuery(new URLSearchParams(query));

    expect(filters).toMatchObject({
      bodyStyle: ["truck"],
      powertrainType: ["gas", "hybrid"],
      minPrice: 40000,
      maxPrice: 60000,
      minSeating: 6,
    });
    expect(pagination.page).toBe(2);
  });
});
