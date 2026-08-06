import { NextResponse } from "next/server";
import { ApiError, toErrorBody } from "../api/errors";
import { RATE_LIMIT_RETRY_AFTER_SECONDS } from "./rateLimit";
import { withSecurityHeaders } from "./securityHeaders";

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
