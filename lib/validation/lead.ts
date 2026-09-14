import { invalidBody } from "../api/errors";
import { getVehicleBySlug } from "../data/vehicles";
import type { LeadBuildSnapshot, LeadKind, LeadOwnerTokenMeta, ValidatedLeadInput } from "../types/lead";
import { validateSelections, validateVehicleIdentity } from "./configuration";

const LEAD_KINDS = new Set<LeadKind>(["contact", "model"]);
const ALLOWED_FIELDS = new Set(["kind", "name", "email", "message", "vehicleId", "idempotencyKey", "build"]);
const BUILD_ALLOWED_FIELDS = new Set([
  "vehicleId",
  "gradeId",
  "selections",
  "shareUrl",
  "configurationId",
  "ownerToken",
]);
const OWNER_TOKEN_META_FIELDS = new Set(["present", "configurationId"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]+$/;
const CONFIGURATION_ID = /^[A-Za-z0-9._:-]+$/;

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_VEHICLE_ID_LENGTH = 80;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_SHARE_URL_LENGTH = 2_048;
const MAX_CONFIGURATION_ID_LENGTH = 128;
const MAX_GRADE_ID_LENGTH = 80;

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

function validateShareUrl(value: unknown): string {
  const shareUrl = normalizedString(value, "build.shareUrl", MAX_SHARE_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(shareUrl);
  } catch {
    throw invalidBody(`"build.shareUrl" must be an absolute http(s) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidBody(`"build.shareUrl" must be an absolute http(s) URL.`);
  }
  return shareUrl;
}

function validateOwnerTokenMeta(raw: unknown): LeadOwnerTokenMeta {
  // Plaintext capability tokens must never cross this boundary into CRM handoff.
  if (typeof raw === "string") {
    throw invalidBody(
      `"build.ownerToken" must be metadata ({ present, configurationId? }), not a plaintext token.`,
    );
  }
  const body = requireObject(raw);
  for (const field of Object.keys(body)) {
    if (!OWNER_TOKEN_META_FIELDS.has(field)) {
      throw invalidBody(`Unknown build.ownerToken field "${field}".`);
    }
  }
  if (typeof body.present !== "boolean") {
    throw invalidBody(`"build.ownerToken.present" must be a boolean.`);
  }
  let configurationId: string | undefined;
  if (body.configurationId !== undefined) {
    configurationId = normalizedString(
      body.configurationId,
      "build.ownerToken.configurationId",
      MAX_CONFIGURATION_ID_LENGTH,
    );
    if (!CONFIGURATION_ID.test(configurationId)) {
      throw invalidBody(
        `"build.ownerToken.configurationId" may contain only letters, numbers, period, underscore, colon, and hyphen.`,
      );
    }
  }
  return {
    present: body.present,
    ...(configurationId ? { configurationId } : {}),
  };
}

function validateBuildSnapshot(raw: unknown, topLevelVehicleId?: string): LeadBuildSnapshot {
  const body = requireObject(raw);
  for (const field of Object.keys(body)) {
    if (!BUILD_ALLOWED_FIELDS.has(field)) throw invalidBody(`Unknown build field "${field}".`);
  }

  const vehicleId = normalizedString(body.vehicleId, "build.vehicleId", MAX_VEHICLE_ID_LENGTH, {
    lowercase: true,
  });
  if (topLevelVehicleId && topLevelVehicleId !== vehicleId) {
    throw invalidBody(`"build.vehicleId" must match top-level "vehicleId" when both are provided.`);
  }

  const gradeId = normalizedString(body.gradeId, "build.gradeId", MAX_GRADE_ID_LENGTH);
  const catalogVehicle = getVehicleBySlug(vehicleId);
  if (!catalogVehicle) {
    throw invalidBody(`"build.vehicleId" must identify a vehicle in the verified catalog.`);
  }
  // Reuse configuration validators so CRM never receives invented option ids / grades.
  validateVehicleIdentity(vehicleId, catalogVehicle.year, gradeId);
  const selections = validateSelections(vehicleId, gradeId, body.selections);
  const shareUrl = validateShareUrl(body.shareUrl);

  let configurationId: string | undefined;
  if (body.configurationId !== undefined) {
    configurationId = normalizedString(body.configurationId, "build.configurationId", MAX_CONFIGURATION_ID_LENGTH);
    if (!CONFIGURATION_ID.test(configurationId)) {
      throw invalidBody(
        `"build.configurationId" may contain only letters, numbers, period, underscore, colon, and hyphen.`,
      );
    }
  }

  let ownerToken: LeadOwnerTokenMeta | undefined;
  if (body.ownerToken !== undefined) {
    ownerToken = validateOwnerTokenMeta(body.ownerToken);
  }

  return {
    vehicleId,
    gradeId,
    selections,
    shareUrl,
    ...(configurationId ? { configurationId } : {}),
    ...(ownerToken ? { ownerToken } : {}),
  };
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

  let build: LeadBuildSnapshot | undefined;
  if (body.build !== undefined) {
    build = validateBuildSnapshot(body.build, vehicleId);
    // A build snapshot implies model context; align top-level vehicleId when the client omitted it.
    vehicleId ??= build.vehicleId;
  }

  return {
    kind,
    name,
    email,
    message,
    ...(vehicleId ? { vehicleId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(build ? { build } : {}),
  };
}
