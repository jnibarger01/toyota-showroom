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

async function getAmbientLimiter(): Promise<RateLimitBinding | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return (env as { CONFIG_WRITE_LIMITER?: RateLimitBinding }).CONFIG_WRITE_LIMITER ?? null;
  } catch {
    return null; // Not running inside a Cloudflare Worker.
  }
}

function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
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
  const limiter = limiterOverride !== undefined ? limiterOverride : await getAmbientLimiter();
  if (!limiter) return;

  const { success } = await limiter.limit({ key: clientKey(request) });
  if (!success) {
    throw tooManyRequests("Too many configuration writes from this client. Please slow down and retry shortly.");
  }
}

/** Response header hint for a 429; not exact (the binding doesn't expose window-reset timing). */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = RATE_LIMIT_PERIOD_SECONDS;
