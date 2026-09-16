import { ApiError } from "../api/errors";
import type { Lead, LeadBuildSnapshot } from "../types/lead";

/**
 * Salesforce/HubSpot-agnostic CRM webhook handoff for accepted leads.
 *
 * Secrets (`CRM_WEBHOOK_URL`, `CRM_WEBHOOK_SECRET`) live only in Worker env (`wrangler secret put`).
 * They are never returned to clients, never embedded in the webhook JSON body, and never read from
 * request headers. When `CRM_WEBHOOK_URL` is unset the handoff is a no-op so local/Vitest and
 * Pages-only deploys keep working; when it *is* set, delivery failure fails the lead request so the
 * form cannot claim a successful handoff that did not happen.
 */

export const CRM_WEBHOOK_URL_ENV = "CRM_WEBHOOK_URL";
export const CRM_WEBHOOK_SECRET_ENV = "CRM_WEBHOOK_SECRET";

/** Agnostic payload shape — mapable to Salesforce outbound / HubSpot workflow webhooks. */
export interface CrmLeadWebhookPayload {
  event: "lead.created";
  source: "toyota-showroom";
  lead: {
    id: string;
    kind: Lead["kind"];
    name: string;
    email: string;
    message: string;
    vehicleId?: string;
    createdAt: string;
  };
  /** Present when the client attached a builder snapshot. */
  vehicle?: { id: string; gradeId: string };
  selections?: LeadBuildSnapshot["selections"];
  shareUrl?: string;
  /** Metadata only — never a plaintext owner token. */
  ownerToken?: { present: boolean; configurationId?: string };
}

export interface CrmWebhookEnv {
  url?: string;
  secret?: string;
}

export type CrmHandoffResult = { status: "skipped" } | { status: "delivered"; statusCode: number };

type FetchLike = typeof fetch;

let envOverride: CrmWebhookEnv | null = null;
let fetchOverride: FetchLike | null = null;

/** Test injection — restores via `resetCrmWebhookForTests`. */
export function setCrmWebhookEnvForTests(env: CrmWebhookEnv | null): void {
  envOverride = env;
}

export function setCrmWebhookFetchForTests(fetchImpl: FetchLike | null): void {
  fetchOverride = fetchImpl;
}

export function resetCrmWebhookForTests(): void {
  envOverride = null;
  fetchOverride = null;
}

async function readWorkerEnv(): Promise<CrmWebhookEnv> {
  if (envOverride) return envOverride;
  try {
    const { env } = await import("cloudflare:workers");
    const cloudflareEnv = env as Record<string, string | undefined>;
    return {
      url: cloudflareEnv[CRM_WEBHOOK_URL_ENV]?.trim() || undefined,
      secret: cloudflareEnv[CRM_WEBHOOK_SECRET_ENV]?.trim() || undefined,
    };
  } catch {
    // Node / Vitest without Worker bindings — also honour process.env for local smoke only.
    const url = process.env[CRM_WEBHOOK_URL_ENV]?.trim() || undefined;
    const secret = process.env[CRM_WEBHOOK_SECRET_ENV]?.trim() || undefined;
    return { url, secret };
  }
}

/**
 * Builds the outbound CRM payload. Exported for fixture tests — callers must not attach secrets.
 */
export function buildCrmLeadWebhookPayload(lead: Lead, build?: LeadBuildSnapshot): CrmLeadWebhookPayload {
  const payload: CrmLeadWebhookPayload = {
    event: "lead.created",
    source: "toyota-showroom",
    lead: {
      id: lead.id,
      kind: lead.kind,
      name: lead.name,
      email: lead.email,
      message: lead.message,
      ...(lead.vehicleId ? { vehicleId: lead.vehicleId } : {}),
      createdAt: lead.createdAt,
    },
  };

  if (build) {
    payload.vehicle = { id: build.vehicleId, gradeId: build.gradeId };
    payload.selections = build.selections;
    payload.shareUrl = build.shareUrl;
    if (build.ownerToken) {
      payload.ownerToken = {
        present: build.ownerToken.present,
        ...(build.ownerToken.configurationId
          ? { configurationId: build.ownerToken.configurationId }
          : {}),
      };
    } else if (build.configurationId) {
      payload.ownerToken = { present: false, configurationId: build.configurationId };
    }
  }

  return payload;
}

/**
 * Deliver an accepted lead to the configured CRM webhook.
 *
 * - No URL configured → `{ status: "skipped" }` (local lead UX still depends on D1 success alone).
 * - URL configured and non-2xx / network failure → throws `ApiError` (502) so ValidatedLeadForm
 *   keeps showing a retryable failure instead of a false success.
 */
export async function deliverLeadToCrm(
  lead: Lead,
  build?: LeadBuildSnapshot,
): Promise<CrmHandoffResult> {
  const { url, secret } = await readWorkerEnv();
  if (!url) return { status: "skipped" };

  const payload = buildCrmLeadWebhookPayload(lead, build);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const fetchImpl = fetchOverride ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new ApiError(
      502,
      "crm_handoff_failed",
      "The contact request could not be handed off to the CRM. Please try again.",
      { cause },
    );
  }

  if (!response.ok) {
    throw new ApiError(
      502,
      "crm_handoff_failed",
      "The contact request could not be handed off to the CRM. Please try again.",
    );
  }

  return { status: "delivered", statusCode: response.status };
}
