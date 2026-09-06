import { qualitySettingsFor, type QualitySettings, type QualityTier } from "./quality";

/**
 * Adaptive mid-session quality policy — the follow-up `lib/three/quality.ts` defers to issue #33.
 *
 * `quality.ts` picks a tier **once**, from device hints, and says so explicitly: "Adaptive
 * mid-session policy (auto-downgrade from frame time) is intentionally left to issue #33." This is
 * that policy. It consumes the frame times `lib/three/frameStats.ts` already collects — which that
 * module was likewise written to be "the signal source #33 can later use" — and moves the tier
 * when the opening guess turns out to be wrong.
 *
 * Device hints are a guess, and necessarily a coarse one: `deviceMemory` is Chromium-only,
 * `hardwareConcurrency` counts cores rather than GPU capability, and neither says anything about
 * fill rate — which is what actually decides whether this scene holds a frame rate. A machine that
 * looks capable can still be driving a 4K display off an integrated GPU. Without a feedback loop
 * the guess is final for the session; with one, it only has to be close.
 *
 * ## Why the policy is separate from the tiers
 *
 * `quality.ts` owns *what a tier means* (pixel ratio, shadow map, starfield density, whether to
 * fetch the authored running gear). This module owns *when to change tier*, and nothing else — it
 * touches no Three.js object and imports no renderer. That keeps the tuning testable against
 * synthetic frame sequences instead of requiring a GPU and a stopwatch, and it means a change to
 * what "low" costs does not disturb the logic deciding when to reach for it.
 *
 * ## The failure mode this is designed around
 *
 * The naive version oscillates. Quality drops, frame times improve *because* it dropped, quality
 * rises, frame times degrade again — a visible pulsing that is worse than simply running at the
 * lower tier. Three things prevent it:
 *
 *   - **Asymmetric thresholds.** The frame time that triggers a downgrade sits well above the one
 *     that permits an upgrade, so the post-downgrade steady state does not immediately re-qualify.
 *   - **Asymmetric dwell.** Downgrades react in about half a second; upgrades need several seconds
 *     of sustained headroom. Being slow to add load back is the cheap direction to err.
 *   - **A cooldown after every change.** Measurements taken while the renderer is still absorbing
 *     a resolution or shadow-map change describe the transition, not the new steady state.
 */

/** Ladder order, worst to best. Mirrors `quality.ts`'s own ranking. */
const TIER_LADDER: readonly QualityTier[] = ["low", "medium", "high"];

export interface QualityGovernorOptions {
  /** Opening tier, normally `resolveQuality(collectBrowserDeviceHints()).tier`. */
  initialTier: QualityTier;
  /** Called when the tier changes, with the full settings for the new tier. */
  onChange: (
    settings: QualitySettings,
    context: { from: QualityTier; reason: "downgrade" | "upgrade" },
  ) => void;
  /** Injectable clock, for tests. Defaults to `performance.now`. */
  now?: () => number;
}

/**
 * Sustained frame time above this (ms) means the current tier is too expensive.
 *
 * ~33 ms is 30 fps. Chosen over a 60 fps target because this is an orbit-and-inspect showroom, not
 * a twitch game: 30 fps is a perfectly good experience here, and degrading fidelity to chase 60 on
 * hardware that cannot reach it trades away the product's appearance for a number nobody is
 * looking at.
 */
const DOWNGRADE_ABOVE_MS = 33;

/**
 * Sustained frame time below this (ms) means there is room to add quality back.
 *
 * ~20 ms is 50 fps. The gap to `DOWNGRADE_ABOVE_MS` is the hysteresis band: a scene sitting between
 * 20 and 33 ms is left exactly where it is, which is the point — that band is where an oscillating
 * governor would live.
 */
const UPGRADE_BELOW_MS = 20;

/** Consecutive qualifying frames before stepping down (~0.5 s of bad frames at 30 fps). */
const FRAMES_BEFORE_DOWNGRADE = 15;

/**
 * Consecutive qualifying frames before stepping up (~4 s at 50 fps).
 *
 * An order of magnitude slower than a downgrade. A wrong downgrade costs some fidelity; a wrong
 * upgrade costs a stutter and then a downgrade, which the user reads as the page misbehaving.
 */
const FRAMES_BEFORE_UPGRADE = 200;

/** Ignored after a tier change (ms) — measurements here describe the transition, not the result. */
const CHANGE_COOLDOWN_MS = 500;

/**
 * Frame deltas above this (ms) are discarded rather than smoothed.
 *
 * A backgrounded tab, a blocking main-thread task, or a GC pause produces deltas of hundreds of
 * milliseconds to seconds. Those describe the browser, not the renderer. `canvasIdle.ts` already
 * suspends the loop when the tab is hidden, so this mostly catches the resume edge and long tasks —
 * but without it the first frame back would drive a spurious downgrade.
 */
