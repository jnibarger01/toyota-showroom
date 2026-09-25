/**
 * Canonical cache policy for the Pages-demo service worker (`public/sw.js`, issue #49).
 *
 * The worker file itself is a plain classic script (no bundler pass), so it cannot import this
 * module. Keep `public/sw.js` in lockstep with the constants and `selectDemoCacheStrategy` below —
 * `tests/demoSwPolicy.test.ts` asserts the path prefixes and precache URLs appear in `sw.js`.
 *
 * Scope reminder: this is the GitHub Pages / local offline demo path only. It is not a substitute
 * for the production Cloudflare Worker + D1 stack.
 */

/** Prefix of every Cache Storage name this worker owns. Used to find orphans on activate. */
export const DEMO_SW_CACHE_PREFIX = "toyota-showroom-demo-";

/**
 * Active hero vehicle for the Pages builder default (`BuilderApp`'s `DEFAULT_VEHICLE_SLUG`).
 * Precache targets its GLB + supporting chrome so a second visit (or an offline revisit) does not
 * re-pay the ~1.2 MiB download.
 */
export const DEMO_SW_HERO_VEHICLE_SLUG = "4runner";

/**
 * Scope-relative URLs precached on `install`. Paths are resolved against the worker's registration
 * scope (`/toyota-showroom/` on Pages, `/` in local preview), never against the document URL.
 *
 * Intentionally excludes `/assets/*` content hashes: those change every build and are discovered
 * from the shell HTML at install time inside `public/sw.js` so the list cannot go stale silently.
 */
export const DEMO_SW_PRECACHE_URLS: readonly string[] = [
  // Critical static shell (builder entry + default hero route).
  "./",
  "./index.html",
  "./4runner/",
  "./4runner/index.html",
  // Hero vehicle models + still (stable names; optimisation scripts rewrite in place).
  "./models/modsnation_7416_assets_assembled.glb",
  "./models/4runner-2024/ModsNation_7416_wheel_a.glb",
  "./models/4runner-2024/ModsNation_7416_tire.glb",
  "./images/modsnation_7416_final_hero_tweaked.png",
  // Catalog snapshots the demo reads instead of `/api/*`.
  "./catalog/v1/vehicles.json",
  "./catalog/v1/vehicles/4runner.json",
  "./catalog/v1/vehicles/4runner/options.json",
  "./catalog/v1/vehicles/4runner/media.json",
  // Vendored Draco decoder trio (required to decode the hero GLB offline).
  "./draco/draco_decoder.js",
  "./draco/draco_decoder.wasm",
  "./draco/draco_wasm_wrapper.js",
];

/** Content-hashed build output — a cache hit cannot be wrong. */
export const DEMO_SW_IMMUTABLE_PATHS: readonly string[] = ["/assets/"];

/**
 * Large, stable, but rewritten in place under unchanged names (`public/_headers` marks them
 * `must-revalidate`). Serve the hit immediately; refresh behind it.
 */
export const DEMO_SW_REVALIDATE_PATHS: readonly string[] = [
  "/models/",
  "/draco/",
  "/renders/",
  "/hdri/",
  "/images/",
];

/** Static catalog mirror the demo uses instead of live configuration APIs. */
export const DEMO_SW_CATALOG_MARKER = "/catalog/v1/";

/** Live configuration / persistence APIs — never intercepted by the demo worker. */
export const DEMO_SW_API_MARKER = "/api/";

export type DemoCacheStrategy =
  | "cache-first"
  | "stale-while-revalidate"
  | "network-first"
  | "bypass";

/**
 * Picks the fetch strategy for a same-origin GET pathname.
 *
 * Configuration APIs are bypass (network-only / never cached). Catalog JSON is network-first so a
 * live deploy wins online while the demo still opens offline. Hashed `/assets/*` is cache-first.
 * Models and other must-revalidate media are stale-while-revalidate.
 */
export function selectDemoCacheStrategy(pathname: string): DemoCacheStrategy {
  if (pathname.includes(DEMO_SW_API_MARKER)) return "bypass";
  if (pathname.includes(DEMO_SW_CATALOG_MARKER)) return "network-first";
  if (DEMO_SW_IMMUTABLE_PATHS.some((prefix) => pathname.includes(prefix))) return "cache-first";
  if (DEMO_SW_REVALIDATE_PATHS.some((prefix) => pathname.includes(prefix))) {
    return "stale-while-revalidate";
  }
  return "bypass";
}

/**
 * Builds the Cache Storage name for a given version token.
 * `scripts/stamp-demo-sw.mjs` rewrites the version embedded in `public/sw.js` on every Pages
 * (and local) build so deploys are never sticky-cached forever.
 */
export function demoSwCacheName(version: string): string {
  return `${DEMO_SW_CACHE_PREFIX}${version}`;
}
