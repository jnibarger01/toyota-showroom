import { describe, expect, it } from "vitest";
import { QualityGovernor } from "../lib/three/qualityGovernor";
import type { QualitySettings, QualityTier } from "../lib/three/quality";

/**
 * The governor is deliberately pure — frame deltas in, tier changes out — so its tuning can be
 * exercised against synthetic frame sequences instead of a GPU and a stopwatch. These tests are
 * mostly about the *failure* modes: a governor that oscillates, or that reacts to a backgrounded
 * tab, is worse than no governor at all.
 */

/** Drives `count` frames of `deltaMs`, advancing a fake clock so cooldowns elapse realistically. */
function run(
  governor: QualityGovernor,
  clock: { now: number },
  deltaMs: number,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    clock.now += deltaMs;
    governor.recordFrame(deltaMs);
  }
}

function setup(initialTier: QualityTier = "high") {
  const clock = { now: 0 };
  const changes: Array<{ tier: QualityTier; settings: QualitySettings; reason: string }> = [];
  const governor = new QualityGovernor({
    initialTier,
    now: () => clock.now,
    onChange: (settings, { reason }) => changes.push({ tier: settings.tier, settings, reason }),
  });
  return { clock, changes, governor };
}

const FAST_MS = 12; // ~83 fps, comfortably under the upgrade threshold
const SLOW_MS = 45; // ~22 fps, comfortably over the downgrade threshold
const BAND_MS = 26; // inside the hysteresis band: neither degrades nor promotes

describe("QualityGovernor", () => {
  it("starts at the requested tier and reports it", () => {
    const { governor } = setup("medium");
    expect(governor.tier).toBe("medium");
  });

  it("steps down after sustained slow frames", () => {
    const { governor, clock, changes } = setup();
    run(governor, clock, SLOW_MS, 200);

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.reason).toBe("downgrade");
    expect(changes[0]!.tier).toBe("medium");
  });

  it("ignores warm-up frames", () => {
    // The first frames of a WebGL scene include shader compilation and are reliably slow. Reacting
    // to them would downgrade hardware that handles the scene fine a moment later.
    const { governor, clock, changes } = setup();
    run(governor, clock, SLOW_MS, 25); // fewer than WARMUP_FRAMES (30)
    expect(changes).toEqual([]);
  });

  it("walks all the way down under sustained load but never past the last rung", () => {
    const { governor, clock, changes } = setup();
    run(governor, clock, SLOW_MS, 5000);

    expect(governor.tier).toBe("low");
    expect(changes).toHaveLength(2); // high -> medium -> low
    expect(changes.every((change) => change.reason === "downgrade")).toBe(true);
  });

  it("steps back up when sustained headroom returns", () => {
    const { governor, clock, changes } = setup("low");
    run(governor, clock, FAST_MS, 400);

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.reason).toBe("upgrade");
  });

  it("never rises above the top rung", () => {
    const { governor, clock, changes } = setup("high");
    run(governor, clock, FAST_MS, 3000);

    expect(governor.tier).toBe("high");
    expect(changes).toEqual([]);
  });

  it("holds steady inside the hysteresis band", () => {
    // This band is exactly where a naive governor oscillates: fast enough to look promotable,
    // slow enough to look degradable, depending on which threshold it checks first.
    const { governor, clock, changes } = setup("medium");
    run(governor, clock, BAND_MS, 2000);

    expect(changes).toEqual([]);
    expect(governor.tier).toBe("medium");
  });

  it("does not oscillate when a downgrade is what made frames fast again", () => {
    // The realistic loop: slow frames force a downgrade, the downgrade makes frames fast, and a
    // governor without asymmetric dwell immediately promotes back into the tier it just left.
    const { governor, clock, changes } = setup();
    run(governor, clock, SLOW_MS, 100); // force one downgrade
    const afterDowngrade = changes.length;
    expect(afterDowngrade).toBeGreaterThan(0);

    // Post-downgrade the scene is comfortable, but only briefly — far short of the upgrade dwell.
    run(governor, clock, FAST_MS, 60);
    expect(changes).toHaveLength(afterDowngrade);
  });

  it("discards outlier frames from a backgrounded tab or GC pause", () => {
    // A tab restored after a minute reports a delta of tens of seconds. Smoothing that in would
    // downgrade a machine that never actually struggled.
    const { governor, clock, changes } = setup();
    run(governor, clock, FAST_MS, 40); // establish a healthy average past warm-up

    for (let index = 0; index < 50; index += 1) {
      clock.now += 30_000;
      governor.recordFrame(30_000);
    }

    expect(changes).toEqual([]);
    expect(governor.averageFrameTimeMs).toBeLessThan(20);
  });

  it("ignores non-finite and non-positive deltas", () => {
    const { governor, changes } = setup();
    for (const bad of [0, -5, NaN, Infinity, -Infinity]) governor.recordFrame(bad);

    expect(changes).toEqual([]);
    expect(governor.averageFrameTimeMs).toBe(0);
  });

  it("seeds the average from the first real sample rather than easing up from zero", () => {
    const { governor } = setup();
    governor.recordFrame(18);
    expect(governor.averageFrameTimeMs).toBe(18);
  });

  it("suppresses measurements taken during the post-change cooldown", () => {
    // Frames sampled while the renderer is still absorbing a resolution or shadow-map change
    // describe the transition, not the new steady state.
    const { governor, clock, changes } = setup();
    run(governor, clock, SLOW_MS, 100);
    const afterFirst = changes.length;

    // Same wall-clock instant: everything here falls inside CHANGE_COOLDOWN_MS.
    for (let index = 0; index < 100; index += 1) governor.recordFrame(SLOW_MS);
    expect(changes).toHaveLength(afterFirst);
  });
});

/**
 * Opening-tier selection lives in `lib/three/quality.ts` (`resolveQuality`), which reads richer
 * device hints than this module ever did — coarse pointer and Save-Data as well as memory and
 * cores — and is covered by `tests/quality.test.ts`. The governor only moves the tier from
 * wherever that put it, so there is deliberately nothing to duplicate here.
 */
