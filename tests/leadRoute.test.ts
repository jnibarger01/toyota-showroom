import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/v1/leads/route";
import {
  InMemoryLeadRepository,
  setLeadRepository,
  type LeadRepository,
} from "../lib/server/leadRepository";

const repository = new InMemoryLeadRepository();
setLeadRepository(repository);

const validLead = {
  kind: "contact",
  name: "Jamie Customer",
  email: "jamie@example.com",
  message: "Please contact me about a Toyota.",
  idempotencyKey: "route-test-key",
};

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new NextRequest("https://example.test/api/v1/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    }),
  );
}

beforeEach(() => {
  repository.clear();
  setLeadRepository(repository);
});

describe("POST /api/v1/leads", () => {
  it("returns 201 only after a lead has been accepted by persistence", async () => {
    const response = await post(JSON.stringify(validLead));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as { data: { id: string; email: string; createdAt: string } };
    expect(body.data.id).toMatch(/^lead_/);
    expect(body.data.email).toBe("jamie@example.com");
    expect(Number.isNaN(Date.parse(body.data.createdAt))).toBe(false);
  });

  it("returns 200 and the same record for an idempotent replay", async () => {
    const first = await post(JSON.stringify(validLead));
    const replay = await post(JSON.stringify(validLead));

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((await replay.json()).data).toEqual((await first.json()).data);
  });

  it("rejects malformed JSON and semantically invalid bodies", async () => {
    const malformed = await post("{not-json");
    expect(malformed.status).toBe(422);

    const invalid = await post(JSON.stringify({ ...validLead, email: "bad-email" }));
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("invalid_body");
  });

  it("rejects request bodies larger than the public lead limit before persistence", async () => {
    const oversized = await post(JSON.stringify({ ...validLead, message: "x".repeat(20_000) }));
    expect(oversized.status).toBe(413);
  });

  it("never converts a persistence failure into a successful response", async () => {
    const failingRepository: LeadRepository = {
      async create() {
        throw new Error("database unavailable");
      },
    };
    setLeadRepository(failingRepository);

    await expect(post(JSON.stringify(validLead))).rejects.toThrow(/database unavailable/i);
  });
});
