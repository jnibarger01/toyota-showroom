/** Structured API errors (goal 15). Every non-2xx response body matches ApiErrorBody. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Optional structured extras (e.g. rate-limit budgets). Additive — older clients ignore it. */
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    status: number;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function toErrorBody(err: ApiError): ApiErrorBody {
  return {
    error: {
      code: err.code,
      status: err.status,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}

export function notFound(message: string): ApiError {
  return new ApiError(404, "not_found", message);
}

export function invalidQuery(message: string): ApiError {
  return new ApiError(400, "invalid_query", message);
}

/** Malformed or semantically invalid request body (unknown option id, bad grade/year combination). */
export function invalidBody(message: string): ApiError {
  return new ApiError(422, "invalid_body", message);
}

/** Request body exceeds the endpoint's pre-parse safety budget. */
export function payloadTooLarge(message: string): ApiError {
  return new ApiError(413, "payload_too_large", message);
}

/** The client's `expectedRevision` no longer matches the stored record. */
export function revisionConflict(message: string): ApiError {
  return new ApiError(409, "revision_conflict", message);
}

/** Missing or non-matching owner token on a write to a configuration the caller doesn't own. */
export function forbidden(message: string): ApiError {
  return new ApiError(403, "forbidden", message);
}

/**
 * The caller exceeded an API rate limit (`lib/server/rateLimit.ts`).
 * `details` carries retry/budget knobs so clients and runbooks share one source of truth.
 */
export function tooManyRequests(
  message: string,
  details?: {
    retryAfterSeconds: number;
    periodSeconds: number;
    scope: string;
    limit: number;
  },
): ApiError {
  return new ApiError(429, "rate_limited", message, details ? { details } : undefined);
}
