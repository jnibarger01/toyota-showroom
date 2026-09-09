import type { CreateLeadInput, Lead } from "../types/lead";
import { ApiError, type ApiErrorBody } from "./errors";

const basePath =
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL.replace(/\/$/, "")
    : "";

function apiUrl(path: string): string {
  return `${basePath}/api/v1${path}`;
}

function isLead(value: unknown): value is Lead {
  if (typeof value !== "object" || value === null) return false;
  const lead = value as Partial<Lead>;
  return (
    typeof lead.id === "string" &&
    (lead.kind === "contact" || lead.kind === "model") &&
    typeof lead.name === "string" &&
    typeof lead.email === "string" &&
    typeof lead.message === "string" &&
    (lead.vehicleId === undefined || typeof lead.vehicleId === "string") &&
    typeof lead.createdAt === "string"
  );
}

/**
 * Submit customer PII to the authoritative Worker endpoint.
 *
 * There is intentionally no localStorage/in-memory fallback here. A missing, unreachable, or
 * malformed backend is a failed submission, not a demo-mode success.
 */
export async function submitLead(input: CreateLeadInput): Promise<Lead> {
  let response: Response;
  const url = apiUrl("/leads");

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    throw new ApiError(0, "network_error", "Could not reach the contact service.", { cause });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? "The contact request was not accepted.",
    );
  }

  const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
  if (!isLead(body?.data)) {
    throw new ApiError(response.status, "invalid_response", "The contact service returned an invalid response.");
  }

  return body.data;
}
