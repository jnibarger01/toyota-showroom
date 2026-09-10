import type { QualityTier } from "./quality";

/**
 * Idle-time warming of assets a viewer is *likely* to ask for next.
 *
 * The hitch this removes is narrow and worth naming precisely. Switching grades does not load
 * anything — every grade of a vehicle shares one GLB — and paint options are material parameters,
 * not downloads. The one selection in the builder that triggers a cold network fetch is choosing an
 * HDRI preset that carries an `hdrUrl`: a multi-hundred-KB `.hdr` fetched, parsed and PMREM-filtered
 * while the viewer waits, having already been told the option is available.
 *
 * So this prefetches HDRIs and nothing else. #53's title says "grade / paint assets"; for this
 * catalog there are none, and prefetching things that are already resident would be motion without
 * effect.
 *
 * ## The constraints are the feature
 *
 * A prefetch is speculative work competing with work the viewer actually asked for. Every guard
 * below exists so that speculation can never win that competition:
 *
 *   - **After first paint only.** Nothing starts until the caller says the scene reached `ready`.
 *     Bandwidth spent before that delays the vehicle itself, which is the opposite of the goal.
 *   - **Idle only.** Scheduled through `requestIdleCallback` where available, so it yields to
 *     rendering and interaction rather than competing on the main thread.
 *   - **Never while suspended.** A backgrounded tab or a scrolled-away canvas prefetching assets is
 *     spending someone's data on a page they are not looking at.
 *   - **Not on the low tier, and not under Save-Data.** Both are explicit signals that the device or
 *     connection is constrained. `lib/three/quality.ts` already reads `saveData` to pick a tier; a
 *     prefetcher that ignored it would undo that decision.
 *   - **One at a time, once each.** Sequential rather than parallel, so a prefetch queue cannot
 *     saturate the connection, and already-attempted ids are never retried.
 *
 * Deliberately free of DOM and three.js imports: the loader is injected, so the policy above is
 * testable without a GPU, a network, or a browser.
 */

export interface PrefetchSchedulerOptions {
  /** Warms one asset. Resolves `true` if it fetched something, `false` if there was nothing to do. */
  load: (id: string) => Promise<boolean>;
  /** Ids to warm, in priority order. */
  ids: readonly string[];
  /** Live quality tier. `low` disables prefetching entirely. */
  tier: QualityTier;
  /** `navigator.connection.saveData`. Disables prefetching entirely. */
  saveData?: boolean;
  /** Whether the canvas is currently suspended (hidden tab / off-screen). Polled before each item. */
  isSuspended?: () => boolean;
  /** Injected for tests; defaults to `requestIdleCallback`, falling back to a macrotask. */
  scheduleIdle?: (callback: () => void) => () => void;
}

export interface PrefetchScheduler {
  /**
   * Call once the scene has reached its `ready` phase, and again when the canvas resumes from
   * suspension. Safe to call repeatedly: a second call while work is pending is a no-op.
   */
  start(): void;
  /** Ids successfully warmed so far — the assertion surface for tests and the dev hook. */
  completed(): readonly string[];
  /** Cancels anything pending. Safe to call more than once. */
  dispose(): void;
}

function defaultScheduleIdle(callback: () => void): () => void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === "function") {
    // The timeout bounds how long the browser may defer this. Without it a page that never goes
    // idle — a slowly-orbiting scene is exactly that — would never prefetch at all.
    const handle = ric(callback, { timeout: 4000 });
    const cancel = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
    return () => cancel?.(handle);
  }
  // Safari has no requestIdleCallback. A macrotask is not idle, but it is still after first paint
  // and after the current task, which is most of the benefit.
  const timer = setTimeout(callback, 1200);
  return () => clearTimeout(timer);
}

export function createPrefetchScheduler(options: PrefetchSchedulerOptions): PrefetchScheduler {
  const { load, ids, tier, saveData = false, isSuspended = () => false } = options;
  const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle;

  const done: string[] = [];
  const attempted = new Set<string>();
  let disposed = false;
  /** True while an idle callback is scheduled or a load is in flight — guards against two pumps. */
  let pending = false;
  let cancelPending: (() => void) | null = null;

  const enabled = tier !== "low" && !saveData;

  function pump(): void {
    if (disposed || !enabled || pending) return;
    const next = ids.find((id) => !attempted.has(id));
    if (next === undefined) return;

    pending = true;
    cancelPending = scheduleIdle(() => {
      cancelPending = null;
      if (disposed) return;
      // Re-checked here rather than only at start: a viewer can background the tab between the
      // scheduling call and the callback, which on a slow idle queue is a long window.
      if (isSuspended()) {
        // Stop rather than reschedule. Re-pumping here spins: the id is still unattempted, so the
        // next pass picks the same one and finds the same suspension, forever — burning CPU on
        // exactly the backgrounded tab this guard exists to protect. The queue restarts from
        // `start()` when the canvas comes back.
        pending = false;
        return;
      }
      attempted.add(next);
      void load(next)
        .then((fetched) => {
          if (!disposed && fetched) done.push(next);
        })
        .catch(() => {
          // Swallowed by contract: a failed prefetch must be indistinguishable from one that never
          // ran, since the real load will retry and report for itself.
        })
        .finally(() => {
          // Sequential: the next item is only scheduled once this one settles, so a queue cannot
          // saturate the connection it is trying to stay out of the way of.
          pending = false;
          if (!disposed) pump();
        });
    });
  }

  return {
    /**
     * Also the resume path. A suspended canvas stops the queue rather than spinning on it, so this
     * is how it restarts — hence no `started` short-circuit, only the `pending` guard inside `pump`
     * to stop a second call running a second queue.
     */
    start() {
      if (disposed) return;
      pump();
    },
    completed: () => done,
    dispose() {
      disposed = true;
      cancelPending?.();
      cancelPending = null;
    },
  };
}
