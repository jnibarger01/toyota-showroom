/**
 * Frame-rate-driven render quality governor.
 *
 * The showroom shipped one fixed quality level: a 2048² shadow map and a device pixel ratio capped
 * at 2, regardless of hardware. On a desktop GPU that is cheap. On a mid-tier phone — where a 2×
 * DPR means rendering ~4× the pixels of the CSS viewport, with a shadow pass over 497k triangles —
 * it is not, and there was no path back: the scene simply ran slow for as long as the user stayed.
 *
 * This is the missing feedback loop. It watches frame times and steps quality down when the
 * renderer cannot keep up, then back up if headroom returns.
 *
 * ## Why a state machine, and why it lives here
 *
 * Deliberately pure: it takes frame deltas in and calls `onChange` out, touching no Three.js object
 * itself. That keeps the tuning — which is all judgement, and all of it wrong until measured on
 * real hardware — testable against synthetic frame sequences instead of requiring a GPU and a
 * stopwatch. `VehicleCanvas` owns the actual renderer mutations.
 *
 * ## The failure mode this is designed around
 *
 * The naive version oscillates. Quality drops, frame times improve *because* quality dropped,
 * quality rises, frame times degrade again — a visible pulsing that is worse than just running at
 * the lower tier. Three things prevent it:
 *
 *   - **Asymmetric thresholds.** The frame time that triggers a downgrade is well above the one
 *     that permits an upgrade, so the post-downgrade steady state does not immediately re-qualify.
 *   - **Asymmetric dwell.** Downgrades react in about half a second; upgrades require several
 *     seconds of sustained headroom. Being slow to add load back is the cheap direction to err.
 *   - **A cooldown after every change.** Measurements taken while the renderer is still absorbing
 *     a resolution or shadow-map change describe the transition, not the new steady state.
 */

/** One rung of the quality ladder. Lower index = higher quality. */
export interface QualityTier {
  id: string;
  /**
   * Upper bound on `renderer.setPixelRatio`. The effective value is
   * `min(devicePixelRatio, pixelRatioCap)` — this never *raises* resolution above what the display
   * actually has, it only caps it.
   */
  pixelRatioCap: number;
  /** Directional shadow map resolution, or 0 to disable shadow casting entirely. */
  shadowMapSize: number;
}

/**
 * The ladder, highest quality first.
 *
 * Resolution is stepped before shadows because pixel count is the dominant cost in this scene and
 * a DPR reduction is far less noticeable than losing cast shadows, which do most of the work of
 * making the vehicle sit on the floor rather than float above it — the exact artifact the lighting
 * rig in `VehicleCanvas` was tuned to eliminate. Real shadows are given up only at the bottom rung,
 * where the alternative is an unusable frame rate.
 *
 * Even there the vehicle is not left floating: `createContactShadow` is a texture-mapped plane, not
 * a shadow-map consumer, so it survives `renderer.shadowMap.enabled = false` and keeps the primary
 * grounding cue at every tier. That is what makes disabling cast shadows an acceptable last resort
 * rather than a visual cliff.
 */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { id: "high", pixelRatioCap: 2, shadowMapSize: 2048 },
  { id: "balanced", pixelRatioCap: 1.5, shadowMapSize: 1024 },
  { id: "efficient", pixelRatioCap: 1, shadowMapSize: 512 },
  { id: "minimal", pixelRatioCap: 1, shadowMapSize: 0 },
];

export interface QualityGovernorOptions {
  /** Ladder to walk. Defaults to `QUALITY_TIERS`. */
  tiers?: readonly QualityTier[];
  /** Starting rung. Defaults to 0 (highest quality). */
  initialTierIndex?: number;
  /** Called whenever the active tier changes. Never called with the tier already in effect. */
  onChange: (tier: QualityTier, context: { from: QualityTier; reason: "downgrade" | "upgrade" }) => void;
  /** Injectable clock, for tests. Defaults to `performance.now`. */
  now?: () => number;
}

/**
 * Sustained frame time above this (ms) means the current tier is too expensive.
 *
 * ~33 ms is 30 fps. Chosen rather than a 60 fps target because this is an orbit-and-inspect
 * showroom, not a twitch game: 30 fps is a perfectly good experience here, and degrading quality to
 * chase 60 on hardware that cannot reach it trades away visual fidelity for a number nobody is
 * looking at.
 */
const DOWNGRADE_ABOVE_MS = 33;

/**
 * Sustained frame time below this (ms) means there is room to add quality back.
 *
 * ~20 ms is 50 fps. The gap to `DOWNGRADE_ABOVE_MS` is the hysteresis band: a scene sitting between
 * 20 and 33 ms is left exactly where it is, which is the whole point — that band is where an
 * oscillating governor would live.
 */
const UPGRADE_BELOW_MS = 20;

