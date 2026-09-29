/**
 * URL <-> explore-lineup state for `app/explore/page.tsx`.
 *
 * The parameter names and value vocabularies are exactly the ones `GET /api/v1/vehicles` already
 * accepts (`lib/validation/vehicle-query.ts`), so a shared lineup link means the same thing to the
 * API and to the client-side `matchesFilters` pass that actually renders it — the same "a chip
 * here and a `?bodyStyle=` parameter can never disagree" contract `docs/INTEGRATION_GUIDE.md` §11
 * already documents for the unfiltered fetch.
 *
 * Both directions are total, because the input is a URL a human (or a chat client that truncated
 * it) can edit freely:
 *
 * - `parseExploreQuery` never throws. An unknown parameter, an enum value outside the vocabulary,
 *   a non-numeric or negative price, and a page below 1 (or non-integer) are all dropped in favour
 *   of the unfiltered default rather than propagated into the render.
 * - `buildExploreQuery` omits every default, so the plain lineup keeps a clean `/explore/` URL
 *   instead of one carrying `?page=1` and empty facets, and it drops facet values it cannot
 *   serialize (non-finite or negative) instead of writing them into a link.
 */

import type { BodyStyle, PowertrainType } from "../types/vehicle";

/**
 * Mirrors the `BODY_STYLES` / `POWERTRAIN_TYPES` allow-lists `lib/validation/vehicle-query.ts`
 * validates against; `tests/exploreQuery.test.ts` asserts every value here is accepted by that
 * parser, so a new body style added to the schema can't silently become unserializable here.
 */
export const EXPLORE_BODY_STYLES: readonly BodyStyle[] = [
  "suv",
  "truck",
  "sedan",
  "minivan",
  "crossover",
  "coupe",
  "hatchback",
];

export const EXPLORE_POWERTRAIN_TYPES: readonly PowertrainType[] = ["gas", "hybrid", "phev", "bev"];

export interface ExploreQueryState {
  bodyStyle: BodyStyle | null;
  powertrainTypes: PowertrainType[];
  minPrice: number | null;
  maxPrice: number | null;
  minSeating: number | null;
  /** 1-based; the unfiltered lineup's first page is the default and is never serialized. */
  page: number;
}

export const EMPTY_EXPLORE_QUERY: ExploreQueryState = {
  bodyStyle: null,
  powertrainTypes: [],
  minPrice: null,
  maxPrice: null,
  minSeating: null,
  page: 1,
};

function parseFacetNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parsePage(raw: string | null): number {
  if (raw === null) return 1;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/** Tolerant reader: anything it doesn't recognize resolves to that facet's unfiltered default. */
export function parseExploreQuery(search: string): ExploreQueryState {
  const params = new URLSearchParams(search);

  const bodyStyleRaw = params.get("bodyStyle");
  const bodyStyle = EXPLORE_BODY_STYLES.includes(bodyStyleRaw as BodyStyle)
    ? (bodyStyleRaw as BodyStyle)
    : null;

  // Filtering the canonical list (rather than mapping the URL's own order) is what makes the
  // result deterministic: `?powertrainType=hybrid,hybrid,gas` parses to `["gas", "hybrid"]`, so two
  // links meaning the same thing build back to the identical string.
  const requestedPowertrains = (params.get("powertrainType") ?? "")
    .split(",")
    .map((value) => value.trim());
  const powertrainTypes = EXPLORE_POWERTRAIN_TYPES.filter((type) => requestedPowertrains.includes(type));

  return {
    bodyStyle,
    powertrainTypes,
    minPrice: parseFacetNumber(params.get("minPrice")),
    maxPrice: parseFacetNumber(params.get("maxPrice")),
    minSeating: parseFacetNumber(params.get("minSeating")),
    page: parsePage(params.get("page")),
  };
}

function setFacetNumber(params: URLSearchParams, key: string, value: number | null): void {
  if (value === null || !Number.isFinite(value) || value < 0) return;
  params.set(key, String(value));
}

/** `""` for the unfiltered first page, otherwise a leading-`?` query string in a fixed order. */
export function buildExploreQuery(state: ExploreQueryState): string {
  const params = new URLSearchParams();

  if (state.bodyStyle !== null && EXPLORE_BODY_STYLES.includes(state.bodyStyle)) {
    params.set("bodyStyle", state.bodyStyle);
  }
  const powertrainTypes = EXPLORE_POWERTRAIN_TYPES.filter((type) => state.powertrainTypes.includes(type));
  if (powertrainTypes.length > 0) params.set("powertrainType", powertrainTypes.join(","));
  setFacetNumber(params, "minPrice", state.minPrice);
  setFacetNumber(params, "maxPrice", state.maxPrice);
  setFacetNumber(params, "minSeating", state.minSeating);
  if (Number.isInteger(state.page) && state.page > 1) params.set("page", String(state.page));

  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
