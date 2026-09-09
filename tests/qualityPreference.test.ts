import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualityGovernor } from "../lib/three/qualityGovernor";
import { preferredTierHint, readQualityPreference, writeQualityPreference } from "../lib/three/qualityPreference";

/**
 * Unit tests run in plain Node (see `vitest.config.ts`), which has no `localStorage`. That is not a
 * gap to work around — it is one of the two environments this module must survive, alongside a
 * browser that has storage but refuses it. Both are covered explicitly.
 */
function installFakeStorage(): Storage {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  return storage;
}

describe("qualityPreference storage", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = installFakeStorage();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("defaults to auto when nothing is stored", () => {
    expect(readQualityPreference()).toBe("auto");
  });

  it("round-trips a pinned tier", () => {
    writeQualityPreference("low");
    expect(readQualityPreference()).toBe("low");
  });

  it("stores auto as absence rather than a stored word", () => {
    writeQualityPreference("high");
    writeQualityPreference("auto");
    expect(storage.getItem("toyota-showroom:quality")).toBeNull();
    expect(readQualityPreference()).toBe("auto");
  });

  it("falls back to auto for a corrupt stored value instead of trusting it as a tier", () => {
    storage.setItem("toyota-showroom:quality", "ultra");
    expect(readQualityPreference()).toBe("auto");
  });

  it("survives storage that throws, as in a private window", () => {
    const hostile = {
      getItem: () => {
        throw new Error("access denied");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("access denied");
      },
    } as unknown as Storage;
    Object.defineProperty(globalThis, "localStorage", { value: hostile, configurable: true, writable: true });

    // Renderer construction reads this; an exception here would cost the whole 3D view to recover
    // a display preference.
    expect(readQualityPreference()).toBe("auto");
    expect(() => writeQualityPreference("medium")).not.toThrow();
  });

  it("survives storage being absent entirely, as during server rendering", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    expect(readQualityPreference()).toBe("auto");
    expect(() => writeQualityPreference("low")).not.toThrow();
  });

  it("maps only a pinned tier into a device hint", () => {
    expect(preferredTierHint("auto")).toBeUndefined();
    expect(preferredTierHint("medium")).toBe("medium");
  });
});

describe("QualityGovernor pinning", () => {
  let now = 0;
  const advance = (ms: number) => (now += ms);

  function makeGovernor(onChange = vi.fn()) {
    now = 100_000; // well past the cooldown window so the first step is not gated by it
    return { governor: new QualityGovernor({ initialTier: "high", onChange, now: () => now }), onChange };
  }

  /** Enough sustained slow frames to trip a downgrade on an unpinned governor. */
  function feedSlowFrames(governor: QualityGovernor, count = 400) {
    for (let i = 0; i < count; i += 1) {
      advance(50);
      governor.recordFrame(50);
    }
  }

  afterEach(() => vi.restoreAllMocks());

  it("downgrades on sustained slow frames when unpinned — the baseline these tests contrast with", () => {
    const { governor, onChange } = makeGovernor();
    feedSlowFrames(governor);
    expect(onChange).toHaveBeenCalled();
    expect(governor.tier).toBe("low");
  });

  it("does not step while pinned, however slow the frames get", () => {
    const { governor, onChange } = makeGovernor();
    governor.setPinnedTier("high");
    onChange.mockClear();

    feedSlowFrames(governor);

    // A preference the next slow frame silently reverts is not a preference.
    expect(onChange).not.toHaveBeenCalled();
    expect(governor.tier).toBe("high");
    expect(governor.isPinned).toBe(true);
  });

  it("keeps measuring while pinned so telemetry stays meaningful", () => {
    const { governor } = makeGovernor();
    governor.setPinnedTier("high");
    feedSlowFrames(governor, 50);
    expect(governor.averageFrameTimeMs).toBeGreaterThan(30);
  });

  it("returns the settings to apply when pinning moves the tier, and null when it does not", () => {
    const { governor } = makeGovernor();
    expect(governor.setPinnedTier("low")).toMatchObject({ tier: "low" });
    expect(governor.setPinnedTier("low")).toBeNull();
  });

  it("resumes adapting after the pin is released", () => {
    const { governor, onChange } = makeGovernor();
    governor.setPinnedTier("high");
    feedSlowFrames(governor);
    expect(governor.tier).toBe("high");

    governor.setPinnedTier(null);
    expect(governor.isPinned).toBe(false);
    onChange.mockClear();

    feedSlowFrames(governor);
    expect(onChange).toHaveBeenCalled();
    expect(governor.tier).toBe("low");
  });

  it("does not fire an immediate step from streaks accumulated during the pin", () => {
    const { governor, onChange } = makeGovernor();
    governor.setPinnedTier("high");
    feedSlowFrames(governor);

    governor.setPinnedTier(null);
    onChange.mockClear();

    // One slow frame after release must not trip a downgrade the viewer never saw coming.
    advance(50);
    governor.recordFrame(50);
    expect(onChange).not.toHaveBeenCalled();
  });
});