/** Consecutive qualifying frames before stepping down (~0.5 s of bad frames at 30 fps). */
const FRAMES_BEFORE_DOWNGRADE = 15;

/**
 * Consecutive qualifying frames before stepping up (~4 s at 50 fps).
 *
 * An order of magnitude slower to upgrade than to downgrade. A wrong downgrade costs some visual
 * fidelity; a wrong upgrade costs a stutter and then a downgrade, which the user sees as the page
 * misbehaving.
 */
const FRAMES_BEFORE_UPGRADE = 200;

/** Ignored after a tier change (ms) — measurements here describe the transition, not the result. */
const CHANGE_COOLDOWN_MS = 500;

/**
 * Frame deltas above this (ms) are discarded rather than smoothed.
 *
 * A backgrounded tab, a blocking main-thread task, or a garbage collection pause produces deltas of
 * hundreds of milliseconds to seconds. Those describe the browser, not the renderer, and feeding
 * them to the average would drive a spurious downgrade the moment a user tabs back.
 */
const OUTLIER_FRAME_MS = 250;

/**
 * Weight of each new sample in the exponential moving average.
 *
 * 0.1 gives a time constant of roughly ten frames — long enough that one slow frame cannot move the
 * average far, short enough to react within the dwell windows above.
 */
const EWMA_ALPHA = 0.1;

/**
 * Frames ignored at startup.
 *
 * The first frames of a WebGL/WebGPU scene include shader compilation, pipeline creation, and
 * texture uploads. They are reliably slow, reliably unrepresentative, and would otherwise trigger
 * an immediate downgrade on hardware that handles the scene fine a second later.
 */
const WARMUP_FRAMES = 30;

export class QualityGovernor {
  private readonly tiers: readonly QualityTier[];
  private readonly onChange: QualityGovernorOptions["onChange"];
  private readonly now: () => number;

  private tierIndex: number;
  private averageFrameMs = 0;
  private framesSeen = 0;
  private slowStreak = 0;
  private fastStreak = 0;
  private changedAt = Number.NEGATIVE_INFINITY;

  constructor(options: QualityGovernorOptions) {
    this.tiers = options.tiers ?? QUALITY_TIERS;
    this.onChange = options.onChange;
    this.now = options.now ?? (() => performance.now());
    this.tierIndex = Math.min(Math.max(options.initialTierIndex ?? 0, 0), this.tiers.length - 1);
  }

  /** The tier currently in effect. */
  get tier(): QualityTier {
    return this.tiers[this.tierIndex]!;
  }

  /** Smoothed frame time in ms, or 0 before any sample has been taken. Exposed for telemetry. */
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
    // Seed with the first real sample rather than easing up from zero, which would otherwise spend
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
      if (this.slowStreak >= FRAMES_BEFORE_DOWNGRADE) this.step(1, "downgrade");
      return;
    }

    if (this.averageFrameMs < UPGRADE_BELOW_MS) {
      this.fastStreak += 1;
      this.slowStreak = 0;
      if (this.fastStreak >= FRAMES_BEFORE_UPGRADE) this.step(-1, "upgrade");
      return;
    }

    // Inside the hysteresis band: not bad enough to degrade, not good enough to promote. Reset both
    // streaks so a change requires a *contiguous* run, not an accumulation of scattered frames.
    this.slowStreak = 0;
    this.fastStreak = 0;
  }

  private step(direction: 1 | -1, reason: "downgrade" | "upgrade"): void {
    const next = this.tierIndex + direction;
    if (next < 0 || next >= this.tiers.length) {
      // Already at an end of the ladder. Clear the streak so the governor is not left permanently
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
    // Reset the average to the threshold that triggered the change rather than carrying the old
    // one forward: the previous tier's frame times say nothing about the new tier's, and leaving a
    // stale average in place would let the next change fire on evidence from a configuration that
    // no longer exists.
    this.averageFrameMs = reason === "downgrade" ? DOWNGRADE_ABOVE_MS : UPGRADE_BELOW_MS;
    this.onChange(this.tier, { from, reason });
  }
}

/**
 * Best-guess opening tier, so slow hardware does not have to fail its way down the ladder.
 *
 * The signals are weak — `deviceMemory` is Chromium-only, `hardwareConcurrency` counts cores rather
 * than GPU capability, and neither says anything direct about fill rate. They are used only to pick
 * a *starting* rung; the governor corrects from there in either direction, which is what makes a
 * rough heuristic acceptable here rather than a source of permanent misjudgement.
 */
export function suggestInitialTierIndex(
  navigatorLike: { deviceMemory?: number; hardwareConcurrency?: number } = navigator,
): number {
  const memory = navigatorLike.deviceMemory ?? 8;
  const cores = navigatorLike.hardwareConcurrency ?? 8;
  if (memory <= 2 || cores <= 2) return 2; // "efficient"
  if (memory <= 4 || cores <= 4) return 1; // "balanced"
  return 0;
}
