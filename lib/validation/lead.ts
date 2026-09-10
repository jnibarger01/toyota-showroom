import { invalidBody } from "../api/errors";
import { getVehicleBySlug } from "../data/vehicles";
import type { LeadKind, ValidatedLeadInput } from "../types/lead";

const LEAD_KINDS = new Set<LeadKind>(["contact", "model"]);
const ALLOWED_FIELDS = new Set(["kind", "name", "email", "message", "vehicleId", "idempotencyKey"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]+$/;

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_VEHICLE_ID_LENGTH = 80;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function requireObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidBody("Request body must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

function normalizedString(
  value: unknown,
  field: string,
  maxLength: number,
  options: { lowercase?: boolean } = {},
): string {
  if (typeof value !== "string") throw invalidBody(`"${field}" must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw invalidBody(`"${field}" must be a non-empty string.`);
  if (normalized.length > maxLength) {
    throw invalidBody(`"${field}" must be at most ${maxLength} characters.`);
  }
  return options.lowercase ? normalized.toLowerCase() : normalized;
}

/**
 * Authoritative server-side validation for public lead submissions.
 *
 * Unknown fields are rejected rather than ignored so client-controlled dealer facts, prices,
 * employee names, analytics identifiers, or arbitrary metadata can never silently cross this
 * boundary and become stored truth. Any vehicle context is resolved against the existing verified
 * catalog; the client cannot invent a model id.
 */
export function validateCreateLead(input: unknown): ValidatedLeadInput {
  const body = requireObject(input);

  for (const field of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(field)) throw invalidBody(`Unknown lead field "${field}".`);
  }

  if (typeof body.kind !== "string" || !LEAD_KINDS.has(body.kind as LeadKind)) {
    throw invalidBody(`"kind" must be one of: contact, model.`);
  }
  const kind = body.kind as LeadKind;

  const name = normalizedString(body.name, "name", MAX_NAME_LENGTH);
  const email = normalizedString(body.email, "email", MAX_EMAIL_LENGTH, { lowercase: true });
  if (!EMAIL.test(email)) throw invalidBody(`"email" must be a valid email address.`);
  const message = normalizedString(body.message, "message", MAX_MESSAGE_LENGTH);

  let vehicleId: string | undefined;
  if (body.vehicleId !== undefined) {
    vehicleId = normalizedString(body.vehicleId, "vehicleId", MAX_VEHICLE_ID_LENGTH).toLowerCase();
    if (!getVehicleBySlug(vehicleId)) {
      throw invalidBody(`"vehicleId" must identify a vehicle in the verified catalog.`);
    }
  }
  if (kind === "model" && !vehicleId) {
    throw invalidBody(`"vehicleId" is required for a model inquiry.`);
  }

  let idempotencyKey: string | undefined;
  if (body.idempotencyKey !== undefined) {
    idempotencyKey = normalizedString(body.idempotencyKey, "idempotencyKey", MAX_IDEMPOTENCY_KEY_LENGTH);
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw invalidBody(`"idempotencyKey" may contain only letters, numbers, period, underscore, colon, and hyphen.`);
    }
  }

  return {
    kind,
    name,
    email,
    message,
    ...(vehicleId ? { vehicleId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}
