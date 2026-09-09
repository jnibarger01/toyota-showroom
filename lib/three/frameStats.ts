/**
 * Lightweight frame-time instrumentation for the WebGPU/WebGL render path.
 *
 * Always-on and allocation-light: a fixed ring buffer of recent frame deltas. This is the CPU-side
 * signal — the wall-clock gap between rAF callbacks — and it is what `QualityGovernor` steers on.
 *
 * GPU-side timing lives in `lib/three/gpuTimer.ts` rather than here, because it is conditional in a
 * way this is not: `EXT_disjoint_timer_query_webgl2` and WebGPU's `timestamp-query` are optional on
 * both backends and frequently unavailable, so it returns `null` where this always produces a
 * number. Keeping the always-available signal free of that conditionality is why they are separate
 * modules; `RenderController` publishes both and lets the gap between them be read.
 */

export type FrameStatsSnapshot = {
  /** Most recent frame duration in milliseconds. */
  lastFrameMs: number;
  /** Rolling mean over the ring buffer. */
  avgFrameMs: number;
  /** Instantaneous FPS from `lastFrameMs` (0 when unknown). */
  fps: number;
  /** Rolling mean FPS from `avgFrameMs`. */
  avgFps: number;
  /** Samples recorded so far (capped at buffer length for averaging purposes). */
  samples: number;
};

const EMPTY: FrameStatsSnapshot = {
  lastFrameMs: 0,
  avgFrameMs: 0,
  fps: 0,
  avgFps: 0,
  samples: 0,
};

export class FrameTimeTracker {
  private readonly buffer: Float64Array;
  private index = 0;
  private filled = 0;
  /**
   * Running total of the live entries in `buffer`.
   *
   * `snapshot()` is called on every single frame (`RenderController.loop`), but the stats it
   * produces are published to the canvas dataset only every 30th frame. Re-summing up to 60
   * entries per frame to throw away 29 of every 30 results is work the render loop does not need
   * to do. Maintaining the sum incrementally makes `snapshot()` O(1).
   *
   * Float error: entries are added and subtracted in a different order than a fresh summation
   * would use, so this can drift from a recomputed sum in the last bits. For frame times in the
   * 8–33ms range over a 60-entry window that is far below the precision anything here reports
   * (`formatFrameStats` rounds), and it is bounded rather than accumulating, because every value
   * added is subtracted again exactly once when it leaves the window.
   */
  private sum = 0;
  private lastNow = 0;
  private started = false;
  private lastFrameMs = 0;

  constructor(capacity = 60) {
    this.buffer = new Float64Array(Math.max(capacity, 1));
  }

  /**
   * Record a frame at `nowMs` (typically `performance.now()`). The first call only seeds the
   * clock and does not produce a sample.
   */
  record(nowMs: number): FrameStatsSnapshot {
    if (!this.started) {
      this.started = true;
      this.lastNow = nowMs;
      return this.snapshot();
    }

    const delta = Math.max(nowMs - this.lastNow, 0);
    this.lastNow = nowMs;
    this.lastFrameMs = delta;
    // Subtract the value being evicted before overwriting it. Reads 0 for a slot never written,
    // which is correct: those slots are outside `filled` and contribute nothing.
    this.sum -= this.buffer[this.index]!;
    this.sum += delta;
    this.buffer[this.index] = delta;
    this.index = (this.index + 1) % this.buffer.length;
    if (this.filled < this.buffer.length) this.filled += 1;
    return this.snapshot();
  }

  snapshot(): FrameStatsSnapshot {
    if (this.filled === 0) return { ...EMPTY };

    const avgFrameMs = this.sum / this.filled;
    const lastFrameMs = this.lastFrameMs;
    return {
      lastFrameMs,
      avgFrameMs,
      fps: lastFrameMs > 0 ? 1000 / lastFrameMs : 0,
      avgFps: avgFrameMs > 0 ? 1000 / avgFrameMs : 0,
      samples: this.filled,
    };
  }

  reset(): void {
    this.index = 0;
    this.filled = 0;
    this.lastNow = 0;
    this.started = false;
    this.lastFrameMs = 0;
    this.sum = 0;
    this.buffer.fill(0);
  }
}

/** Format a snapshot for `dataset` / log lines without allocating heavy objects. */
export function formatFrameStats(stats: FrameStatsSnapshot): string {
  if (stats.samples === 0) return "n/a";
  return `${stats.avgFps.toFixed(0)}fps avg/${stats.avgFrameMs.toFixed(1)}ms`;
}
