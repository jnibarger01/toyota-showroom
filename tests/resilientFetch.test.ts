import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderUnavailableError, resetProviderCircuitsForTests, resilientFetch } from "../lib/api/resilientFetch";

describe("resilientFetch", () => {
  beforeEach(() => {
    resetProviderCircuitsForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries idempotent requests after a transient provider failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = resilientFetch("https://provider.example/catalog", {}, { baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not replay non-idempotent writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resilientFetch("https://provider.example/config", { method: "POST" }))
      .rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the circuit after repeated exhausted requests", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const options = { maxRetries: 0, circuitFailureThreshold: 2 };

    await expect(resilientFetch("https://provider.example/a", {}, options)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(resilientFetch("https://provider.example/b", {}, options)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(resilientFetch("https://provider.example/c", {}, options)).rejects.toThrow("circuit is open");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts requests that exceed the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));

    const pending = resilientFetch("https://provider.example/slow", {}, { timeoutMs: 25, maxRetries: 0 });
    const rejection = expect(pending).rejects.toBeInstanceOf(ProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });
});
