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
 * Keep path prefixes / precache URLs in lockstep with `lib/pwa/demoSwPolicy.ts` (asserted by
 * `tests/demoSwPolicy.test.ts`). This file is a classic script with no bundler pass, so it cannot
 * import that module.
 *
 * ## Strategies
 *
 *   - `/assets/*`  — content-hashed and served `immutable`. Cache-first, never revalidated: the
 *                    filename changes when the content does, so a hit is always correct.
 *   - `/models/*`, `/draco/*`, `/renders/*`, `/hdri/*`, `/images/*`
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
 * ## Precache
 *
 * On install we warm the critical static shell, the active hero vehicle's models, its catalog
 * snapshots, and the Draco decoder. Hashed `/assets/*` filenames are discovered from `index.html`
 * at install time so the list cannot drift from what the build emitted.
 *
 * ## The kill switch
 *
 * `CACHE_VERSION` is the version bump: `activate` deletes every cache that is not the current one,
 * so shipping a new value evicts everything previously stored. `scripts/stamp-demo-sw.mjs` rewrites
 * this token to the build's git SHA on every Pages (and local) build — see DEPLOYMENT_RUNBOOK —
 * so deploys are never sticky-cached forever. A sticky cache on a demo surface is worse than no
 * cache, so this worker also calls `skipWaiting`/`clients.claim` — an update takes effect on the
 * next navigation rather than waiting for every tab to close.
 */

/** Stamped to `v-<git-sha>` by `scripts/stamp-demo-sw.mjs` on build. Do not hand-edit in CI. */
const CACHE_VERSION = "dev";
const CACHE_NAME = `toyota-showroom-demo-${CACHE_VERSION}`;

/** Served `immutable`; a hit can never be wrong because the hash is in the name. */
const IMMUTABLE_PATHS = ["/assets/"];

/** Large, stable, but rewritten in place by the asset scripts — refresh behind the hit. */
const REVALIDATE_PATHS = ["/models/", "/draco/", "/renders/", "/hdri/", "/images/"];

/** The static catalog mirror the demo reads instead of the API. */
const CATALOG_MARKER = "/catalog/v1/";

/**
 * Scope-relative precache list (keep in sync with `DEMO_SW_PRECACHE_URLS` in
 * `lib/pwa/demoSwPolicy.ts`). Resolved against `self.registration.scope`.
 */
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./4runner/",
  "./4runner/index.html",
  "./models/modsnation_7416_assets_assembled.glb",
  "./models/4runner-2024/ModsNation_7416_wheel_a.glb",
  "./models/4runner-2024/ModsNation_7416_tire.glb",
  "./images/modsnation_7416_final_hero_tweaked.png",
  "./catalog/v1/vehicles.json",
  "./catalog/v1/vehicles/4runner.json",
  "./catalog/v1/vehicles/4runner/options.json",
  "./catalog/v1/vehicles/4runner/media.json",
  "./draco/draco_decoder.js",
  "./draco/draco_decoder.wasm",
  "./draco/draco_wasm_wrapper.js",
];

function matchesAny(pathname, prefixes) {
  return prefixes.some((prefix) => pathname.includes(prefix));
}

/** Put one URL into the cache; never throws — a missing optional asset must not fail install. */
async function putIfOk(cache, url) {
  try {
    const response = await fetch(url, { cache: "reload" });
    if (response.ok) await cache.put(url, response);
  } catch {
    // Precache is best-effort. Offline install or a renamed asset should not brick the worker.
  }
}

/**
 * Warm shell + hero assets, then scrape hashed `/assets/*` URLs out of the builder HTML so the
 * content-hashed JS/CSS for this deploy is cached without a hand-maintained list.
 */
async function precacheCritical(cache) {
  const scope = self.registration.scope;
  await Promise.all(PRECACHE_URLS.map((rel) => putIfOk(cache, new URL(rel, scope))));

  try {
    const indexUrl = new URL("./index.html", scope);
    const indexResponse = await fetch(indexUrl, { cache: "reload" });
    if (!indexResponse.ok) return;
    const html = await indexResponse.text();
    const assetRefs = html.matchAll(/(?:href|src)="([^"]*\/assets\/[^"]+)"/g);
    const seen = new Set();
    const discoveries = [];
    for (const match of assetRefs) {
      const raw = match[1];
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      const assetUrl = new URL(raw, scope);
      if (assetUrl.origin !== self.location.origin) continue;
      if (!assetUrl.pathname.includes("/assets/")) continue;
      discoveries.push(putIfOk(cache, assetUrl));
    }
    await Promise.all(discoveries);
  } catch {
    // Shell discovery is additive; the explicit PRECACHE_URLS list is enough for a useful demo.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await precacheCritical(cache);
      await self.skipWaiting();
    })(),
  );
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

/**
 * Writes to the cache without letting a cache failure affect the response.
 *
 * `cache.put` rejects when the origin quota is full or storage is unavailable. Awaiting it in a
 * handler's success path meant such a rejection rejected the whole `respondWith`, turning a
 * perfectly good network response into a failed request — so an installed optimisation could break
 * hashed JS chunks, catalog JSON and vehicle assets for *online* users. A cache write is
 * best-effort by definition: the response is already in hand.
 */
async function putSafely(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch {
    // Quota, storage disabled, or an opaque response. Nothing to recover — the caller has its
    // response and the next visit simply tries again.
  }
}

/** Cache-first. Used where a cached response cannot be wrong. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await putSafely(request, response.clone());
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
      if (response.ok) await putSafely(request, response.clone());
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
    if (response.ok) await putSafely(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

/**
 * Navigations: network-first, then the cached document for this URL, then the precached shell.
 *
 * Without this, navigation requests fell through to the network untouched — so with the network
 * offline the browser never obtained an HTML document and never reached anything cached behind it.
 * `precacheCritical` already stores `./`, `./index.html` and the builder route, but nothing ever
 * consulted the cache for a navigation, so those entries could not actually be served. Everything
 * except the entry point was cached, which made the runbook's offline claim false as written.
 *
 * The `./index.html` fallback covers a route that was never precached or visited: this is a
 * prerendered export where every route ships the same client shell, so that document boots any of
 * them and the router takes over once the (cache-first) JS loads.
 */
async function navigationFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await putSafely(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.match(new URL("./index.html", self.registration.scope));
    if (shell) return shell;
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

  // The entry point: nothing else in the cache is reachable without a document.
  if (request.mode === "navigate") {
    event.respondWith(navigationFirst(request));
    return;
  }
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
  // Everything else falls through to the network untouched.
});
