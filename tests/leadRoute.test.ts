import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/v1/leads/route";
import {
  resetCrmWebhookForTests,
  setCrmWebhookEnvForTests,
  setCrmWebhookFetchForTests,
} from "../lib/server/crmWebhook";
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

type LeadResponseBody = {
  data: { id: string; email: string; createdAt: string };
};

type ErrorResponseBody = {
  error: { code: string; status: number; message: string };
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
  resetCrmWebhookForTests();
  setCrmWebhookEnvForTests({}); // default: CRM unset so existing tests stay focused on persistence
});

afterEach(() => {
  resetCrmWebhookForTests();
});

describe("POST /api/v1/leads", () => {
  it("returns 201 only after a lead has been accepted by persistence", async () => {
    const response = await post(JSON.stringify(validLead));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as LeadResponseBody;
    expect(body.data.id).toMatch(/^lead_/);
    expect(body.data.email).toBe("jamie@example.com");
    expect(Number.isNaN(Date.parse(body.data.createdAt))).toBe(false);
  });

  it("returns 200 and the same record for an idempotent replay", async () => {
    const first = await post(JSON.stringify(validLead));
    const replay = await post(JSON.stringify(validLead));

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    const firstBody = (await first.json()) as LeadResponseBody;
    const replayBody = (await replay.json()) as LeadResponseBody;
    expect(replayBody.data).toEqual(firstBody.data);
  });

  it("rejects malformed JSON and semantically invalid bodies", async () => {
    const malformed = await post("{not-json");
    expect(malformed.status).toBe(422);

    const invalid = await post(JSON.stringify({ ...validLead, email: "bad-email" }));
    expect(invalid.status).toBe(422);
    const invalidBody = (await invalid.json()) as ErrorResponseBody;
    expect(invalidBody.error.code).toBe("invalid_body");
  });

  it("rejects request bodies larger than the public lead limit before persistence", async () => {
    const oversized = await post(JSON.stringify({ ...validLead, message: "x".repeat(30_000) }));
    expect(oversized.status).toBe(413);
    const body = (await oversized.json()) as ErrorResponseBody;
    expect(body.error.code).toBe("payload_too_large");
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

  it("hands the build snapshot to the CRM webhook when configured", async () => {
    setCrmWebhookEnvForTests({
      url: "https://crm.example.test/hooks/leads",
      secret: "route-secret",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    setCrmWebhookFetchForTests(fetchMock);

    const body = {
      ...validLead,
      kind: "model",
      vehicleId: "4runner",
      build: {
        vehicleId: "4runner",
        gradeId: "trd-pro",
        selections: { paint: ["paint-218-blueprint"] },
        shareUrl: "https://example.test/4runner/?c=abc",
        configurationId: "cfg_1",
        ownerToken: { present: true, configurationId: "cfg_1" },
      },
    };
    const response = await post(JSON.stringify(body));
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer route-secret" });
    const payload = JSON.parse(String(init.body)) as {
      vehicle: unknown;
      selections: unknown;
      shareUrl: string;
      ownerToken: unknown;
    };
    expect(payload.vehicle).toEqual({ id: "4runner", gradeId: "trd-pro" });
    expect(payload.selections).toEqual({ paint: ["paint-218-blueprint"] });
    expect(payload.shareUrl).toBe("https://example.test/4runner/?c=abc");
    expect(payload.ownerToken).toEqual({ present: true, configurationId: "cfg_1" });
    expect(String(init.body)).not.toContain("route-secret");
  });

  it("does not report lead success when a configured CRM webhook fails", async () => {
    setCrmWebhookEnvForTests({ url: "https://crm.example.test/hooks/leads" });
    setCrmWebhookFetchForTests(vi.fn().mockResolvedValue(new Response("fail", { status: 503 })));

    const response = await post(JSON.stringify(validLead));
    expect(response.status).toBe(502);
    const body = (await response.json()) as ErrorResponseBody;
    expect(body.error.code).toBe("crm_handoff_failed");
  });

  it("returns a fake 201 and does not persist when the honeypot is filled", async () => {
    const createSpy = vi.spyOn(repository, "create");
    const response = await post(
      JSON.stringify({ ...validLead, companyWebsite: "https://spam.example" }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string; dropped?: boolean } };
    expect(body.data.dropped).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });
});
