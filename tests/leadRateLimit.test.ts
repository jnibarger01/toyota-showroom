import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import { enforceLeadWriteRateLimit, type RateLimitBinding } from "../lib/server/rateLimit";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/v1/leads", { method: "POST", headers });
}

describe("enforceLeadWriteRateLimit", () => {
  it("allows an identified caller when the dedicated limiter accepts it", async () => {
    const seen: string[] = [];
    const limiter: RateLimitBinding = {
      limit: async ({ key }) => {
        seen.push(key);
        return { success: true };
      },
    };

    await expect(
      enforceLeadWriteRateLimit(request({ "cf-connecting-ip": "203.0.113.8" }), limiter),
    ).resolves.toBeUndefined();
    expect(seen).toEqual(["203.0.113.8"]);
  });

  it("rejects an over-limit caller with the shared 429 ApiError", async () => {
    const limiter: RateLimitBinding = { limit: async () => ({ success: false }) };

    await expect(
      enforceLeadWriteRateLimit(request({ "cf-connecting-ip": "203.0.113.9" }), limiter),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    await expect(
      enforceLeadWriteRateLimit(request({ "cf-connecting-ip": "203.0.113.9" }), limiter),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("does not trust forwarding headers as a substitute for Cloudflare's edge-verified IP", async () => {
    const seen: string[] = [];
    const limiter: RateLimitBinding = {
      limit: async ({ key }) => {
        seen.push(key);
        return { success: false };
      },
    };

    await expect(
      enforceLeadWriteRateLimit(request({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }), limiter),
    ).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("is a no-op when the Cloudflare binding is absent in local/test environments", async () => {
    await expect(
      enforceLeadWriteRateLimit(request({ "cf-connecting-ip": "203.0.113.10" }), null),
    ).resolves.toBeUndefined();
  });
});
