export type LeadKind = "contact" | "model";

/**
 * Canonical persisted lead record. Intentionally narrow: only data required to respond to the
 * inquiry is stored. Request metadata (IP, user agent, analytics ids) does not belong in this
 * domain object and must not be persisted beside customer PII.
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

/** Public request shape accepted by POST /api/v1/leads. */
export interface CreateLeadInput {
  kind: LeadKind;
  name: string;
  email: string;
  message: string;
  vehicleId?: string;
  idempotencyKey?: string;
}

/**
 * Server-normalized lead input. Validation trims user text, lowercases email, and resolves any
 * vehicle id against the repository's verified catalog before this type is produced.
 */
export type ValidatedLeadInput = Readonly<CreateLeadInput>;
