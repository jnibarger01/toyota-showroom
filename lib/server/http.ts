const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

const generatedRequestIds = new WeakMap<Request, string>();

export function requestIdFor(request?: Request): string {
  const forwarded = request?.headers.get("cf-ray") ?? request?.headers.get("x-request-id");
  if (forwarded) return forwarded;
  if (!request) return crypto.randomUUID();

  const existing = generatedRequestIds.get(request);
  if (existing) return existing;

  const generated = crypto.randomUUID();
  generatedRequestIds.set(request, generated);
  return generated;
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
