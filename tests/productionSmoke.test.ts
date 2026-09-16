import { describe, expect, it, vi } from "vitest";
import { normalizeBaseUrl, runProductionSmoke } from "../scripts/production-smoke";

const headers = {
  "content-type": "application/json",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
};

describe("production smoke harness", () => {
  it("rejects insecure remote targets and credential-bearing URLs", () => {
    expect(() => normalizeBaseUrl("http://example.com")).toThrow(/HTTPS/);
    expect(() => normalizeBaseUrl("https://user:pass@example.com")).toThrow(/credentials/);
    expect(normalizeBaseUrl("http://localhost:3000/demo").href).toBe("http://localhost:3000/demo/");
  });

  it("validates health and a bounded catalog query without writes", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", schemaVersion: "1", vehicleCount: 5, timestamp: new Date().toISOString() }), { status: 200, headers }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: "1", data: [{ slug: "rav4" }], pagination: { total: 5 } }), { status: 200, headers }));

    const result = await runProductionSmoke("https://showroom.example.com/app", { fetchImpl });
    expect(result).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://showroom.example.com/app/api/v1/health", "GET"],
      ["https://showroom.example.com/app/api/v1/vehicles?limit=1", "GET"],
    ]);
  });

  it("fails closed on contract or security-header drift", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", schemaVersion: "1", vehicleCount: 5, timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { "content-type": "application/json", "x-content-type-options": "nosniff" },
      }),
    );
    await expect(runProductionSmoke("https://showroom.example.com", { fetchImpl })).rejects.toThrow(/Content-Security-Policy/);
  });
});
