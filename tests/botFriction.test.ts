import { afterEach, describe, expect, it } from "vitest";
import {
  TURNSTILE_RESPONSE_HEADER,
  enforceCreateBotFriction,
  isBotFrictionEnabled,
  resetBotFrictionForTests,
  setBotFrictionEnvForTests,
  setBotFrictionFetchForTests,
  turnstileTokenFrom,
  verifyTurnstileToken,
} from "../lib/server/botFriction";

afterEach(() => {
  resetBotFrictionForTests();
});

describe("isBotFrictionEnabled", () => {
  it("is off when no secret is configured", () => {
    expect(isBotFrictionEnabled({})).toBe(false);
    expect(isBotFrictionEnabled({ secret: undefined })).toBe(false);
  });

  it("is on when a secret is present", () => {
    expect(isBotFrictionEnabled({ secret: "test-secret" })).toBe(true);
  });

  it("honours an explicit off flag even with a secret", () => {
    expect(isBotFrictionEnabled({ secret: "test-secret", enabled: false })).toBe(false);
  });
});

describe("turnstileTokenFrom", () => {
  it("reads the cf-turnstile-response header", () => {
    const request = new Request("https://example.com/api/v1/configurations", {
      method: "POST",
      headers: { [TURNSTILE_RESPONSE_HEADER]: "tok-abc" },
    });
    expect(turnstileTokenFrom(request)).toBe("tok-abc");
  });

  it("returns null when the header is absent", () => {
    expect(turnstileTokenFrom(new Request("https://example.com/"))).toBeNull();
  });
});

describe("verifyTurnstileToken", () => {
  it("posts form-encoded secret + response to siteverify", async () => {
    const seen: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const result = await verifyTurnstileToken("tok", "sec", "1.2.3.4", fetchImpl);
    expect(result.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(seen[0].body).toContain("secret=sec");
    expect(seen[0].body).toContain("response=tok");
    expect(seen[0].body).toContain("remoteip=1.2.3.4");
  });
});

describe("enforceCreateBotFriction", () => {
  it("is a no-op when Turnstile is not configured", async () => {
    setBotFrictionEnvForTests({});
    await expect(
      enforceCreateBotFriction(new Request("https://example.com/api/v1/configurations", { method: "POST" })),
    ).resolves.toBeUndefined();
  });

  it("rejects with invalid_body when enabled but the token header is missing", async () => {
    setBotFrictionEnvForTests({ secret: "test-secret" });
    await expect(
      enforceCreateBotFriction(new Request("https://example.com/api/v1/configurations", { method: "POST" })),
    ).rejects.toMatchObject({ status: 422, code: "invalid_body" });
  });

  it("rejects with forbidden when siteverify reports failure", async () => {
    setBotFrictionEnvForTests({ secret: "test-secret" });
    setBotFrictionFetchForTests(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));

    const request = new Request("https://example.com/api/v1/configurations", {
      method: "POST",
      headers: {
        [TURNSTILE_RESPONSE_HEADER]: "bad-tok",
        "cf-connecting-ip": "203.0.113.10",
      },
    });
    await expect(enforceCreateBotFriction(request)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });

  it("allows the request when siteverify reports success", async () => {
    setBotFrictionEnvForTests({ secret: "test-secret" });
    setBotFrictionFetchForTests(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));

    const request = new Request("https://example.com/api/v1/configurations", {
      method: "POST",
      headers: {
        [TURNSTILE_RESPONSE_HEADER]: "good-tok",
        "cf-connecting-ip": "203.0.113.10",
      },
    });
    await expect(enforceCreateBotFriction(request)).resolves.toBeUndefined();
  });

  it("stays off when TURNSTILE_ENABLED explicitly disables friction", async () => {
    setBotFrictionEnvForTests({ secret: "test-secret", enabled: false });
    await expect(
      enforceCreateBotFriction(new Request("https://example.com/api/v1/configurations", { method: "POST" })),
    ).resolves.toBeUndefined();
  });
});
