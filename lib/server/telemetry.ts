/**
 * Structured request telemetry for `app/api/v1/**`.
 *
 * Nothing observed this app in production. `instrumentation.ts` existed but only bound D1, routes
 * logged nothing, and the sole signal that anything had gone wrong was a user saying so. That is
 * also why the tuning in `lib/three/qualityGovernor.ts` is currently guesswork: there is no data
 * about what real hardware does with this scene.
 *
 * ## Why console is the default sink, not a placeholder for one
 *
 * In Workers, a structured `console.log` is a first-class telemetry channel: `wrangler tail`
 * streams it live, and Logpush ships it to R2, S3, or any HTTP sink without further code. So
 * emitting one JSON object per request is a real, queryable destination that needs no
 * infrastructure to exist first — not a TODO wearing a sink's clothes.
 *
 * Analytics Engine is better for aggregate queries (SQL over sampled events, no log retention
 * limits), so it is used when a `TELEMETRY` binding is present and skipped silently when it is
 * not. That mirrors how `lib/server/rateLimit.ts` treats its own optional binding: the feature
 * degrades, the request does not fail, and local development and tests need no bindings at all.
 *
 * ## The one rule about what goes in an event
 *
 * No request bodies, no owner tokens, no full URLs with query strings. Telemetry is the classic
 * way secrets end up in a log aggregator that has weaker access controls than the database they
 * came from. Everything below is either a fixed-cardinality label (route pattern, method, status)
 * or a number.
 */

/** Cloudflare Analytics Engine dataset binding. Structural, so no Workers types import is needed. */
interface AnalyticsEngineBinding {
  writeDataPoint(event: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface RequestEvent {
  /**
   * The route *pattern*, never the concrete path.
   *
   * `/api/v1/configurations/:id`, not `/api/v1/configurations/cfg_abc123`. Concrete ids would make
   * this a high-cardinality field that no aggregation can group by, and would put user-generated
   * identifiers into logs for no analytical gain.
   */
  route: string;
  method: string;
  status: number;
  durationMs: number;
  /** Present on failures: `ApiError.code`, a fixed set like `not_found` or `invalid_body`. */
  errorCode?: string;
}

async function analyticsBinding(): Promise<AnalyticsEngineBinding | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return (env as { TELEMETRY?: AnalyticsEngineBinding }).TELEMETRY ?? null;
  } catch {
    return null; // Not running inside a Cloudflare Worker.
  }
}

/**
 * Records one completed API request.
 *
 * Never throws and never rejects. A telemetry failure turning a successful request into a 500
 * would be a strictly worse outcome than having no telemetry, and this is called from the response
 * path of every route.
 */
export async function recordRequest(event: RequestEvent): Promise<void> {
  try {
    // One JSON object per line: greppable in `wrangler tail`, parseable by every log pipeline.
    console.log(JSON.stringify({ type: "api_request", ...event }));

    const analytics = await analyticsBinding();
    analytics?.writeDataPoint({
      // `indexes` is the sampling key. Route is the right choice: it keeps a low-traffic endpoint
      // visible instead of letting the busiest one dominate the sample.
      indexes: [event.route],
      blobs: [event.route, event.method, String(event.status), event.errorCode ?? ""],
      doubles: [event.durationMs],
    });
  } catch (error) {
    // Deliberately swallowed, but not silently — a telemetry pipeline that has quietly stopped
    // working looks exactly like a healthy system with no traffic.
    console.warn("[telemetry] failed to record request", error);
  }
}
