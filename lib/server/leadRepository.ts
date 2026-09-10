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
 * Explicit test-only/local-fixture implementation. It is never the ambient runtime default because
 * customer contact data must not appear accepted when durable persistence is unavailable.
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

/** Default authority: reject writes until the runtime explicitly installs durable persistence. */
export class UnavailableLeadRepository implements LeadRepository {
  async create(_input: ValidatedLeadInput): Promise<LeadCreateResult> {
    throw new Error("Lead persistence is unavailable; the request was not accepted.");
  }
}

let repository: LeadRepository = new UnavailableLeadRepository();

export function getLeadRepository(): LeadRepository {
  return repository;
}

/** Runtime/test injection point; production binds D1 from `instrumentation.ts`. */
export function setLeadRepository(next: LeadRepository): void {
  repository = next;
}
