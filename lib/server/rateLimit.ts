// See instrumentation.ts for why this specific reference form is needed to typecheck the dynamic
// `import("cloudflare:workers")` below.
/// <reference types="@cloudflare/workers-types/latest" />
import { tooManyRequests } from "../api/errors";

/**
 * Cloudflare rate-limit binding surface used by configuration writes, lead writes, and catalog
 * reads. Each traffic class has its own binding/budget so public browsing cannot consume a user's
 * ability to save a build or submit a legitimate inquiry.
 */
export interface RateLimitOutcome {
  success: boolean;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<RateLimitOutcome>;
}

const RATE_LIMIT_PERIOD_SECONDS = 60; // Must match wrangler.jsonc's ratelimits[].simple.period.

/** Binding names in `wrangler.jsonc`; each traffic class is metered independently. */
type LimiterName = "CONFIG_WRITE_LIMITER" | "LEAD_WRITE_LIMITER" | "CATALOG_READ_LIMITER";

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
 * `cf-connecting-ip` is set by Cloudflare's edge and cannot be spoofed by a client. There is
 * deliberately no fallback to `x-forwarded-for` or `x-real-ip`: those are caller-controlled and
 * would make the limiter trivial to evade. Returning `null` avoids collapsing every unidentified
 * caller into one global outage-inducing bucket.
 */
function clientKey(request: Request): string | null {
  return request.headers.get("cf-connecting-ip") ?? null;
}

async function enforce(
  request: Request,
  limiter: RateLimitBinding | null,
  message: string,
): Promise<void> {
  if (!limiter) return;

  const key = clientKey(request);
  if (!key) {
    console.warn("[ratelimit] no cf-connecting-ip on request; skipping rate limit for this caller.");
    return;
  }

  const { success } = await limiter.limit({ key });
  if (!success) throw tooManyRequests(message);
}

/** Configuration mutation budget. */
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
 * Public lead-submission budget. This is separate from configuration writes because customer PII
 * intake is both more abuse-sensitive and operationally more important than anonymous build saves.
 */
export async function enforceLeadWriteRateLimit(
  request: Request,
  limiterOverride?: RateLimitBinding | null,
): Promise<void> {
  const limiter =
    limiterOverride !== undefined ? limiterOverride : await getAmbientLimiter("LEAD_WRITE_LIMITER");
  await enforce(
    request,
    limiter,
    "Too many contact requests from this client. Please slow down and retry shortly.",
  );
}

/** Catalog-read budget. */
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
