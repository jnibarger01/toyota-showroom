/**
 * Static quality tiers for the vehicle canvas (Pages / mobile).
 *
 * Tier selection is device-hint based (memory, cores, coarse pointer, Save-Data). Adaptive
 * mid-session policy (auto-downgrade from frame time) is intentionally left to issue #33 —
 * this module only picks a tier once and exposes the renderer knobs that act as our LOD stand-in
 * while the shipped GLB has a single mesh resolution.
 */

export type QualityTier = "high" | "medium" | "low";

export type QualitySettings = {
  tier: QualityTier;
  /** Cap passed to `renderer.setPixelRatio`. */
  maxPixelRatio: number;
  antialias: boolean;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  /**
   * Whether to fetch the optional authored wheel/tyre glTFs. Low skips them so first-settle on
   * constrained devices does not wait on a second pair of Draco downloads.
   */
  loadAuthoredRunningGear: boolean;
  /** Point count for the Night starfield. */
  starfieldCount: number;
  /** Scales rim + fill intensity (key/hemi stay at their preset values). */
  secondaryLightScale: number;
};

export type DeviceHints = {
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  userAgent?: string;
  devicePixelRatio?: number;
  saveData?: boolean;
  /** Force a tier (tests, or a future UI override). */
  preferTier?: QualityTier;
};

const TIER_SETTINGS: Record<QualityTier, Omit<QualitySettings, "tier">> = {
  high: {
    maxPixelRatio: 2,
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    loadAuthoredRunningGear: true,
    starfieldCount: 400,
    secondaryLightScale: 1,
  },
  medium: {
    maxPixelRatio: 1.5,
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    loadAuthoredRunningGear: true,
    starfieldCount: 200,
    secondaryLightScale: 0.85,
  },
  low: {
    maxPixelRatio: 1,
    antialias: false,
    shadowsEnabled: false,
    shadowMapSize: 512,
    loadAuthoredRunningGear: false,
    starfieldCount: 80,
    secondaryLightScale: 0.6,
  },
};

export function qualitySettingsFor(tier: QualityTier): QualitySettings {
  return { tier, ...TIER_SETTINGS[tier] };
}

/**
 * Pick a tier from coarse device signals. Prefer explicit override, then Save-Data / very low
 * memory, then a mobile-ish heuristic, else high.
 */
export function selectQualityTier(hints: DeviceHints = {}): QualityTier {
  if (hints.preferTier) return hints.preferTier;

  if (hints.saveData) return "low";

  const memory = hints.deviceMemoryGb;
  if (typeof memory === "number" && memory > 0 && memory <= 2) return "low";
  if (typeof memory === "number" && memory > 0 && memory <= 4) return "medium";

  const cores = hints.hardwareConcurrency;
  if (typeof cores === "number" && cores > 0 && cores <= 2) return "low";
  if (typeof cores === "number" && cores > 0 && cores <= 4) return "medium";

  const ua = hints.userAgent?.toLowerCase() ?? "";
  const touch = hints.maxTouchPoints ?? 0;
  const mobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
  const coarsePointer = touch > 1;
  if (mobileUa || coarsePointer) {
    // Phones with decent memory still land medium rather than high — DPR * shadow cost dominates.
    return "medium";
  }

  const dpr = hints.devicePixelRatio ?? 1;
  if (dpr >= 3) return "medium";

  return "high";
}

export function resolveQuality(hints: DeviceHints = {}): QualitySettings {
  return qualitySettingsFor(selectQualityTier(hints));
}

/** Snapshot of `navigator` / `window` fields used by `selectQualityTier`. Safe under SSR. */
export function collectBrowserDeviceHints(preferTier?: QualityTier): DeviceHints {
  if (typeof navigator === "undefined") {
    return preferTier ? { preferTier } : {};
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };

  return {
    deviceMemoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    hardwareConcurrency: nav.hardwareConcurrency,
    maxTouchPoints: nav.maxTouchPoints,
    userAgent: nav.userAgent,
    devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : undefined,
    saveData: nav.connection?.saveData === true,
    preferTier,
  };
}
