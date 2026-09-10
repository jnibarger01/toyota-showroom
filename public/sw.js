/*
 * Service worker for the GitHub Pages demo build only (#49).
 *
 * ## Scope, and why it is narrow
 *
 * Pages is the demo/offline surface: there is no Worker, no D1, and the app persists to
 * localStorage. Repeat visits still re-fetched the ~1.2 MiB GLB and the whole static shell, which
 * is the entire reason this exists.
 *
 * It is registered *only* after `getPersistenceMode()` reports "local" — that is, after the app has
 * proven at runtime that the API routes are absent. That gate matters: a service worker installed
 * against the production Worker deployment could serve stale configuration responses from cache and
 * would be far harder to diagnose than the download cost it saved. Registration is guarded rather
 * than assumed, and `lib/pwa/demoServiceWorker.ts` actively unregisters if the mode is ever
 * "worker".
 *
 * ## Strategies
 *
 *   - `/assets/*`  — content-hashed and served `immutable`. Cache-first, never revalidated: the
 *                    filename changes when the content does, so a hit is always correct.
 *   - `/models/*`, `/draco/*`, `/renders/*`, `/images/*`
 *                  — large and stable, but `public/_headers` serves them `must-revalidate` rather
 *                    than `immutable`, because the optimisation scripts rewrite these files in
 *                    place under unchanged names. Stale-while-revalidate: serve the cached copy
 *                    immediately, then refresh it in the background so an in-place rewrite is
 *                    picked up on the next visit rather than never.
 *   - `/catalog/v1/*.json`
 *                  — the static catalog mirror. Network-first with a cache fallback, so a live
 *                    deploy wins when online and the demo still works offline.
 *   - everything else, including `/api/*` — not touched at all.
 *
 * ## The kill switch
 *
 * `CACHE_VERSION` is the version bump: `activate` deletes every cache that is not the current one,
 * so shipping a new value evicts everything previously stored. A sticky cache on a demo surface is
 * worse than no cache, so this worker also calls `skipWaiting`/`clients.claim` — an update takes
 * effect on the next navigation rather than waiting for every tab to close.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `toyota-showroom-demo-${CACHE_VERSION}`;

/** Served `immutable`; a hit can never be wrong because the hash is in the name. */
const IMMUTABLE_PATHS = ["/assets/"];

/** Large, stable, but rewritten in place by the asset scripts — refresh behind the hit. */
const REVALIDATE_PATHS = ["/models/", "/draco/", "/renders/", "/images/"];

/** The static catalog mirror the demo reads instead of the API. */
const CATALOG_MARKER = "/catalog/v1/";

function matchesAny(pathname, prefixes) {
  return prefixes.some((prefix) => pathname.includes(prefix));
}

self.addEventListener("install", (event) => {
  // No precache list. The asset filenames are build-hashed and this file is static, so any list
  // written here would be a guess that goes stale silently. Caching on first use costs one
  // uncached visit and cannot drift from what the build actually emitted.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("toyota-showroom-demo-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Cache-first. Used where a cached response cannot be wrong. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Serve the cached copy now, refresh it behind the response.
 *
 * Takes the event so the background refresh can be registered with `waitUntil` — the worker may
 * otherwise be terminated the moment the response is returned, killing the refresh it exists for.
 */
async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Not awaited: the point is that the viewer does not wait for the refresh.
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  if (response) return response;
  throw new Error("offline and uncached");
}

/** Live deploy wins when online; the demo still opens offline. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Same-origin only. A cross-origin font or CDN response is not this worker's to manage.
  if (url.origin !== self.location.origin) return;
  // Never intercept the API. On Pages these routes do not exist; anywhere else they are dynamic and
  // caching them is exactly the failure mode this worker is gated to avoid.
  if (url.pathname.includes("/api/")) return;

  if (url.pathname.includes(CATALOG_MARKER)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (matchesAny(url.pathname, IMMUTABLE_PATHS)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (matchesAny(url.pathname, REVALIDATE_PATHS)) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }
  // Navigations and everything else fall through to the network untouched.
});
