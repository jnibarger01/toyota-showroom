/**
 * Baseline security headers for every `app/api/v1/**` response — the Cloudflare Worker side of
 * this project's two independent deployment targets (§5's "Deployment note"). These are JSON API
 * responses, never rendered as HTML, so the policy is deliberately locked down rather than
 * app-specific: nothing here is ever meant to execute a script, load a frame, or render at all.
 *
 * The static HTML shell GitHub Pages serves is a different surface with different needs (it does
 * load scripts, styles, WebGPU) and gets its own policy via a `<meta http-equiv>` tag in
 * `app/layout.tsx` — a plain object of header values can't reach that surface at all, since GitHub
 * Pages has no server to attach response headers with.
 */
const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  // API responses are pure JSON; nothing here should ever load a script, style, image, or frame.
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

/**
 * Merges the baseline security headers under whatever a caller already set — a route's own
 * `Cache-Control`/`ETag`/`Retry-After`/`Location` always wins if it happens to collide (none of
 * them do today), so this never has to be threaded through call order carefully.
 */
export function withSecurityHeaders(init: HeadersInit = {}): Headers {
  const headers = new Headers(API_SECURITY_HEADERS);
  new Headers(init).forEach((value, key) => headers.set(key, value));
  return headers;
}
