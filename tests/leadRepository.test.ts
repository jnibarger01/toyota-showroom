import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryLeadRepository } from "../lib/server/leadRepository";
import { validateCreateLead } from "../lib/validation/lead";

const repository = new InMemoryLeadRepository();

beforeEach(() => repository.clear());

function contact(key?: string) {
  return validateCreateLead({
    kind: "contact",
    name: "Jamie Customer",
    email: "jamie@example.com",
    message: "Please contact me.",
    ...(key ? { idempotencyKey: key } : {}),
  });
}

describe("InMemoryLeadRepository", () => {
  it("creates a canonical persisted lead record", async () => {
    const result = await repository.create(contact("lead-key-1"));

    expect(result.created).toBe(true);
    expect(result.lead.id).toMatch(/^lead_/);
    expect(result.lead).toMatchObject({
      kind: "contact",
      name: "Jamie Customer",
      email: "jamie@example.com",
      message: "Please contact me.",
    });
    expect(Number.isNaN(Date.parse(result.lead.createdAt))).toBe(false);
    expect(result.lead).not.toHaveProperty("idempotencyKey");
  });

  it("returns the existing record for an idempotent replay", async () => {
    const first = await repository.create(contact("same-key"));
    const replay = await repository.create(contact("same-key"));

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.lead).toEqual(first.lead);
  });

  it("creates independent records when no idempotency key is supplied", async () => {
    const first = await repository.create(contact());
    const second = await repository.create(contact());

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.lead.id).not.toBe(first.lead.id);
  });

  it("does not let a replay mutate the already-accepted lead", async () => {
    const first = await repository.create(contact("immutable-key"));
    const replay = await repository.create(
      validateCreateLead({
        kind: "contact",
        name: "Changed Name",
        email: "changed@example.com",
        message: "Changed content.",
        idempotencyKey: "immutable-key",
      }),
    );

    expect(replay.created).toBe(false);
    expect(replay.lead).toEqual(first.lead);
  });
});
