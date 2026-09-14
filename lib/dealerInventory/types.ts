/**
 * Dealer inventory match (#20).
 *
 * Inventory units are keyed by stable customization option ids (never display labels). Feed
 * adapters are pluggable so a CSV fixture, a dealer DMS API, or a third-party aggregator can
 * supply the same `DealerInventoryUnit` shape without changing the matcher or Explore badges.
 */

/** How a unit can satisfy a shopper looking at Explore / a saved build. */
export type DealerInventoryAvailability = "in_stock" | "buildable";

/**
 * One vehicle configuration a dealer can sell or order. `optionIds` are catalog option ids from
 * `lib/data/options` — the same ids persisted on `VehicleConfiguration.selections`.
 */
export interface DealerInventoryUnit {
  id: string;
  vehicleId: string;
  /** Stable customization option ids only. Order is insignificant; duplicates are ignored. */
  optionIds: readonly string[];
  dealerId: string;
  dealerName?: string;
  /** Straight-line (or drive) distance from the shopper when known. Used for "Near me". */
  distanceMiles?: number;
  availability: DealerInventoryAvailability;
}

/** Pluggable source of dealer inventory rows. */
export interface DealerInventoryFeedAdapter {
  /** Stable adapter id for telemetry / swap-out (e.g. "csv-fixture", "dealer-api"). */
  readonly id: string;
  load(): Promise<readonly DealerInventoryUnit[]>;
}

/** Badges surfaced on Explore vehicle cards. */
export type InventoryBadge = "near_me" | "buildable";

export const DEFAULT_NEAR_ME_MAX_MILES = 50;

export interface MatchBuildOptions {
  /** Units at or under this distance count as "Near me". Defaults to {@link DEFAULT_NEAR_ME_MAX_MILES}. */
  nearMeMaxMiles?: number;
}

export interface BuildInventoryMatch {
  /** Units whose option-id set covers the build (vehicle + every build option id present). */
  matches: DealerInventoryUnit[];
  /** Subset of `matches` that are in stock within the near-me radius. */
  nearMe: DealerInventoryUnit[];
  /** Subset of `matches` marked buildable (orderable), regardless of distance. */
  buildable: DealerInventoryUnit[];
}
