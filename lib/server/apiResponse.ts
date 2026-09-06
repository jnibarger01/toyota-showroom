import { NextResponse } from "next/server";
import { ApiError, toErrorBody } from "../api/errors";
import { RATE_LIMIT_RETRY_AFTER_SECONDS } from "./rateLimit";
import { withSecurityHeaders } from "./securityHeaders";
import { recordRequest } from "./telemetry";

/**
 * Converts an `ApiError` to every route handler's shared response shape — every `app/api/v1/**`
 * error path uses this, not just `configurations/**` (originally the only caller; consolidated
 * when the vehicle catalog routes' own duplicated `NextResponse.json(toErrorBody(err), ...)`
 * catches turned out to be the one place `lib/server/securityHeaders.ts`'s baseline headers
 * would otherwise have needed repeating). Also attaches a `Retry-After` hint on 429s.
 */
export function errorResponse(err: ApiError): NextResponse {
  const headers = withSecurityHeaders(err.status === 429 ? { "Retry-After": String(RATE_LIMIT_RETRY_AFTER_SECONDS) } : {});
  return NextResponse.json(toErrorBody(err), { status: err.status, headers });
}

/**
 * Wraps a route handler with timing, structured telemetry, and `ApiError` translation.
 *
 * Every route previously repeated the same `try { ... } catch (err) { if (err instanceof ApiError)
 * return errorResponse(err); throw err; }` block. Consolidating it here removes that duplication,
 * but the reason for doing it now is instrumentation: uniform telemetry needs a single choke point,
 * and instrumenting seven handlers by hand guarantees the eighth is forgotten — which is worse than
 * no metrics at all, because the gap is invisible in the data rather than in the code.
 *
 * `route` is the route *pattern*, passed explicitly rather than read from the request URL, so
 * telemetry groups by a fixed set of labels instead of by every configuration id users create.
 *
 * A non-`ApiError` throw is re-raised after being recorded as a 500. Swallowing it would convert a
 * genuine bug into a misleading response shape, and the platform's own error handling is a better
 * place to surface it than this wrapper is.
 */
export function withRouteTelemetry<Args extends unknown[]>(
  route: string,
  method: string,
  handler: (...args: Args) => Promise<NextResponse | Response>,
): (...args: Args) => Promise<NextResponse | Response> {
  return async (...args: Args) => {
    const startedAt = Date.now();
    try {
      const response = await handler(...args);
      void recordRequest({ route, method, status: response.status, durationMs: Date.now() - startedAt });
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        void recordRequest({
          route,
          method,
          status: err.status,
          durationMs: Date.now() - startedAt,
          errorCode: err.code,
        });
        return errorResponse(err);
      }

      void recordRequest({
        route,
        method,
        status: 500,
        durationMs: Date.now() - startedAt,
        errorCode: "unhandled",
      });
      throw err;
    }
  };
}
