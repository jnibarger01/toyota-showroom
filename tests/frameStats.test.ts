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

