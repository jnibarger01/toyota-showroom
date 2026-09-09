/**
 * Client-side real-user metrics for the 3D showroom.
 *
 * The server now emits structured request telemetry (`lib/server/telemetry.ts`), but essentially
 * everything expensive in this app happens *after* the response: downloading and Draco-decoding
 * the vehicle, picking a renderer backend, and sustaining a frame rate. None of that is visible
 * from a server log.
 *
 * That gap has a concrete cost right now. The thresholds in `lib/three/qualityGovernor.ts` — when
 * to step down, how long to wait before stepping back up — were chosen from reasoning about the
 * scene, not from measurement, because no measurement existed. These are the numbers that make
 * them checkable:
 *
 *   - `renderer_selected`   how often WebGPU is actually available versus the WebGL2 fallback
 *   - `model_loaded`        download and decode time for the vehicle, and its size
 *   - `first_frame`         time from scene setup to the first rendered frame
 *   - `quality_changed`     which hardware walks down the ladder, how far, and how fast
 *   - `environment_applied` whether image-based lighting is actually live, and on which backend
 *
 * `environment_applied` exists because IBL was silently absent on the WebGPU path for entire
 * releases: the code cleared `scene.environment` for any non-WebGL renderer and nothing anywhere
 * reported it, so the preferred backend shipped without reflections and no signal said so. A
 * fidelity feature that can switch itself off needs to be observable, not merely correct today.
 *
 * ## Buffered, then flushed once
 *
 * Metrics accumulate in memory and go out in a single batch when the page is hidden. Sending each
 * one as it happens would put network requests in the middle of model loading and frame rendering
 * — measurement that degrades the thing being measured. `visibilitychange` rather than `unload`
 * because `unload` is unreliable on mobile and blocked by the back/forward cache; `sendBeacon`
 * because a normal `fetch` is cancelled when the page goes away, which is exactly when this fires.
 *
 * ## Console when no endpoint is configured
 *
 * With no collector URL set the batch is logged instead of sent. That is the honest default for
 * this app as deployed: there is no analytics backend, and inventing an endpoint that silently
 * 404s would look like working telemetry while producing nothing. Logged, the data is available in
 * devtools and in a Playwright run — enough to actually tune the governor.
 */

export type MetricName =
  | "renderer_selected"
  | "model_loaded"
  | "first_frame"
  | "quality_changed"
  | "environment_applied";

export interface Metric {
  name: MetricName;
  /** Milliseconds, bytes, or a tier index, depending on `name`. Absent for pure labels. */
  value?: number;
  /**
   * Fixed-cardinality labels only — `{ renderer: "webgpu" }`, never a configuration id or a URL.
   * Same rule as the server side, for the same reason: telemetry is how identifiers leak into
   * systems with weaker access controls than the ones they came from.
   */
  labels?: Record<string, string>;
}

interface Session {
  metrics: Metric[];
  flushed: boolean;
}

const session: Session = { metrics: [], flushed: false };

/**
 * Collector URL, or null to log instead.
 *
 * Read from a build-time env var rather than hard-coded so a deployment that *does* have a
 * collector needs no code change. `import.meta.env` is inlined by Vite at build time, so this is a
 * constant in the shipped bundle, not a runtime lookup.
 */
const COLLECTOR_URL: string | null =
  (import.meta.env?.VITE_METRICS_URL as string | undefined) ?? null;

/** Records one metric. Cheap and synchronous — safe to call from a render-loop callback. */
export function recordMetric(metric: Metric): void {
  if (session.flushed) return; // Page is going away; a late metric would never be sent anyway.
  session.metrics.push(metric);
}

/** Everything recorded so far. Exposed for tests and for reading in devtools. */
export function collectedMetrics(): readonly Metric[] {
  return session.metrics;
}

/** Clears buffered state. Tests only — production has exactly one session per page load. */
export function resetMetrics(): void {
  session.metrics = [];
  session.flushed = false;
}

/**
 * Sends the batch, or logs it when no collector is configured.
 *
 * Idempotent: `visibilitychange` can fire more than once (a tab hidden, shown, and hidden again),
 * and a second flush would double-count every metric in the batch.
 */
export function flushMetrics(): void {
  if (session.flushed || session.metrics.length === 0) return;
  session.flushed = true;

  const payload = JSON.stringify({ metrics: session.metrics, at: new Date().toISOString() });

  if (!COLLECTOR_URL) {
    console.info("[metrics]", payload);
    return;
  }

  try {
    // `sendBeacon` survives the page going away, which a fetch does not. It can return false when
    // the browser's queue is full — dropping the batch is the right outcome there, since the whole
    // point is to not interfere with the page.
    navigator.sendBeacon?.(COLLECTOR_URL, new Blob([payload], { type: "application/json" }));
  } catch (error) {
    console.warn("[metrics] failed to send batch", error);
  }
}

/**
 * Installs the flush trigger. Returns a teardown function.
 *
 * Call once per page. Safe to call again — a duplicate listener would flush twice, and the
 * idempotency above makes the second call a no-op rather than a double-count.
 */
export function installMetricsFlush(): () => void {
  if (typeof document === "undefined") return () => {};

  const onHidden = () => {
    if (document.visibilityState === "hidden") flushMetrics();
  };
  document.addEventListener("visibilitychange", onHidden);
  // `pagehide` covers the Safari case where a tab is closed without a visibility transition.
  window.addEventListener("pagehide", flushMetrics);

  return () => {
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", flushMetrics);
  };
}
