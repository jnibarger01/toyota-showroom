import type { PersistenceMode } from "../api/configurations";

/**
 * Registers the demo service worker (`public/sw.js`), and — just as importantly — unregisters it.
 *
 * The worker is scoped to the GitHub Pages demo, where there is no Cloudflare Worker and no D1.
 * Registration is therefore gated on `getPersistenceMode()` having resolved to `"local"`, meaning
 * the app has *proven* at runtime that the API routes are absent, rather than on a build flag that
 * could be wrong. A service worker installed against the production Worker deployment could serve
 * stale configuration responses from cache, which is a far worse failure than the download cost it
 * would save — so the gate is a proof, not an assumption.
 *
 * The `"worker"` branch is not defensive padding. A browser that visited the Pages demo and later
 * visits a real deployment on the same origin still has the worker installed, and it would keep
 * intercepting. Unregistering on sight is what makes that recoverable without asking anyone to
 * clear site data.
 */

/** Filename of the worker, and the marker used to recognise our own registrations. */
export const DEMO_SW_PATH = "sw.js";

export interface DemoServiceWorkerDeps {
  /** Defaults to the real container. Injected so the policy is testable without a browser. */
  serviceWorker?: ServiceWorkerContainer;
  /** Base path the app is served under, so the worker's scope matches (Pages serves a sub-path). */
  basePath?: string;
}

/**
 * Whether a registration is the one this module installed.
 *
 * Compares the resolved pathname for equality rather than testing whether the script URL *contains*
 * `sw.js`. A substring test also matches a conventionally-named worker belonging to a different app
 * on the same origin — `/other-app/app-sw.js` ends in `sw.js` — and unregistering that would
 * silently disable another application's offline support. A false negative here costs a stale demo
 * cache; a false positive breaks software this code has no business touching.
 */
function isOurWorker(registration: ServiceWorkerRegistration, basePath: string | undefined): boolean {
  const scriptURL = registration.active?.scriptURL ?? registration.installing?.scriptURL ?? registration.waiting?.scriptURL;
  if (!scriptURL) return false;
  const base = (basePath ?? "").replace(/\/$/, "");
  try {
    // Resolved against the page so a relative or absolute registration compares the same way.
    return new URL(scriptURL, globalThis.location?.href).pathname === `${base}/${DEMO_SW_PATH}`;
  } catch {
    return false;
  }
}

/**
 * Applies the correct state for `mode`. Safe to call repeatedly and on every mode change.
 *
 * Never throws: registration failures are reported and swallowed. A demo cache is an optimisation,
 * and an optimisation must not be able to break the page it is optimising.
 */
export async function syncDemoServiceWorker(
  mode: PersistenceMode,
  deps: DemoServiceWorkerDeps = {},
): Promise<"registered" | "unregistered" | "skipped"> {
  const container = deps.serviceWorker ?? (globalThis.navigator as Navigator | undefined)?.serviceWorker;
  if (!container) return "skipped";

  // "unknown" means detection has not finished. Doing nothing is correct: registering early could
  // install against a Worker deployment, and unregistering early would undo a valid demo cache on
  // every page load.
  if (mode === "unknown") return "skipped";

  try {
    if (mode === "worker") {
      const registrations = await container.getRegistrations();
      const ours = registrations.filter((registration) => isOurWorker(registration, deps.basePath));
      if (ours.length === 0) return "skipped";
      await Promise.all(ours.map((registration) => registration.unregister()));
      return "unregistered";
    }

    const base = (deps.basePath ?? "").replace(/\/$/, "");
    await container.register(`${base}/${DEMO_SW_PATH}`, { scope: `${base}/` });
    return "registered";
  } catch (error) {
    console.warn("[demo-sw] registration failed; continuing without a cache.", error);
    return "skipped";
  }
}
