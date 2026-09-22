// See instrumentation.ts for why this specific reference form is needed to typecheck the dynamic
// `import("cloudflare:workers")` below.
/// <reference types="@cloudflare/workers-types/latest" />
import { tooManyRequests } from "../api/errors";
import { hashOwnerToken } from "../shared/ownerToken";

/**
 * Cloudflare rate-limit binding surface used by configuration writes, lead writes, catalog reads,
 * and share-card unfurls. Each traffic class has its own binding/budget so public browsing cannot
 * consume a user's ability to save a build or submit a legitimate inquiry, and crawler bursts do
 * not consume the catalog-read allowance.
 *
 * Create traffic is metered separately from PATCH/DELETE: unbounded POSTs are what fill D1;
 * interactive editing needs a slightly higher per-IP (and per-owner-token) ceiling.
 *
 * Budgets below MUST stay in sync with `wrangler.jsonc`'s `ratelimits[].simple` values — they are
 * mirrored here so structured 429 bodies and the deployment runbook can cite one TypeScript source
 * of truth without parsing JSONC. Raise limits by editing both places (see DEPLOYMENT_RUNBOOK §9).
 */
export interface RateLimitOutcome {
  success: boolean;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<RateLimitOutcome>;
}

/** Must match wrangler.jsonc's ratelimits[].simple.period for every binding. */
export const RATE_LIMIT_PERIOD_SECONDS = 60;

/**
 * Documented budgets (requests per `RATE_LIMIT_PERIOD_SECONDS`). Keep aligned with wrangler.jsonc.
 * These are the knobs operators raise when a legitimate client is blocked — not secrets.
 */
export const RATE_LIMIT_BUDGETS = {
  /** POST /configurations — primary D1-fill guard. */
  configCreate: 10,
  /** PATCH/DELETE /configurations — per IP and independently per owner-token hash. */
  configWrite: 20,
  /** POST /leads — tighter anti-spam than anonymous build saves. */
  leadWrite: 5,
  /** GET catalog routes. */
  catalogRead: 300,
  /** GET /api/v1/share-card — tighter because unfurls can be triggered by third-party crawlers. */
  shareCardRead: 60,
} as const;

export type RateLimitScope = "ip" | "owner_token" | "create" | "lead" | "catalog" | "share_card";

/** Binding names in `wrangler.jsonc`; each traffic class is metered independently. */
type LimiterName =
  | "CONFIG_CREATE_LIMITER"
  | "CONFIG_WRITE_LIMITER"
  | "LEAD_WRITE_LIMITER"
  | "CATALOG_READ_LIMITER"
  | "SHARE_CARD_READ_LIMITER";

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
function clientIpKey(request: Request): string | null {
  const ip = request.headers.get("cf-connecting-ip");
  return ip ? `ip:${ip}` : null;
}

async function ownerTokenKey(ownerToken: string): Promise<string> {
  // Hash so a plaintext capability token never becomes a rate-limit key that could leak via logs.
  return `owner:${await hashOwnerToken(ownerToken)}`;
}

async function enforceKey(
  limiter: RateLimitBinding,
  key: string,
  message: string,
  scope: RateLimitScope,
  limit: number,
): Promise<void> {
  const { success } = await limiter.limit({ key });
  if (!success) {
    throw tooManyRequests(message, {
      retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS,
      periodSeconds: RATE_LIMIT_PERIOD_SECONDS,
      scope,
      limit,
    });
  }
}

async function enforceIp(
  request: Request,
  limiter: RateLimitBinding | null,
  message: string,
  scope: RateLimitScope,
  limit: number,
): Promise<void> {
  if (!limiter) return;

  const key = clientIpKey(request);
  if (!key) {
    console.warn("[ratelimit] no cf-connecting-ip on request; skipping rate limit for this caller.");
    return;
  }

  await enforceKey(limiter, key, message, scope, limit);
}

/**
 * Configuration *create* budget (POST /configurations). Tighter than PATCH/DELETE so a scripted
 * burst cannot fill D1 unbounded from one client IP.
 */
export async function enforceConfigCreateRateLimit(
  request: Request,
  limiterOverride?: RateLimitBinding | null,
): Promise<void> {
  const limiter =
    limiterOverride !== undefined
      ? limiterOverride
      : ((await getAmbientLimiter("CONFIG_CREATE_LIMITER")) ??
        (await getAmbientLimiter("CONFIG_WRITE_LIMITER")));
  await enforceIp(
    request,
    limiter,
    "Too many configuration creates from this client. Please slow down and retry shortly.",
    "create",
    RATE_LIMIT_BUDGETS.configCreate,
  );
}

/**
 * Configuration mutation budget (PATCH/DELETE). Enforces:
 * 1. per-IP budget (shared NAT still has a ceiling), and
 * 2. when `ownerToken` is present, an independent per-owner-token budget so one leaked token cannot
 *    burn the whole IP's allowance (or hammer one build unboundedly from many IPs).
 */
/**
 * @param limiterOverride - Test injection / ambient skip (`null`). When omitted, reads the Worker binding.
 * @param ownerToken - When present (PATCH/DELETE), also meters an independent per-token budget.
 */
export async function enforceConfigWriteRateLimit(
  request: Request,
  limiterOverride?: RateLimitBinding | null,
  ownerToken?: string,
): Promise<void> {
  const limiter =
    limiterOverride !== undefined ? limiterOverride : await getAmbientLimiter("CONFIG_WRITE_LIMITER");

  await enforceIp(
    request,
    limiter,
    "Too many configuration writes from this client. Please slow down and retry shortly.",
    "ip",
    RATE_LIMIT_BUDGETS.configWrite,
  );

  const token = ownerToken?.trim();
  if (limiter && token) {
    await enforceKey(
      limiter,
      await ownerTokenKey(token),
      "Too many configuration writes for this owner token. Please slow down and retry shortly.",
      "owner_token",
      RATE_LIMIT_BUDGETS.configWrite,
    );
  }
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
  await enforceIp(
    request,
    limiter,
    "Too many contact requests from this client. Please slow down and retry shortly.",
    "lead",
    RATE_LIMIT_BUDGETS.leadWrite,
  );
}

/** Catalog-read budget. */
export async function enforceCatalogReadRateLimit(
  request: Request,
  limiterOverride?: RateLimitBinding | null,
): Promise<void> {
  const limiter =
    limiterOverride !== undefined ? limiterOverride : await getAmbientLimiter("CATALOG_READ_LIMITER");
  await enforceIp(
    request,
    limiter,
    "Too many catalog requests from this client. Please retry shortly.",
    "catalog",
    RATE_LIMIT_BUDGETS.catalogRead,
  );
}

/** Share-card unfurl budget; intentionally separate from high-volume catalog reads. */
export async function enforceShareCardRateLimit(
  request: Request,
  limiterOverride?: RateLimitBinding | null,
): Promise<void> {
  const limiter =
    limiterOverride !== undefined ? limiterOverride : await getAmbientLimiter("SHARE_CARD_READ_LIMITER");
  await enforceIp(
    request,
    limiter,
    "Too many share-card requests from this client. Please retry shortly.",
    "share_card",
    RATE_LIMIT_BUDGETS.shareCardRead,
  );
}

/** Response header hint for a 429; not exact (the binding doesn't expose window-reset timing). */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = RATE_LIMIT_PERIOD_SECONDS;
