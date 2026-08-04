import type { MediaAsset, MediaManifest, Vehicle, Vehicle3DConfig, VehicleSummary } from "../types/vehicle";
import { ApiError, type ApiErrorBody } from "./errors";
import { paginateAndFilter, type Pagination, type PagedResult, type VehicleFilters } from "./query";

/**
 * Typed client SDK for the versioned vehicle API. This project builds as a static export
 * (next.config.mjs `output: "export"`) for GitHub Pages, so it fetches the pre-generated
 * `/catalog/v1/*.json` fixtures (scripts/generate-static-api.ts) rather than the app/api Route
 * Handlers, which require a query-aware runtime.
 * `listVehicles` and `compareVehicles` fetch the full static payload once (cached in-memory)
 * and apply the same `matchesFilters`/pagination logic the generator uses, so arbitrary
 * filter combinations work at runtime without a live backend.
 */

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function catalogUrl(path: string): string {
  return `${basePath}/catalog/v1${path}.json`;
}

/**
 * Catalog data stores root-relative asset URLs (e.g. "/images/hero.png"); under the GitHub
 * Pages deployment the whole site is mounted at a sub-path (`vite.config.ts` `base`), so every
 * asset URL a consumer receives from this SDK needs the same prefix the 3D model loader uses.
 * Centralized here so components never have to remember to do it themselves.
 */
function withBasePath(url: string): string {
  return url.startsWith("/") ? `${basePath}${url}` : url;
}

function normalizeAsset(asset: MediaAsset): MediaAsset {
  return { ...asset, url: withBasePath(asset.url) };
}

function normalizeMedia(media: MediaManifest): MediaManifest {
  return {
    hero: normalizeAsset(media.hero),
    gallery: media.gallery.map(normalizeAsset),
    thumbnails: media.thumbnails.map(normalizeAsset),
    videos: media.videos.map(normalizeAsset),
    environmentMaps: media.environmentMaps.map(normalizeAsset),
  };
}

function normalizeThreeDConfig(config: Vehicle3DConfig): Vehicle3DConfig {
  return config.modelUrl ? { ...config, modelUrl: withBasePath(config.modelUrl) } : config;
}

function normalizeVehicle(vehicle: Vehicle): Vehicle {
  return { ...vehicle, media: normalizeMedia(vehicle.media), threeDConfig: normalizeThreeDConfig(vehicle.threeDConfig) };
}

function normalizeSummary(summary: VehicleSummary): VehicleSummary {
  return { ...summary, thumbnail: normalizeAsset(summary.thumbnail) };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    // Defensive: an error response need not carry the `{ error: {...} }` envelope (a static host's
    // own 404 page will not), and the error path must not itself throw.
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(response.status, body?.error?.code ?? "request_failed", body?.error?.message ?? `Request to ${url} failed`);
  }
  return response.json() as Promise<T>;
}

let vehicleSummaryCache: Promise<VehicleSummary[]> | null = null;

async function loadAllVehicleSummaries(): Promise<VehicleSummary[]> {
  if (!vehicleSummaryCache) {
    vehicleSummaryCache = fetchJson<{ data: VehicleSummary[] }>(catalogUrl("/vehicles")).then((r) => r.data.map(normalizeSummary));
  }
  return vehicleSummaryCache;
}

export async function listVehicles(
  filters: VehicleFilters = {},
  pagination: Pagination = { page: 1, pageSize: 12 },
): Promise<PagedResult<VehicleSummary>> {
  const all = await loadAllVehicleSummaries();
  return paginateAndFilter(all, filters, pagination);
}

export async function getVehicle(slug: string): Promise<Vehicle> {
  const { data } = await fetchJson<{ data: Vehicle }>(catalogUrl(`/vehicles/${slug}`));
  return normalizeVehicle(data);
}

export async function getVehicleMedia(slug: string): Promise<{ media: MediaManifest; threeDConfig: Vehicle3DConfig }> {
  const result = await fetchJson<{ media: MediaManifest; threeDConfig: Vehicle3DConfig }>(catalogUrl(`/vehicles/${slug}/media`));
  return { media: normalizeMedia(result.media), threeDConfig: normalizeThreeDConfig(result.threeDConfig) };
}

const MIN_COMPARE = 2;
const MAX_COMPARE = 4;

/** Groundwork for goal 10 (normalized side-by-side comparison) over the static catalog. */
export async function compareVehicles(slugs: string[]): Promise<Vehicle[]> {
  if (slugs.length < MIN_COMPARE || slugs.length > MAX_COMPARE) {
    throw new ApiError(400, "invalid_query", `compareVehicles accepts ${MIN_COMPARE}-${MAX_COMPARE} slugs, got ${slugs.length}`);
  }
  return Promise.all(slugs.map((slug) => getVehicle(slug)));
}

export async function checkHealth(): Promise<{ status: string; schemaVersion: string; vehicleCount: number; timestamp: string }> {
  return fetchJson(catalogUrl("/health"));
}
