import {
  DEFAULT_NEAR_ME_MAX_MILES,
  type BuildInventoryMatch,
  type DealerInventoryUnit,
  type InventoryBadge,
  type MatchBuildOptions,
} from "./types";

/**
 * True when `unit` can fulfill the given build: same vehicle, and every build option id appears
 * in the unit's option ids. Matching is by stable option id only — never by display label.
 *
 * An empty build (no options selected yet) matches any unit for that vehicle; Explore uses the
 * lighter {@link exploreBadgesForVehicle} path instead of inventing a base build.
 */
export function unitMatchesBuild(
  unit: DealerInventoryUnit,
  vehicleId: string,
  buildOptionIds: readonly string[],
): boolean {
  if (unit.vehicleId !== vehicleId) return false;
  if (buildOptionIds.length === 0) return true;
  const available = new Set(unit.optionIds);
  return buildOptionIds.every((id) => available.has(id));
}

function isNearMe(unit: DealerInventoryUnit, maxMiles: number): boolean {
  return (
    unit.availability === "in_stock" &&
    typeof unit.distanceMiles === "number" &&
    unit.distanceMiles <= maxMiles
  );
}

/** Match a build's option ids against a loaded inventory feed. */
export function matchBuildToInventory(
  vehicleId: string,
  buildOptionIds: readonly string[],
  units: readonly DealerInventoryUnit[],
  options: MatchBuildOptions = {},
): BuildInventoryMatch {
  const nearMeMaxMiles = options.nearMeMaxMiles ?? DEFAULT_NEAR_ME_MAX_MILES;
  const matches = units.filter((unit) => unitMatchesBuild(unit, vehicleId, buildOptionIds));
  return {
    matches,
    nearMe: matches.filter((unit) => isNearMe(unit, nearMeMaxMiles)),
    buildable: matches.filter((unit) => unit.availability === "buildable"),
  };
}

/**
 * Explore badges for one vehicle, without requiring a specific build.
 *
 * - `near_me` — any in-stock unit for the vehicle within the near-me radius
 * - `buildable` — any buildable (orderable) unit for the vehicle
 *
 * Option ids on each unit are still required to be present (the CSV adapter rejects rows without
 * them); badges themselves are vehicle-scoped so the lineup can load before any build exists.
 */
export function exploreBadgesForVehicle(
  vehicleId: string,
  units: readonly DealerInventoryUnit[],
  options: MatchBuildOptions = {},
): InventoryBadge[] {
  const nearMeMaxMiles = options.nearMeMaxMiles ?? DEFAULT_NEAR_ME_MAX_MILES;
  const forVehicle = units.filter((unit) => unit.vehicleId === vehicleId);
  const badges: InventoryBadge[] = [];
  if (forVehicle.some((unit) => isNearMe(unit, nearMeMaxMiles))) {
    badges.push("near_me");
  }
  if (forVehicle.some((unit) => unit.availability === "buildable")) {
    badges.push("buildable");
  }
  return badges;
}

/** Map of vehicleId → badges for the full Explore lineup. */
export function exploreBadgesByVehicle(
  units: readonly DealerInventoryUnit[],
  vehicleIds: readonly string[],
  options: MatchBuildOptions = {},
): Map<string, InventoryBadge[]> {
  const result = new Map<string, InventoryBadge[]>();
  for (const vehicleId of vehicleIds) {
    const badges = exploreBadgesForVehicle(vehicleId, units, options);
    if (badges.length > 0) result.set(vehicleId, badges);
  }
  return result;
}
