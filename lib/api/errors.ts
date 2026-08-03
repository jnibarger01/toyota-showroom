/** Structured API errors (goal 15). Every non-2xx response body matches ApiErrorBody. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
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
