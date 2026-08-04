const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

export function requestIdFor(request?: Request): string {
  return request?.headers.get("cf-ray") ?? request?.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function responseHeaders(
  request?: Request,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "X-Request-Id": requestIdFor(request),
    ...extra,
  };
}
