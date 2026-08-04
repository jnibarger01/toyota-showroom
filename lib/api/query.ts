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
}

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;

export interface PagedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
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
  const page = Math.min(Math.max(1, pagination.page), totalPages);
  const start = (page - 1) * pageSize;

  return {
    data: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    totalItems,
    totalPages,
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
