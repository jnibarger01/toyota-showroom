import type { SelectionMap } from "./customization";

export type LeadKind = "contact" | "model";

/**
 * Canonical persisted lead record. Intentionally narrow: only data required to respond to the
 * inquiry is stored. Request metadata (IP, user agent, analytics ids) does not belong in this
 * domain object and must not be persisted beside customer PII.
 *
 * Build snapshot fields used for CRM handoff are accepted on create but are not columns on this
 * record — they ride the request into the Worker webhook dispatcher only.
 */
export interface Lead {
  id: string;
  kind: LeadKind;
  name: string;
  email: string;
  message: string;
  vehicleId?: string;
  createdAt: string;
}

/**
 * Owner-token *metadata* for CRM handoff. Never carries the plaintext capability token — only
 * whether the submitter held one and which configuration it applies to.
 */
export interface LeadOwnerTokenMeta {
  present: boolean;
  configurationId?: string;
}

/**
 * Build snapshot attached to a lead submission so a CRM webhook can reconnect the inquiry to the
 * customer's configured vehicle. Validated server-side; never trusted as catalog truth without
 * re-checking option ids.
 */
export interface LeadBuildSnapshot {
  vehicleId: string;
  gradeId: string;
  selections: SelectionMap;
  shareUrl: string;
  configurationId?: string;
  ownerToken?: LeadOwnerTokenMeta;
}

/** Public request shape accepted by POST /api/v1/leads. */
export interface CreateLeadInput {
  kind: LeadKind;
  name: string;
  email: string;
  message: string;
  vehicleId?: string;
  idempotencyKey?: string;
  /** Optional builder context for CRM handoff (vehicle, selections, share URL, owner-token meta). */
  build?: LeadBuildSnapshot;
}

/**
 * Server-normalized lead input. Validation trims user text, lowercases email, and resolves any
 * vehicle id against the repository's verified catalog before this type is produced.
 */
export type ValidatedLeadInput = Readonly<CreateLeadInput>;
