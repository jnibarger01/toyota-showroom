import type {
  AvailabilityStatus,
  BodyStyle,
  DrivetrainType,
  PowertrainType,
  Vehicle,
  VehicleQueryFacts,
  VehicleSummary,
} from "../types/vehicle";
import { toVehicleSummary } from "../types/vehicle";

export interface VehicleFilters {
  bodyStyle?: BodyStyle[];
  category?: string[];
  drivetrain?: DrivetrainType[];
  powertrainType?: PowertrainType[];
  availability?: AvailabilityStatus[];
  minPrice?: number;
  maxPrice?: number;
  minSeating?: number;
  minTowingLbs?: number;
}

export interface Pagination {
  page: number;
  pageSize: number;
  /** Zero-based offset decoded from an opaque API cursor. Omitted for page-number requests. */
  cursorOffset?: number;
}

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;

export interface PagedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** Opaque continuation token. Absent when this is the final page. */
  nextCursor?: string;
}

const CURSOR_PREFIX = "v1_";

export function encodeVehicleCursor(offset: number): string {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Cursor offset must be a non-negative safe integer.");
  return `${CURSOR_PREFIX}${offset.toString(36)}`;
}

export function decodeVehicleCursor(cursor: string): number | null {
  if (!/^v1_[0-9a-z]+$/.test(cursor)) return null;
  const offset = Number.parseInt(cursor.slice(CURSOR_PREFIX.length), 36);
  if (!Number.isSafeInteger(offset) || offset < 0 || encodeVehicleCursor(offset) !== cursor) return null;
  return offset;
}

export function matchesFilters(facts: VehicleQueryFacts, filters: VehicleFilters): boolean {
  if (filters.bodyStyle?.length && !filters.bodyStyle.includes(facts.bodyStyle)) return false;
  if (filters.category?.length && !filters.category.some((c) => facts.categories.includes(c))) return false;
  if (filters.availability?.length && !filters.availability.includes(facts.availability)) return false;
  if (filters.drivetrain?.length && !filters.drivetrain.some((d) => facts.drivetrains.includes(d))) return false;
  if (filters.powertrainType?.length && !filters.powertrainType.some((t) => facts.powertrainTypes.includes(t))) return false;
  if (filters.minPrice !== undefined && facts.startingMsrp < filters.minPrice) return false;
  if (filters.maxPrice !== undefined && facts.startingMsrp > filters.maxPrice) return false;
  if (filters.minSeating !== undefined && facts.maxSeating < filters.minSeating) return false;
  if (filters.minTowingLbs !== undefined && facts.maxTowingLbs < filters.minTowingLbs) return false;
  return true;
}

/**
 * Pure, shared filter/paginate logic. Works over anything satisfying `VehicleQueryFacts`, so
 * the exact same function filters full `Vehicle` records at build time (via `queryVehicles`
 * below) and cached `VehicleSummary` records client-side (`lib/api/client.ts`).
 */
export function paginateAndFilter<T extends VehicleQueryFacts>(
  items: readonly T[],
  filters: VehicleFilters = {},
  pagination: Pagination = { page: 1, pageSize: DEFAULT_PAGE_SIZE },
): PagedResult<T> {
  const filtered = items.filter((item) => matchesFilters(item, filters));
  const totalItems = filtered.length;
  const pageSize = Math.min(Math.max(1, pagination.pageSize), MAX_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const pageRequest = Math.min(Math.max(1, pagination.page), totalPages);
  const start = pagination.cursorOffset === undefined
    ? (pageRequest - 1) * pageSize
    : Math.min(pagination.cursorOffset, totalItems);
  const page = totalItems === 0 ? 1 : Math.min(totalPages, Math.floor(start / pageSize) + 1);
  const data = filtered.slice(start, start + pageSize);
  const nextOffset = start + data.length;

  return {
    data,
    page,
    pageSize,
    totalItems,
    totalPages,
    ...(nextOffset < totalItems ? { nextCursor: encodeVehicleCursor(nextOffset) } : {}),
  };
}

/** Server-side entry point: projects full vehicles to summaries, then filters/paginates. */
export function queryVehicles(
  vehicles: readonly Vehicle[],
  filters: VehicleFilters = {},
  pagination: Pagination = { page: 1, pageSize: DEFAULT_PAGE_SIZE },
): PagedResult<VehicleSummary> {
  return paginateAndFilter(vehicles.map(toVehicleSummary), filters, pagination);
}
