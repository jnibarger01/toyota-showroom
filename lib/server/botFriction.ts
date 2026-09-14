// See instrumentation.ts for why this specific reference form is needed to typecheck the dynamic
// `import("cloudflare:workers")` below.
/// <reference types="@cloudflare/workers-types/latest" />
import { forbidden, invalidBody } from "../api/errors";

/**
 * Optional Cloudflare Turnstile bot friction on public create endpoints.
 *
 * Disabled by default. Enable by setting Worker secret `TURNSTILE_SECRET_KEY` (and optionally
 * `TURNSTILE_SITE_KEY` as a public var for the client widget). When the secret is absent the check
 * is a no-op so local/Vitest and Pages-only deploys keep working — same fail-open-when-unconfigured
 * pattern as CRM webhook handoff (`lib/server/crmWebhook.ts`).
 *
 * See `docs/DEPLOYMENT_RUNBOOK.md` §9 for knobs and enablement steps.
 */

export const TURNSTILE_SECRET_ENV = "TURNSTILE_SECRET_KEY";
export const TURNSTILE_SITE_KEY_ENV = "TURNSTILE_SITE_KEY";
/** Explicit override: `"0"` / `"false"` forces friction off even when a secret is present. */
export const TURNSTILE_ENABLED_ENV = "TURNSTILE_ENABLED";

/** Header clients should send after completing a Turnstile widget (`cf-turnstile-response`). */
export const TURNSTILE_RESPONSE_HEADER = "cf-turnstile-response";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface BotFrictionEnv {
  secret?: string;
  siteKey?: string;
  /** When explicitly false, skip even if secret is set. */
  enabled?: boolean;
}

export interface TurnstileVerifyResult {
  success: boolean;
  "error-codes"?: string[];
}

type FetchLike = typeof fetch;

let envOverride: BotFrictionEnv | null = null;
let fetchOverride: FetchLike | null = null;

/** Test injection — restores via `resetBotFrictionForTests`. */
export function setBotFrictionEnvForTests(env: BotFrictionEnv | null): void {
  envOverride = env;
}

export function setBotFrictionFetchForTests(fetchImpl: FetchLike | null): void {
  fetchOverride = fetchImpl;
}

export function resetBotFrictionForTests(): void {
  envOverride = null;
  fetchOverride = null;
}

function parseEnabledFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") {
    return true;
  }
  return undefined;
}

async function readWorkerEnv(): Promise<BotFrictionEnv> {
  if (envOverride) return envOverride;
  try {
    const { env } = await import("cloudflare:workers");
    const cloudflareEnv = env as Record<string, string | undefined>;
    return {
      secret: cloudflareEnv[TURNSTILE_SECRET_ENV]?.trim() || undefined,
      siteKey: cloudflareEnv[TURNSTILE_SITE_KEY_ENV]?.trim() || undefined,
      enabled: parseEnabledFlag(cloudflareEnv[TURNSTILE_ENABLED_ENV]),
    };
  } catch {
    return {
      secret: process.env[TURNSTILE_SECRET_ENV]?.trim() || undefined,
      siteKey: process.env[TURNSTILE_SITE_KEY_ENV]?.trim() || undefined,
      enabled: parseEnabledFlag(process.env[TURNSTILE_ENABLED_ENV]),
    };
  }
}

/** True when a secret is configured and not explicitly disabled. */
export function isBotFrictionEnabled(env: BotFrictionEnv): boolean {
  if (env.enabled === false) return false;
  if (env.enabled === true) return Boolean(env.secret);
  return Boolean(env.secret);
}

export function turnstileTokenFrom(request: Request): string | null {
  const header = request.headers.get(TURNSTILE_RESPONSE_HEADER)?.trim();
  if (header) return header;
  return null;
}

/**
 * Verifies a Turnstile response token against Cloudflare's siteverify endpoint.
 * Exported for unit tests — production callers should use `enforceCreateBotFriction`.
 */
export async function verifyTurnstileToken(
  token: string,
  secret: string,
  remoteip: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<TurnstileVerifyResult> {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteip) body.set("remoteip", remoteip);

  const response = await fetchImpl(SITEVERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    return { success: false, "error-codes": [`http_${response.status}`] };
  }

  try {
    return (await response.json()) as TurnstileVerifyResult;
  } catch {
    return { success: false, "error-codes": ["invalid_json"] };
  }
}

/**
 * Optional bot friction gate for create endpoints. No-op when Turnstile is not configured.
 * Throws `invalidBody` when enabled but the token is missing; `forbidden` when verification fails.
 */
export async function enforceCreateBotFriction(request: Request): Promise<void> {
  const env = await readWorkerEnv();
  if (!isBotFrictionEnabled(env) || !env.secret) return;

  const token = turnstileTokenFrom(request);
  if (!token) {
    throw invalidBody(
      `Bot friction is enabled; provide a Turnstile token via the ${TURNSTILE_RESPONSE_HEADER} header.`,
    );
  }

  const remoteip = request.headers.get("cf-connecting-ip");
  const fetchImpl = fetchOverride ?? fetch;
  const result = await verifyTurnstileToken(token, env.secret, remoteip, fetchImpl);
  if (!result.success) {
    throw forbidden("Bot friction challenge failed. Please retry the create request.");
  }
}
