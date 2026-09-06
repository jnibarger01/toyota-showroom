/**
 * Lightweight frame-time instrumentation for the WebGPU/WebGL render path.
 *
 * Always-on and allocation-light: a fixed ring buffer of recent frame deltas, no GPU timers
 * (those need EXT_disjoint_timer_query / timestamp queries and are not portable across WebGPU +
 * WebGL2). Sufficient for #27's acceptance and as the signal source #33 can later use for
 * adaptive quality.
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
    this.buffer[this.index] = delta;
    this.index = (this.index + 1) % this.buffer.length;
    if (this.filled < this.buffer.length) this.filled += 1;
    return this.snapshot();
  }

  snapshot(): FrameStatsSnapshot {
    if (this.filled === 0) return { ...EMPTY };

    let sum = 0;
    for (let i = 0; i < this.filled; i += 1) sum += this.buffer[i]!;
    const avgFrameMs = sum / this.filled;
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
    this.buffer.fill(0);
  }
}

/** Format a snapshot for `dataset` / log lines without allocating heavy objects. */
export function formatFrameStats(stats: FrameStatsSnapshot): string {
  if (stats.samples === 0) return "n/a";
  return `${stats.avgFps.toFixed(0)}fps avg/${stats.avgFrameMs.toFixed(1)}ms`;
}
