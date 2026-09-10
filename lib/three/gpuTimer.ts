import * as THREE from "three";

/**
 * Optional GPU-side frame timing, behind capability detection.
 *
 * `FrameTimeTracker` measures the wall-clock gap between rAF callbacks. That is a real signal and
 * it is what `QualityGovernor` steers on, but it is CPU-side: it says how long a frame took to come
 * around, not how long the GPU spent on it. The two diverge in exactly the cases that matter here.
 * A frame can be CPU-bound (JS, picking, GSAP) with the GPU mostly idle, in which case dropping
 * pixel ratio and shadows — everything the tier ladder controls — buys nothing, and the governor
 * will keep stepping down and making the scene worse without recovering frame time. Conversely a
 * vsync-capped 16.7ms frame looks identical whether the GPU finished in 2ms or 16ms, so the
 * governor cannot tell a device with headroom from one about to fall off a cliff.
 *
 * Issue #33 asks for GPU timing by name. This provides it where the platform does, and returns
 * `null` where it does not — the honest outcome, given the two backends expose it differently and
 * neither exposes it universally:
 *
 *   - **WebGPU** — `timestamp-query` is an optional device feature. three's renderer wraps it as
 *     `trackTimestamp` + `resolveTimestampsAsync`, so the work is enabling it and reading the value.
 *   - **WebGL2** — `EXT_disjoint_timer_query_webgl2` is widely implemented but is also the extension
 *     most often disabled for fingerprinting reasons, and its results must be discarded whenever the
 *     driver reports a disjoint (a context switch mid-measurement makes the number meaningless).
 *
 * Deliberately *not* wired into the governor's stepping decision. Doing that would change tuning
 * that was calibrated against the CPU signal, on a machine where neither signal can be measured
 * (this repo's CI has no GPU — see `docs/POSTPROCESSING_EVALUATION.md` for the same constraint
 * blocking postprocessing). The number is published to the canvas dataset and telemetry so the
 * question "is this scene GPU-bound?" becomes answerable on real hardware first. Deciding on the
 * governor's policy before there is data would be inventing the evidence.
 */

export type GpuTimerSource = "webgpu-timestamp" | "webgl-disjoint-timer";

export interface GpuTimer {
  readonly source: GpuTimerSource;
  /** Called immediately before the renderer paints. */
  beginFrame(): void;
  /** Called immediately after the paint is issued. */
  endFrame(): void;
  /** Most recently resolved GPU duration in ms, or `null` before any result is available. */
  lastGpuMs(): number | null;
  dispose(): void;
}

/** Minimal shape of three's WebGPU renderer that this module needs, without importing `three/webgpu`
 * here — `RenderController` already owns that dependency, and duplicating it would pull the WebGPU
 * build into every module that transitively imports this one. */
interface TimestampCapableRenderer {
  trackTimestamp?: boolean;
  resolveTimestampsAsync?: (type?: unknown) => Promise<number | undefined>;
  backend?: { hasFeatureAsync?: (name: string) => Promise<boolean> };
}

/**
 * Builds a timer for `renderer`, or `null` when the platform cannot provide one.
 *
 * Never throws: a caller that cannot get GPU timing must still render. Every failure path here —
 * missing extension, refused query allocation, a renderer that only partly implements the API —
 * ends in `null` rather than an exception in renderer construction.
 */
export function createGpuTimer(renderer: unknown): GpuTimer | null {
  try {
    if (renderer instanceof THREE.WebGLRenderer) return createWebglTimer(renderer);
    const candidate = renderer as TimestampCapableRenderer;
    if (typeof candidate?.resolveTimestampsAsync === "function") return createWebgpuTimer(candidate);
    return null;
  } catch {
    return null;
  }
}

function createWebgpuTimer(renderer: TimestampCapableRenderer): GpuTimer | null {
  // Enabling this is what makes the renderer allocate its query pool; without it
  // `resolveTimestampsAsync` resolves undefined forever.
  renderer.trackTimestamp = true;

  let latest: number | null = null;
  let inFlight = false;
  let disposed = false;

  return {
    source: "webgpu-timestamp",
    beginFrame() {},
    endFrame() {
      // Resolution is asynchronous and one outstanding request is enough: results arrive a frame or
      // two behind either way, and queueing one per frame would pile up promises faster than the
      // device retires them under exactly the load worth measuring.
      if (inFlight || disposed) return;
      inFlight = true;
      void renderer
        .resolveTimestampsAsync?.()
        .then((value) => {
          if (!disposed && typeof value === "number" && Number.isFinite(value)) latest = value;
        })
        .catch(() => {
          // A device that drops the query pool (surface loss, tab discard) rejects rather than
          // resolving. Keep the last good value and try again next frame.
        })
        .finally(() => {
          inFlight = false;
        });
    },
    lastGpuMs: () => latest,
    dispose() {
      disposed = true;
      renderer.trackTimestamp = false;
    },
  };
}

/** How many timer queries may be outstanding before new frames stop being measured. Results lag the
 * frame that produced them by a variable amount, so a pool absorbs the lag; a small one is enough
 * because this samples for reporting, not for every frame. */
const MAX_PENDING_QUERIES = 4;

function createWebglTimer(renderer: THREE.WebGLRenderer): GpuTimer | null {
  const context = renderer.getContext();
  if (!(typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext)) return null;
  // Bound to a narrowed const: TypeScript does not carry an `instanceof` narrowing into the
  // closures below, and re-narrowing inside each one would be noise.
  const gl: WebGL2RenderingContext = context;

  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    | null;
  if (!ext) return null;

  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let latest: number | null = null;
  let disposed = false;

  function drain(): void {
    // Front of the queue is the oldest; results complete in order, so stop at the first unfinished
    // one rather than scanning the whole queue every frame.
    while (pending.length > 0) {
      const query = pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
      pending.shift();
      // A disjoint means the GPU was preempted mid-measurement, so every outstanding result is
      // suspect, not just this one. Discarding the value is the specified handling.
      const disjoint = gl.getParameter(ext!.GPU_DISJOINT_EXT) as boolean;
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      if (!disjoint && Number.isFinite(nanoseconds)) latest = nanoseconds / 1e6;
      gl.deleteQuery(query);
    }
  }

  return {
    source: "webgl-disjoint-timer",
    beginFrame() {
      if (disposed || active) return;
      drain();
      if (pending.length >= MAX_PENDING_QUERIES) return;
      const query = gl.createQuery();
      if (!query) return;
      active = query;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    },
    endFrame() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    lastGpuMs: () => latest,
    dispose() {
      disposed = true;
      // An unfinished query must be ended before deletion or the context keeps the timer open.
      if (active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        gl.deleteQuery(active);
        active = null;
      }
      for (const query of pending) gl.deleteQuery(query);
      pending.length = 0;
    },
  };
}
