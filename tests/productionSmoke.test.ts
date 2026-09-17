import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { dynamic as vehiclesRouteMode, GET as getVehicles } from "../app/api/v1/vehicles/route";
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: "1", data: [{ slug: "rav4" }], page: 1, pageSize: 1, totalItems: 5, totalPages: 5 }), { status: 200, headers }));

    const result = await runProductionSmoke("https://showroom.example.com/app", { fetchImpl });
    expect(result).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://showroom.example.com/app/api/v1/health", "GET"],
      ["https://showroom.example.com/app/api/v1/vehicles?pageSize=1", "GET"],
    ]);
  });

  it("keeps the Worker catalog route query-aware instead of build-time static", async () => {
    expect(vehiclesRouteMode).toBe("force-dynamic");

    const response = await getVehicles(
      new NextRequest("https://showroom.example.com/api/v1/vehicles?pageSize=1"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ slug: expect.any(String) })],
      page: 1,
      pageSize: 1,
      totalItems: expect.any(Number),
    });

    const legacyParameterResponse = await getVehicles(
      new NextRequest("https://showroom.example.com/api/v1/vehicles?limit=1"),
    );
    expect(legacyParameterResponse.status).toBe(400);
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
