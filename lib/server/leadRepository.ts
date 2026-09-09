import type { Lead, ValidatedLeadInput } from "../types/lead";
import { newId } from "../shared/id";

export interface LeadCreateResult {
  lead: Lead;
  created: boolean;
}

/** Persistence boundary for customer lead intake. */
export interface LeadRepository {
  create(input: ValidatedLeadInput): Promise<LeadCreateResult>;
}

/**
 * Node/Vitest implementation. Production swaps this for D1 from `instrumentation.ts`.
 * Idempotency is intentionally immutable: a reused key returns the first accepted request rather
 * than allowing a retry with changed data to mutate customer PII.
 */
export class InMemoryLeadRepository implements LeadRepository {
  private readonly leads = new Map<string, Lead>();
  private readonly idsByIdempotencyKey = new Map<string, string>();

  async create(input: ValidatedLeadInput): Promise<LeadCreateResult> {
    if (input.idempotencyKey) {
      const existingId = this.idsByIdempotencyKey.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.leads.get(existingId);
        if (existing) return { lead: structuredClone(existing), created: false };
      }
    }

    const lead: Lead = {
      id: newId("lead"),
      kind: input.kind,
      name: input.name,
      email: input.email,
      message: input.message,
      ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
      createdAt: new Date().toISOString(),
    };

    this.leads.set(lead.id, structuredClone(lead));
    if (input.idempotencyKey) this.idsByIdempotencyKey.set(input.idempotencyKey, lead.id);
    return { lead: structuredClone(lead), created: true };
  }

  clear(): void {
    this.leads.clear();
    this.idsByIdempotencyKey.clear();
  }
}

let repository: LeadRepository = new InMemoryLeadRepository();

export function getLeadRepository(): LeadRepository {
  return repository;
}

/** Runtime/test injection point; production binds D1 from `instrumentation.ts`. */
export function setLeadRepository(next: LeadRepository): void {
  repository = next;
}
