import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordRequest } from "../lib/server/telemetry";

/**
 * Telemetry has one hard requirement that outranks everything it collects: it must never turn a
 * working request into a failing one. These tests are mostly about that, not about the data.
 */

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("recordRequest", () => {
  it("emits one parseable JSON line per request", async () => {
    // One object per line is what makes this greppable in `wrangler tail` and parseable by a log
    // pipeline without a custom decoder.
    await recordRequest({ route: "/api/v1/vehicles", method: "GET", status: 200, durationMs: 12 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({
      type: "api_request",
      route: "/api/v1/vehicles",
      method: "GET",
      status: 200,
      durationMs: 12,
    });
  });

  it("carries the error code on failures", async () => {
    await recordRequest({
      route: "/api/v1/configurations/:id",
      method: "PATCH",
      status: 403,
      durationMs: 4,
      errorCode: "forbidden",
    });

    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.errorCode).toBe("forbidden");
  });

  it("never rejects, even when the sink throws", async () => {
    // Called from the response path of every route. A rejection here would convert a successful
    // request into a 500 — strictly worse than having no telemetry.
    logSpy.mockImplementation(() => {
      throw new Error("log pipeline exploded");
    });

    await expect(
      recordRequest({ route: "/api/v1/health", method: "GET", status: 200, durationMs: 1 }),
    ).resolves.toBeUndefined();
    // Swallowed, but not silently: a telemetry pipeline that has quietly stopped working looks
    // exactly like a healthy system with no traffic.
    expect(warnSpy).toHaveBeenCalled();
  });

  it("records no request body, owner token, or query string", async () => {
    // The field set is deliberately closed. Telemetry is the classic way secrets reach a log
    // aggregator with weaker access controls than the database they came from.
    await recordRequest({
      route: "/api/v1/configurations/:id",
      method: "PATCH",
      status: 200,
      durationMs: 8,
    });

    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(Object.keys(parsed).sort()).toEqual([
      "durationMs",
      "method",
      "route",
      "status",
      "type",
    ]);
  });

  it("logs the route pattern rather than a concrete id", async () => {
    // A concrete id makes this a high-cardinality field no aggregation can group by, and puts
    // user-generated identifiers in logs for no analytical gain. Asserted as a property of the
    // value the caller passes, which is why routes pass their pattern explicitly.
    await recordRequest({
      route: "/api/v1/configurations/:id",
      method: "GET",
      status: 200,
      durationMs: 3,
    });

    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.route).not.toMatch(/cfg_/);
    expect(parsed.route).toContain(":id");
  });
});