const OUTLIER_FRAME_MS = 250;

/**
 * Weight of each new sample in the exponential moving average.
 *
 * 0.1 gives a time constant of roughly ten frames — long enough that one slow frame cannot move the
 * average far, short enough to react inside the dwell windows above.
 */
const EWMA_ALPHA = 0.1;

/**
 * Frames ignored at startup.
 *
 * The first frames of a WebGL/WebGPU scene include shader compilation, pipeline creation, and
 * texture uploads. They are reliably slow, reliably unrepresentative, and would otherwise trigger
 * an immediate downgrade on hardware that handles the scene comfortably a second later.
 */
const WARMUP_FRAMES = 30;

export class QualityGovernor {
  private readonly onChange: QualityGovernorOptions["onChange"];
  private readonly now: () => number;

  private tierIndex: number;
  private averageFrameMs = 0;
  private framesSeen = 0;
  private slowStreak = 0;
  private fastStreak = 0;
  private changedAt = Number.NEGATIVE_INFINITY;

  constructor(options: QualityGovernorOptions) {
    this.onChange = options.onChange;
    this.now = options.now ?? (() => performance.now());
    this.tierIndex = TIER_LADDER.indexOf(options.initialTier);
    if (this.tierIndex < 0) this.tierIndex = TIER_LADDER.length - 1;
  }

  /** The tier currently in effect. */
  get tier(): QualityTier {
    return TIER_LADDER[this.tierIndex]!;
  }

  /** Smoothed frame time in ms, or 0 before any sample. Exposed for telemetry. */
  get averageFrameTimeMs(): number {
    return this.averageFrameMs;
  }

  /**
   * Feeds one frame's duration to the governor. Call once per rendered frame.
   *
   * Cheap by construction — a few comparisons and one multiply-add — because it runs inside the
   * render loop, where a governor expensive enough to matter would be self-defeating.
   */
  recordFrame(deltaMs: number): void {
    // Non-finite or non-positive deltas mean a broken clock, not a fast frame.
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    if (deltaMs > OUTLIER_FRAME_MS) return;

    this.framesSeen += 1;
    // Seeded from the first real sample rather than eased up from zero, which would otherwise spend
    // the warm-up window climbing out of an average that never reflected a real frame.
    this.averageFrameMs =
      this.framesSeen === 1
        ? deltaMs
        : this.averageFrameMs + EWMA_ALPHA * (deltaMs - this.averageFrameMs);

    if (this.framesSeen <= WARMUP_FRAMES) return;
    if (this.now() - this.changedAt < CHANGE_COOLDOWN_MS) return;

    if (this.averageFrameMs > DOWNGRADE_ABOVE_MS) {
      this.slowStreak += 1;
      this.fastStreak = 0;
      if (this.slowStreak >= FRAMES_BEFORE_DOWNGRADE) this.step(-1, "downgrade");
      return;
    }

    if (this.averageFrameMs < UPGRADE_BELOW_MS) {
      this.fastStreak += 1;
      this.slowStreak = 0;
      if (this.fastStreak >= FRAMES_BEFORE_UPGRADE) this.step(1, "upgrade");
      return;
    }

    // Inside the hysteresis band: not bad enough to degrade, not good enough to promote. Both
    // streaks reset so a change needs a *contiguous* run rather than an accumulation of scattered
    // frames.
    this.slowStreak = 0;
    this.fastStreak = 0;
  }

  /**
   * Discards accumulated timing without changing tier.
   *
   * Called when the render loop resumes from idle suspension: `canvasIdle.ts` stops the loop when
   * the tab is hidden or the canvas scrolls out of view, and the frames either side of that gap
   * describe the pause rather than the renderer.
   */
  reset(): void {
    this.averageFrameMs = 0;
    this.framesSeen = 0;
    this.slowStreak = 0;
    this.fastStreak = 0;
  }

  private step(direction: 1 | -1, reason: "downgrade" | "upgrade"): void {
    const next = this.tierIndex + direction;
    if (next < 0 || next >= TIER_LADDER.length) {
      // Already at an end of the ladder. Clear the streaks so the governor is not left permanently
      // primed to fire the instant a change becomes possible.
      this.slowStreak = 0;
      this.fastStreak = 0;
      return;
    }

    const from = this.tier;
    this.tierIndex = next;
    this.slowStreak = 0;
    this.fastStreak = 0;
    this.changedAt = this.now();
    // Reset the average to the threshold that triggered the change rather than carrying the old one
    // forward: the previous tier's frame times say nothing about the new tier's, and a stale
    // average would let the next change fire on evidence from a configuration that no longer
    // exists.
    this.averageFrameMs = reason === "downgrade" ? DOWNGRADE_ABOVE_MS : UPGRADE_BELOW_MS;
    this.onChange(qualitySettingsFor(this.tier), { from, reason });
  }
}
