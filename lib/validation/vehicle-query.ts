import { invalidQuery } from "../api/errors";
import { decodeVehicleCursor, DEFAULT_PAGE_SIZE, type Pagination, type VehicleFilters } from "../api/query";
import type { AvailabilityStatus, BodyStyle, DrivetrainType, PowertrainType } from "../types/vehicle";

const BODY_STYLES: BodyStyle[] = ["suv", "truck", "sedan", "minivan", "crossover", "coupe", "hatchback"];
const DRIVETRAINS: DrivetrainType[] = ["fwd", "rwd", "awd", "4wd"];
const POWERTRAIN_TYPES: PowertrainType[] = ["gas", "hybrid", "phev", "bev"];
const AVAILABILITY: AvailabilityStatus[] = ["in_production", "coming_soon", "discontinued"];

function splitParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseEnumList<T extends string>(value: string | null, allowed: readonly T[], paramName: string): T[] | undefined {
  const raw = splitParam(value);
  if (!raw) return undefined;
  for (const item of raw) {
    if (!allowed.includes(item as T)) {
      throw invalidQuery(`Invalid value "${item}" for "${paramName}". Allowed: ${allowed.join(", ")}`);
    }
  }
  return raw as T[];
}

function parseNumber(value: string | null, paramName: string): number | undefined {
  if (value === null || value === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) throw invalidQuery(`"${paramName}" must be a number, got "${value}"`);
  return num;
}

const ALLOWED_QUERY_PARAMS = new Set(["bodyStyle", "category", "drivetrain", "powertrainType", "availability", "minPrice", "maxPrice", "minSeating", "minTowingLbs", "page", "pageSize", "cursor"]);

/** Parses and validates `/api/v1/vehicles` query parameters into filters + pagination. Throws ApiError on bad input. */
export function parseVehicleQuery(searchParams: URLSearchParams): { filters: VehicleFilters; pagination: Pagination } {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) throw invalidQuery(`Unknown query parameter "${key}".`);
  }

  const filters: VehicleFilters = {
    bodyStyle: parseEnumList(searchParams.get("bodyStyle"), BODY_STYLES, "bodyStyle"),
    category: splitParam(searchParams.get("category")),
    drivetrain: parseEnumList(searchParams.get("drivetrain"), DRIVETRAINS, "drivetrain"),
    powertrainType: parseEnumList(searchParams.get("powertrainType"), POWERTRAIN_TYPES, "powertrainType"),
    availability: parseEnumList(searchParams.get("availability"), AVAILABILITY, "availability"),
    minPrice: parseNumber(searchParams.get("minPrice"), "minPrice"),
    maxPrice: parseNumber(searchParams.get("maxPrice"), "maxPrice"),
    minSeating: parseNumber(searchParams.get("minSeating"), "minSeating"),
    minTowingLbs: parseNumber(searchParams.get("minTowingLbs"), "minTowingLbs"),
  };

  const cursor = searchParams.get("cursor");
  if (cursor !== null && searchParams.has("page")) throw invalidQuery(`"cursor" and "page" are mutually exclusive.`);
  const cursorOffset = cursor === null ? undefined : decodeVehicleCursor(cursor);
  if (cursor !== null && cursorOffset === null) throw invalidQuery(`"cursor" is malformed or unsupported.`);

  const page = parseNumber(searchParams.get("page"), "page") ?? 1;
  const pageSize = parseNumber(searchParams.get("pageSize"), "pageSize") ?? DEFAULT_PAGE_SIZE;
  if (page < 1 || !Number.isInteger(page)) throw invalidQuery(`"page" must be a positive integer, got "${page}"`);
  if (pageSize < 1 || !Number.isInteger(pageSize)) throw invalidQuery(`"pageSize" must be a positive integer, got "${pageSize}"`);

  return { filters, pagination: { page, pageSize, ...(typeof cursorOffset === "number" ? { cursorOffset } : {}) } };
}
