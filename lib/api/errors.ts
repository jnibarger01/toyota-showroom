/** Structured API errors (goal 15). Every non-2xx response body matches ApiErrorBody. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    status: number;
    message: string;
  };
}

export function toErrorBody(err: ApiError): ApiErrorBody {
  return { error: { code: err.code, status: err.status, message: err.message } };
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

/** The client's `expectedRevision` no longer matches the stored record. */
export function revisionConflict(message: string): ApiError {
  return new ApiError(409, "revision_conflict", message);
}

/** Missing or non-matching owner token on a write to a configuration the caller doesn't own. */
export function forbidden(message: string): ApiError {
  return new ApiError(403, "forbidden", message);
}
