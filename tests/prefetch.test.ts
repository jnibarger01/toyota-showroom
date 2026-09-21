import { describe, expect, it, vi } from "vitest";
import { createPrefetchScheduler, prefetchBudgetForTier } from "../lib/three/prefetch";

/**
 * The scheduler's whole value is in what it *refuses* to do, so most of these assert non-events.
 * `scheduleIdle` is injected and run synchronously here, which turns the idle queue into ordinary
 * control flow — the policy is what is under test, not `requestIdleCallback`.
 */
const immediateIdle = (callback: () => void) => {
  callback();
  return () => {};
};

function make(overrides: Partial<Parameters<typeof createPrefetchScheduler>[0]> = {}) {
  const load = vi.fn(async () => true);
  const scheduler = createPrefetchScheduler({
    load,
    ids: ["a", "b", "c"],
    tier: () => "high",
    scheduleIdle: immediateIdle,
    ...overrides,
  });
  return { scheduler, load };
}

describe("createPrefetchScheduler", () => {
  it("does nothing until start() — bandwidth before first paint delays the vehicle itself", async () => {
    const { load } = make();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });

  it("warms every id once start() is called", async () => {
    const { scheduler, load } = make();
    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(scheduler.completed()).toEqual(["a", "b", "c"]);
  });

  it("is sequential, so a queue cannot saturate the connection", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const load = vi.fn(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return true;
    });
    const scheduler = createPrefetchScheduler({ load, ids: ["a", "b", "c"], tier: () => "high", scheduleIdle: immediateIdle });

    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(maxConcurrent).toBe(1);
  });

  it("is disabled on the low tier", async () => {
    const { scheduler, load } = make({ tier: () => "low" });
    scheduler.start();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });

  it("is disabled under Save-Data, which quality.ts already honours when picking a tier", async () => {
    const { scheduler, load } = make({ saveData: true });
    scheduler.start();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });

  it("skips while suspended rather than spending data on a page nobody is looking at", async () => {
    let suspended = true;
    const { scheduler, load } = make({ isSuspended: () => suspended });

    scheduler.start();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();

    // Resuming lets the queue drain; the id was never consumed while suspended.
    suspended = false;
    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  });

  it("stops fetching when the tier drops after construction", async () => {
    let tier: "high" | "low" = "high";
    const load = vi.fn(async () => true);
    const scheduler = createPrefetchScheduler({
      load,
      ids: ["a", "b", "c"],
      tier: () => tier,
      scheduleIdle: (callback) => {
        // Defer so the tier can change between scheduling and running — the window a snapshotted
        // tier ignored entirely.
        const timer = setTimeout(callback, 0);
        return () => clearTimeout(timer);
      },
    });

    scheduler.start();
    tier = "low";
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Nothing was fetched: the governor downgraded before the idle callback ran.
    expect(load).not.toHaveBeenCalled();
  });

  it("stops mid-queue when the tier drops between items", async () => {
    let tier: "high" | "low" = "high";
    const load = vi.fn(async () => {
      tier = "low";
      return true;
    });
    const scheduler = createPrefetchScheduler({ load, ids: ["a", "b", "c"], tier: () => tier, scheduleIdle: immediateIdle });

    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5));

    // The first fetch triggered the downgrade; the remaining two must not run.
    expect(load).toHaveBeenCalledTimes(1);
    expect(scheduler.completed()).toEqual(["a"]);
  });

  it("never retries an id, including one that failed", async () => {
    const load = vi.fn(async (id: string) => {
      if (id === "a") throw new Error("network down");
      return true;
    });
    const scheduler = createPrefetchScheduler({ load, ids: ["a", "b"], tier: () => "high", scheduleIdle: immediateIdle });

    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    // A rejected prefetch must not surface as completed — the real load retries and reports.
    expect(scheduler.completed()).toEqual(["b"]);
    scheduler.start();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not count a no-op load as a warmed asset", async () => {
    const { scheduler } = make({ load: vi.fn(async () => false) });
    scheduler.start();
    await Promise.resolve();
    expect(scheduler.completed()).toEqual([]);
  });

  it("start() is idempotent", async () => {
    const { scheduler, load } = make();
    scheduler.start();
    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  });

  it("stops scheduling after dispose and discards an in-flight result", async () => {
    let release!: (value: boolean) => void;
    const load = vi.fn(() => new Promise<boolean>((resolve) => (release = resolve)));
    const scheduler = createPrefetchScheduler({ load, ids: ["a", "b"], tier: () => "high", scheduleIdle: immediateIdle });

    scheduler.start();
    expect(load).toHaveBeenCalledTimes(1);

    scheduler.dispose();
    release(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.completed()).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending idle callback on dispose", () => {
    const cancel = vi.fn();
    const { scheduler } = make({ scheduleIdle: () => cancel });
    scheduler.start();
    scheduler.dispose();
    expect(cancel).toHaveBeenCalled();
  });

  it("reduces the queue on medium via maxItems (skip-or-reduce, not skip-or-full-blast)", async () => {
    const { scheduler, load } = make({
      tier: () => "medium",
      maxItems: () => prefetchBudgetForTier("medium"),
    });
    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Medium warms one id; the remaining two must stay cold.
    expect(load).toHaveBeenCalledTimes(1);
    expect(scheduler.completed()).toEqual(["a"]);
  });

  it("honours a live maxItems shrink between items", async () => {
    let budget = 3;
    const load = vi.fn(async () => {
      budget = 1; // governor-style shrink after the first warm
      return true;
    });
    const scheduler = createPrefetchScheduler({
      load,
      ids: ["a", "b", "c"],
      tier: () => "high",
      maxItems: () => budget,
      scheduleIdle: immediateIdle,
    });
    scheduler.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("prefetchBudgetForTier", () => {
  it("skips on low, reduces on medium, and leaves high uncapped", () => {
    expect(prefetchBudgetForTier("low")).toBe(0);
    expect(prefetchBudgetForTier("medium")).toBe(1);
    expect(prefetchBudgetForTier("high")).toBe(Number.POSITIVE_INFINITY);
  });
});
