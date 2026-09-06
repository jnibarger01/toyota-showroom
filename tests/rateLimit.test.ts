import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import {
  enforceCatalogReadRateLimit,
  enforceConfigWriteRateLimit,
  type RateLimitBinding,
} from "../lib/server/rateLimit";
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

  it("keys the limiter by cf-connecting-ip", async () => {
    const seenKeys: string[] = [];
    const recordingLimiter: RateLimitBinding = {
      limit: async ({ key }) => {
        seenKeys.push(key);
        return { success: true };
      },
    };

    await enforceConfigWriteRateLimit(requestFrom("9.9.9.9"), recordingLimiter);
    expect(seenKeys).toEqual(["9.9.9.9"]);
  });

  it("skips the limiter entirely when the caller cannot be identified", async () => {
    // This used to key on the literal string "unknown", which did not lose rate limiting when the
    // header went missing — it put *every* unidentifiable caller in one shared 30-per-minute
    // bucket, so a header problem became an outage for all of them at once. Failing open loses
    // enforcement only in a configuration that should not occur behind Cloudflare, and it cannot
    // take legitimate users down with it.
    const seenKeys: string[] = [];
    const recordingLimiter: RateLimitBinding = {
      limit: async ({ key }) => {
        seenKeys.push(key);
        return { success: false }; // Would reject if it were ever consulted.
      },
    };

    await expect(
      enforceConfigWriteRateLimit(new Request("https://example.com/api/v1/configurations"), recordingLimiter),
    ).resolves.toBeUndefined();
    expect(seenKeys).toEqual([]);
  });

  it("never keys on a client-supplied forwarding header", async () => {
    // x-forwarded-for and x-real-ip are attacker-controlled: a fallback to either would let a
    // caller rotate the value to evade the limit while still metering honest traffic. Only
    // cf-connecting-ip, which the edge sets, is trusted.
    const seenKeys: string[] = [];
    const recordingLimiter: RateLimitBinding = {
      limit: async ({ key }) => {
        seenKeys.push(key);
        return { success: true };
      },
    };

    const spoofed = new Request("https://example.com/api/v1/configurations", {
      method: "POST",
      headers: { "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" },
    });
    await enforceCatalogReadRateLimit(spoofed, recordingLimiter);

    expect(seenKeys).toEqual([]);
  });
});

describe("enforceCatalogReadRateLimit (fake binding)", () => {
  const catalogRequest = (ip: string) =>
    new Request("https://example.com/api/v1/vehicles", { headers: { "cf-connecting-ip": ip } });

  it("allows reads through when under the limit", async () => {
    const limiter: RateLimitBinding = { limit: async () => ({ success: true }) };
    await expect(enforceCatalogReadRateLimit(catalogRequest("1.2.3.4"), limiter)).resolves.toBeUndefined();
  });

  it("throws a 429 once the read limit is exceeded", async () => {
    // The catalog routes were entirely unmetered: each serialises the full vehicle dataset, and
    // /api/v1/vehicles filters and paginates it per request, with no token and no body to reject
    // early. An unbounded caller could keep the Worker busy indefinitely at no cost.
    const limiter: RateLimitBinding = { limit: async () => ({ success: false }) };
    await expect(enforceCatalogReadRateLimit(catalogRequest("1.2.3.4"), limiter)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });

  it("serves reads unmetered when no binding is present", async () => {
    // Keeps `npm run dev`, vitest, and the static export working with no configuration at all.
    await expect(enforceCatalogReadRateLimit(catalogRequest("1.2.3.4"), null)).resolves.toBeUndefined();
  });

  it("meters reads separately from writes", async () => {
    // Sharing one budget would let a page load's own catalog fetches consume the allowance a user
    // needs to save their build.
    const writeKeys: string[] = [];
    const readKeys: string[] = [];
    const writeLimiter: RateLimitBinding = {
      limit: async ({ key }) => (writeKeys.push(key), { success: true }),
    };
    const readLimiter: RateLimitBinding = {
      limit: async ({ key }) => (readKeys.push(key), { success: true }),
    };

    await enforceConfigWriteRateLimit(requestFrom("5.5.5.5"), writeLimiter);
    await enforceCatalogReadRateLimit(catalogRequest("5.5.5.5"), readLimiter);

    expect(writeKeys).toEqual(["5.5.5.5"]);
    expect(readKeys).toEqual(["5.5.5.5"]);
  });
});

/**
 * Same real-local-D1-style verification as tests/d1ConfigurationRepository.test.ts: gets an actual
 * Miniflare-backed rate limiter via wrangler's `getPlatformProxy()` (no Cloudflare account needed —
 * confirmed working fully offline) and runs `enforceConfigWriteRateLimit` against it for real,
 * rather than trusting that the fake-binding tests above generalize to Cloudflare's actual behavior.
 */
/**
 * Miniflare state directory, private to this test file.
 *
 * `getPlatformProxy` defaults to `.wrangler/state/v3`, shared with wrangler and — critically —
 * with every other test file that calls it. Vitest runs files in parallel workers, so this file and
 * `tests/d1ConfigurationRepository.test.ts` were starting two Miniflare instances against the same SQLite database, and CI
 * caught the race workerd reports as:
 *
 *     Fatal uncaught kj::Exception: workerd/util/sqlite.c++: database is locked: SQLITE_BUSY
 *
 * Whichever instance loses the lock fails to start at all, taking its whole suite with it. It is
 * timing-dependent — it never reproduced locally across repeated runs and only surfaced on a
 * loaded CI runner — which is exactly why it needs a structural fix rather than a retry.
 *
 * A private path removes the contention instead of hiding it: both files still start a real
 * Miniflare and still exercise real bindings, they simply no longer share one lock.
 */
const MINIFLARE_STATE_DIR = path.resolve(import.meta.dirname, "../.wrangler/state/test-rate-limit");

describe("enforceConfigWriteRateLimit (real local rate limiter)", () => {
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ CONFIG_WRITE_LIMITER: RateLimitBinding }>>>;

  beforeAll(async () => {
    proxy = await getPlatformProxy<{ CONFIG_WRITE_LIMITER: RateLimitBinding }>({
      configPath: path.resolve(import.meta.dirname, "../wrangler.jsonc"),
      persist: { path: MINIFLARE_STATE_DIR },
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
