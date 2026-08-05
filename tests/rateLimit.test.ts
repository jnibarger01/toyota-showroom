import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { enforceConfigWriteRateLimit, type RateLimitBinding } from "../lib/server/rateLimit";
import { ApiError } from "../lib/api/errors";

function requestFrom(ip: string): Request {
  return new Request("https://example.com/api/v1/configurations", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  });
}

describe("enforceConfigWriteRateLimit (fake binding)", () => {
  function fakeLimiter(allow: boolean): RateLimitBinding {
    return { limit: async () => ({ success: allow }) };
  }

  it("allows the request through when the limiter reports success", async () => {
    await expect(enforceConfigWriteRateLimit(requestFrom("1.2.3.4"), fakeLimiter(true))).resolves.toBeUndefined();
  });

  it("throws a 429 ApiError when the limiter reports failure", async () => {
    await expect(enforceConfigWriteRateLimit(requestFrom("1.2.3.4"), fakeLimiter(false))).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });

  it("throws an actual ApiError instance, not a generic Error", async () => {
    await expect(enforceConfigWriteRateLimit(requestFrom("1.2.3.4"), fakeLimiter(false))).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("does not throw when no limiter is configured (Node dev, or the ambient lookup finding nothing)", async () => {
    await expect(enforceConfigWriteRateLimit(requestFrom("1.2.3.4"), null)).resolves.toBeUndefined();
  });

  it("keys the fake limiter by the cf-connecting-ip header, falling back to \"unknown\"", async () => {
    const seenKeys: string[] = [];
    const recordingLimiter: RateLimitBinding = {
      limit: async ({ key }) => {
        seenKeys.push(key);
        return { success: true };
      },
    };

    await enforceConfigWriteRateLimit(requestFrom("9.9.9.9"), recordingLimiter);
    await enforceConfigWriteRateLimit(new Request("https://example.com/api/v1/configurations"), recordingLimiter);

    expect(seenKeys).toEqual(["9.9.9.9", "unknown"]);
  });
});

/**
 * Same real-local-D1-style verification as tests/d1ConfigurationRepository.test.ts: gets an actual
 * Miniflare-backed rate limiter via wrangler's `getPlatformProxy()` (no Cloudflare account needed —
 * confirmed working fully offline) and runs `enforceConfigWriteRateLimit` against it for real,
 * rather than trusting that the fake-binding tests above generalize to Cloudflare's actual behavior.
 */
describe("enforceConfigWriteRateLimit (real local rate limiter)", () => {
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ CONFIG_WRITE_LIMITER: RateLimitBinding }>>>;

  beforeAll(async () => {
    proxy = await getPlatformProxy<{ CONFIG_WRITE_LIMITER: RateLimitBinding }>({
      configPath: path.resolve(import.meta.dirname, "../wrangler.jsonc"),
    });
  });

  afterAll(async () => {
    await proxy?.dispose();
  });

  it("allows requests up to wrangler.jsonc's configured limit, then blocks", async () => {
    // A fresh key per test run avoids interference from a previous run's window (the limiter's
    // state persists in `.wrangler/state/`, same as the D1 test's database file).
    const key = `rate-limit-test-${crypto.randomUUID()}`;
    const request = requestFrom(key);

    // wrangler.jsonc: { "simple": { "limit": 30, "period": 60 } }
    for (let i = 0; i < 30; i++) {
      await expect(enforceConfigWriteRateLimit(request, proxy.env.CONFIG_WRITE_LIMITER)).resolves.toBeUndefined();
    }

    await expect(enforceConfigWriteRateLimit(request, proxy.env.CONFIG_WRITE_LIMITER)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });

  it("tracks distinct client IPs independently", async () => {
    const keyA = `rate-limit-isolation-a-${crypto.randomUUID()}`;
    const keyB = `rate-limit-isolation-b-${crypto.randomUUID()}`;

    for (let i = 0; i < 30; i++) {
      await enforceConfigWriteRateLimit(requestFrom(keyA), proxy.env.CONFIG_WRITE_LIMITER);
    }
    await expect(
      enforceConfigWriteRateLimit(requestFrom(keyA), proxy.env.CONFIG_WRITE_LIMITER),
    ).rejects.toMatchObject({ status: 429 });

    // A different IP was never rate limited, so it's still allowed.
    await expect(
      enforceConfigWriteRateLimit(requestFrom(keyB), proxy.env.CONFIG_WRITE_LIMITER),
    ).resolves.toBeUndefined();
  });
});
