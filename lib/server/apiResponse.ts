import { NextResponse } from "next/server";
import { ApiError, toErrorBody } from "../api/errors";
import { RATE_LIMIT_RETRY_AFTER_SECONDS } from "./rateLimit";

/**
 * Converts an `ApiError` to the route handlers' shared response shape. Factored out once three
 * `app/api/v1/configurations/**` route files needed the same `catch` block, now with a `Retry-After`
 * hint on 429s that would otherwise need repeating identically in each.
 */
export function errorResponse(err: ApiError): NextResponse {
  const headers: HeadersInit = err.status === 429 ? { "Retry-After": String(RATE_LIMIT_RETRY_AFTER_SECONDS) } : {};
  return NextResponse.json(toErrorBody(err), { status: err.status, headers });
}
