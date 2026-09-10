import { describe, expect, it } from "vitest";
import { FrameTimeTracker, formatFrameStats } from "../lib/three/frameStats";

describe("FrameTimeTracker", () => {
  it("seeds on the first sample without recording a delta", () => {
    const tracker = new FrameTimeTracker(4);
    const first = tracker.record(1000);
    expect(first.samples).toBe(0);
    expect(first.fps).toBe(0);
  });

  it("tracks rolling average frame time and fps", () => {
    const tracker = new FrameTimeTracker(4);
    tracker.record(0);
    tracker.record(16);
    tracker.record(32);
    tracker.record(48);
    const snap = tracker.record(64);
    expect(snap.samples).toBe(4);
    expect(snap.lastFrameMs).toBe(16);
    expect(snap.avgFrameMs).toBeCloseTo(16, 5);
    expect(snap.avgFps).toBeCloseTo(62.5, 5);
  });

  it("formats a readable dataset string", () => {
    const tracker = new FrameTimeTracker(2);
    tracker.record(0);
    tracker.record(20);
    expect(formatFrameStats(tracker.snapshot())).toMatch(/fps avg/);
    expect(formatFrameStats({ lastFrameMs: 0, avgFrameMs: 0, fps: 0, avgFps: 0, samples: 0 })).toBe("n/a");
  });
});

  it("resets and reseeds so an idle gap is not recorded as a frame", () => {
    const tracker = new FrameTimeTracker(4);
    tracker.record(0);
    tracker.record(16);
    expect(tracker.snapshot().samples).toBe(1);
    tracker.reset();
    const seeded = tracker.record(10_000);
    expect(seeded.samples).toBe(0);
    const next = tracker.record(10_016);
    expect(next.samples).toBe(1);
    expect(next.lastFrameMs).toBe(16);
  });


describe("running-sum equivalence", () => {
  /**
   * `snapshot()` maintains `sum` incrementally rather than re-adding the ring buffer each call.
   * This pins the optimisation to the behaviour it replaced: the average must still match a plain
   * summation, including after the buffer has wrapped many times and after a reset.
   */
  function bruteForceAverage(samples: number[], capacity: number): number {
    const live = samples.slice(-capacity);
    return live.reduce((total, value) => total + value, 0) / live.length;
  }

  it("matches a brute-force average after the ring buffer wraps repeatedly", () => {
    const capacity = 8;
    const tracker = new FrameTimeTracker(capacity);
    const deltas: number[] = [];
    let now = 0;

    tracker.record(now); // seeds the clock, produces no sample
    for (let i = 0; i < 200; i += 1) {
      const delta = 8 + (i % 17) * 1.5;
      deltas.push(delta);
      now += delta;
      tracker.record(now);
    }

    const snapshot = tracker.snapshot();
    expect(snapshot.samples).toBe(capacity);
    expect(snapshot.avgFrameMs).toBeCloseTo(bruteForceAverage(deltas, capacity), 6);
  });

  it("clears the running sum on reset so stale frames cannot leak into the next average", () => {
    const tracker = new FrameTimeTracker(4);
    let now = 0;
    tracker.record(now);
    for (const delta of [100, 100, 100]) tracker.record((now += delta));

    tracker.reset();

    now = 0;
    tracker.record(now);
    tracker.record((now += 10));
    expect(tracker.snapshot().avgFrameMs).toBeCloseTo(10, 6);
  });
});
