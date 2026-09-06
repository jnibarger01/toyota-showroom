// See instrumentation.ts for why this specific reference form is needed to typecheck the dynamic
// `import("cloudflare:workers")` below.
/// <reference types="@cloudflare/workers-types/latest" />
import { tooManyRequests } from "../api/errors";

/**
 * Throttles configuration writes.
 *
 * There is no user-account system to key a limit on (Task 10's ownership model is anonymous,
 * per-configuration capability tokens, not accounts), so this keys on client IP via Cloudflare's
 * `cf-connecting-ip` header — the standard, edge-verified source address, not spoofable the way an
 * arbitrary client-supplied header would be. Without this, a scripted client could create unlimited
 * configurations or hammer PATCH/DELETE with no cost, each individually well-formed and correctly
 * authenticated but unbounded in volume.
 *
 * Uses the same dynamic-`cloudflare:workers`-import-with-fallback pattern as
 * `instrumentation.ts`/`d1ConfigurationRepository.ts`'s binding: no-ops everywhere the binding isn't
 * present (Node dev, tests, a Worker deployed before `wrangler.jsonc`'s `ratelimits` entry exists)
 * rather than sniffing the environment or requiring every caller to know whether limiting is active.
 */

export interface RateLimitOutcome {
  success: boolean;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<RateLimitOutcome>;
}

const RATE_LIMIT_PERIOD_SECONDS = 60; // Must match wrangler.jsonc's ratelimits[].simple.period.

/** Binding names in `wrangler.jsonc`. Writes and reads are metered separately — see below. */
type LimiterName = "CONFIG_WRITE_LIMITER" | "CATALOG_READ_LIMITER";

async function getAmbientLimiter(name: LimiterName): Promise<RateLimitBinding | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return (env as Partial<Record<LimiterName, RateLimitBinding>>)[name] ?? null;
  } catch {
    return null; // Not running inside a Cloudflare Worker.
  }
}

/**
 * Per-client bucket key, or `null` when the caller cannot be identified.
 *
 * `cf-connecting-ip` is set by Cloudflare's edge and cannot be spoofed by a client, which is what
 * makes it usable as a limit key at all. There is deliberately no fallback to `x-forwarded-for` or
 * `x-real-ip`: those are client-supplied, so an attacker would simply rotate the value and evade
 * the limit entirely, while legitimate traffic would be metered. A fallback that only constrains
 * honest callers is worse than none.
 *
 * Returning `null` rather than a literal `"unknown"` is the substantive fix here. The previous
 * `?? "unknown"` collapsed every unidentifiable caller into one shared bucket, so a deployment
 * where the header went missing did not lose rate limiting — it rate-limited *all* of its users
 * against a single 30-per-minute budget, turning a header problem into an outage. Callers below
 * treat `null` as "do not limit this request", which loses enforcement only in a configuration
 * that should not occur on Cloudflare, and says so loudly instead of failing quietly.
 */
function clientKey(request: Request): string | null {
  return request.headers.get("cf-connecting-ip") ?? null;
}

/** Shared enforcement. `kind` only shapes the message a rejected caller sees. */
async function enforce(
  request: Request,
  limiter: RateLimitBinding | null,
  message: string,
): Promise<void> {
  if (!limiter) return;

  const key = clientKey(request);
  if (!key) {
    // Loud, because silently unlimited is exactly the state nobody notices until it is abused.
    console.warn("[ratelimit] no cf-connecting-ip on request; skipping rate limit for this caller.");
    return;
  }

  const { success } = await limiter.limit({ key });
  if (!success) throw tooManyRequests(message);
}

/**
 * Throws `tooManyRequests()` if the caller has exceeded the configured write rate. Call at the top
 * of every configuration-mutating route handler (POST/PATCH/DELETE), before any validation work.
 *
 * `limiterOverride` exists for tests: route handlers never pass it, so production always resolves
 * the binding ambiently via `cloudflare:workers` — the same ordinary-argument-optional pattern lets
 * tests inject either a fake (fast, deterministic) or a real local binding obtained through
 * wrangler's `getPlatformProxy()` (see tests/rateLimit.test.ts) without needing a full Workers
 * runtime just to exercise this one function.
 */
export async function enforceConfigWriteRateLimit(
  request: Request,
  limiterOverride?: RateLimitBinding | null,
): Promise<void> {
  const limiter =
    limiterOverride !== undefined ? limiterOverride : await getAmbientLimiter("CONFIG_WRITE_LIMITER");
  await enforce(
    request,
    limiter,
    "Too many configuration writes from this client. Please slow down and retry shortly.",
  );
}

/**
 * Throws `tooManyRequests()` when a client exceeds the catalog *read* rate.
 *
 * The catalog and media routes were entirely unmetered. Each one serialises the full vehicle
 * dataset, and `GET /api/v1/vehicles` additionally filters and paginates it per request, so an
 * unbounded caller could keep the Worker busy indefinitely at no cost — no token, no body, nothing
 * to validate and reject early.
 *
 * The ceiling is an order of magnitude above the write limit (300/min vs 30/min) because these are
 * cheap, cacheable, idempotent reads, and because the browser legitimately makes several of them
 * per page load. It is a guard against scripted abuse, not a quota a human can reach: a person
 * clicking through every vehicle in the lineup should never see a 429.
 *
 * Reads still succeed unmetered when the binding is absent, which is what keeps `npm run dev`,
 * `vitest`, and the static export working with no configuration.
 */
export async function enforceCatalogReadRateLimit(
  request: Request,
  limiterOverride?: RateLimitBinding | null,
): Promise<void> {
  const limiter =
    limiterOverride !== undefined ? limiterOverride : await getAmbientLimiter("CATALOG_READ_LIMITER");
  await enforce(request, limiter, "Too many catalog requests from this client. Please retry shortly.");
}

/** Response header hint for a 429; not exact (the binding doesn't expose window-reset timing). */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = RATE_LIMIT_PERIOD_SECONDS;
