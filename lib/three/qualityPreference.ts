import type { QualityTier } from "./quality";

/**
 * The viewer's own quality choice, persisted across visits.
 *
 * `selectQualityTier` guesses a starting tier from coarse device signals — `deviceMemory`, core
 * count, a mobile UA test — and `QualityGovernor` then walks that guess up or down from measured
 * frame time. Both are inferences, and both are wrong for real people: `deviceMemory` is capped and
 * rounded by every browser that reports it at all (and Safari does not), a desktop on battery
 * behaves nothing like the same machine plugged in, and an external display can change the
 * effective cost of a tier without changing a single hint. `DeviceHints.preferTier` already existed
 * as the escape hatch for exactly this and was never wired to anything a viewer could reach.
 *
 * `"auto"` is the default and means "keep inferring" — it is not a fourth tier. A pinned tier turns
 * the governor off rather than seeding it, because a preference that the next slow frame silently
 * overrides is not a preference.
 */
export type QualityPreference = QualityTier | "auto";

const STORAGE_KEY = "toyota-showroom:quality";

function isQualityPreference(value: string | null): value is QualityPreference {
  return value === "auto" || value === "low" || value === "medium" || value === "high";
}

/**
 * Reads the stored preference, defaulting to `"auto"`.
 *
 * Every access is guarded: `localStorage` throws rather than returning null in a Safari private
 * window and under some enterprise policies, and this runs during renderer construction, where an
 * exception would cost the whole 3D view to recover a display preference.
 */
export function readQualityPreference(): QualityPreference {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    return isQualityPreference(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/** Persists the preference, or clears it for `"auto"` so the default is absence, not a stored word. */
export function writeQualityPreference(preference: QualityPreference): void {
  try {
    if (preference === "auto") globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, preference);
  } catch {
    // A viewer who cannot persist the choice still gets it for this session — the caller applies it
    // to the live renderer regardless of whether this succeeded.
  }
}

/** The `DeviceHints.preferTier` value for a preference: `undefined` when auto-detection should run. */
export function preferredTierHint(preference: QualityPreference): QualityTier | undefined {
  return preference === "auto" ? undefined : preference;
}
