import { eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { leads } from "../../db/schema";
import type { Lead, ValidatedLeadInput } from "../types/lead";
import { newId } from "../shared/id";
import type { LeadCreateResult, LeadRepository } from "./leadRepository";

/**
 * Durable production lead repository.
 *
 * Idempotency is enforced by D1's unique index on `idempotency_key`, not by a read-before-write
 * check. The insert therefore remains safe when two retries race in different Worker isolates:
 * exactly one insert can win; the loser reads and returns the already-accepted row.
 */
export class D1LeadRepository implements LeadRepository {
  private readonly db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async create(input: ValidatedLeadInput): Promise<LeadCreateResult> {
    const row = {
      id: newId("lead"),
      kind: input.kind,
      name: input.name,
      email: input.email,
      message: input.message,
      vehicleId: input.vehicleId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: new Date(),
    };

    const insert = this.db.insert(leads).values(row);
    const result = input.idempotencyKey
      ? await insert.onConflictDoNothing({ target: leads.idempotencyKey }).run()
      : await insert.run();

    if (result.meta.changes > 0) {
      return { lead: this.toLead(row), created: true };
    }

    // A no-op insert can only be an idempotency conflict because `id` is freshly generated. Read
    // the winner after the unique-index decision rather than accepting caller data from the retry.
    if (!input.idempotencyKey) {
      throw new Error("Lead insert was not persisted.");
    }

    const existingRows = await this.db
      .select()
      .from(leads)
      .where(eq(leads.idempotencyKey, input.idempotencyKey))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      // Fail closed: a conflict with no readable winner indicates an unexpected persistence fault.
      throw new Error("Lead idempotency conflict could not be resolved from persistence.");
    }

    return { lead: this.toLead(existing), created: false };
  }

  private toLead(row: typeof leads.$inferSelect | typeof leads.$inferInsert): Lead {
    const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    return {
      id: row.id,
      kind: row.kind as Lead["kind"],
      name: row.name,
      email: row.email,
      message: row.message,
      ...(row.vehicleId ? { vehicleId: row.vehicleId } : {}),
      createdAt: createdAt.toISOString(),
    };
  }
}
