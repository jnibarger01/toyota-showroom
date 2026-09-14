import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/errors";
import {
  buildCrmLeadWebhookPayload,
  CRM_WEBHOOK_SECRET_ENV,
  CRM_WEBHOOK_URL_ENV,
  deliverLeadToCrm,
  resetCrmWebhookForTests,
  setCrmWebhookEnvForTests,
  setCrmWebhookFetchForTests,
} from "../lib/server/crmWebhook";
import type { Lead, LeadBuildSnapshot } from "../lib/types/lead";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const lead: Lead = {
  id: "lead_test123",
  kind: "model",
  name: "Jamie Customer",
  email: "jamie@example.com",
  message: "Please contact me about this build.",
  vehicleId: "4runner",
  createdAt: "2026-09-14T12:00:00.000Z",
};

const build: LeadBuildSnapshot = {
  vehicleId: "4runner",
  gradeId: "trd-pro",
  selections: { paint: ["paint-218-blueprint"] },
  shareUrl: "https://jnibarger01.github.io/toyota-showroom/4runner/?c=abc",
  configurationId: "cfg_owner1",
  ownerToken: { present: true, configurationId: "cfg_owner1" },
};

afterEach(() => {
  resetCrmWebhookForTests();
});

describe("buildCrmLeadWebhookPayload", () => {
  it("includes vehicle, selections, share URL, and owner-token metadata", () => {
    const payload = buildCrmLeadWebhookPayload(lead, build);
    expect(payload).toEqual({
      event: "lead.created",
      source: "toyota-showroom",
      lead: {
        id: "lead_test123",
        kind: "model",
        name: "Jamie Customer",
        email: "jamie@example.com",
        message: "Please contact me about this build.",
        vehicleId: "4runner",
        createdAt: "2026-09-14T12:00:00.000Z",
      },
      vehicle: { id: "4runner", gradeId: "trd-pro" },
      selections: { paint: ["paint-218-blueprint"] },
      shareUrl: "https://jnibarger01.github.io/toyota-showroom/4runner/?c=abc",
      ownerToken: { present: true, configurationId: "cfg_owner1" },
    });
  });

  it("never embeds webhook secrets in the JSON payload", () => {
    const secret = "super-secret-crm-token";
    const payload = buildCrmLeadWebhookPayload(lead, build);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(CRM_WEBHOOK_SECRET_ENV);
    expect(serialized).not.toContain(CRM_WEBHOOK_URL_ENV);
    expect(payload).not.toHaveProperty("secret");
    expect(payload).not.toHaveProperty("authorization");
    expect(payload.ownerToken).not.toHaveProperty("token");
  });
});

describe("deliverLeadToCrm", () => {
  it("skips delivery when CRM_WEBHOOK_URL is unset", async () => {
    setCrmWebhookEnvForTests({});
    const fetchMock = vi.fn();
    setCrmWebhookFetchForTests(fetchMock);

    await expect(deliverLeadToCrm(lead, build)).resolves.toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the agnostic payload with the Worker secret only as Authorization", async () => {
    setCrmWebhookEnvForTests({
      url: "https://crm.example.test/hooks/leads",
      secret: "worker-only-secret",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    setCrmWebhookFetchForTests(fetchMock);

    await expect(deliverLeadToCrm(lead, build)).resolves.toEqual({
      status: "delivered",
      statusCode: 204,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://crm.example.test/hooks/leads");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer worker-only-secret",
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.shareUrl).toBe(build.shareUrl);
    expect(body.selections).toEqual(build.selections);
    expect(body.vehicle).toEqual({ id: "4runner", gradeId: "trd-pro" });
    expect(JSON.stringify(body)).not.toContain("worker-only-secret");
  });

  it("fails closed when the configured webhook rejects the handoff", async () => {
    setCrmWebhookEnvForTests({ url: "https://crm.example.test/hooks/leads", secret: "s" });
    setCrmWebhookFetchForTests(vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    await expect(deliverLeadToCrm(lead, build)).rejects.toMatchObject({
      status: 502,
      code: "crm_handoff_failed",
    } satisfies Partial<ApiError>);
  });

  it("fails closed on network errors so local lead UX cannot fake CRM success", async () => {
    setCrmWebhookEnvForTests({ url: "https://crm.example.test/hooks/leads" });
    setCrmWebhookFetchForTests(vi.fn().mockRejectedValue(new Error("dns failed")));

    await expect(deliverLeadToCrm(lead, build)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("CRM secret non-leak (client surface)", () => {
  it("keeps CRM_WEBHOOK_* out of client lead modules and the lead form", () => {
    const clientPaths = [
      "app/components/ValidatedLeadForm.tsx",
      "lib/api/leads.ts",
      "lib/types/lead.ts",
    ];
    for (const relative of clientPaths) {
      const source = readFileSync(resolve(process.cwd(), relative), "utf8");
      expect(source, relative).not.toContain(CRM_WEBHOOK_URL_ENV);
      expect(source, relative).not.toContain(CRM_WEBHOOK_SECRET_ENV);
      expect(source, relative).not.toMatch(/Bearer\s+/);
    }
  });
});
