/**
 * Share / save funnel telemetry (#46).
 *
 * Reuses `clientMetrics` so product events share the same buffer, flush, and sink as renderer
 * metrics — no second vendor SDK. Names are stable string constants; labels are fixed-cardinality
 * only (never configuration ids, share URLs, or owner tokens).
 *
 * Session-once events (`build_started`, `deep_link_restored`, `persistence_mode`) refuse a second
 * emit so React Strict Mode remounts and effect re-runs do not double-count the funnel.
 */

import { recordMetric, type MetricName } from "./clientMetrics";

export const FUNNEL_EVENT_NAMES = {
  build_started: "build_started",
  option_changed: "option_changed",
  share_copied: "share_copied",
  deep_link_restored: "deep_link_restored",
  save_succeeded: "save_succeeded",
  save_failed: "save_failed",
  persistence_mode: "persistence_mode",
} as const satisfies Record<string, MetricName>;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[keyof typeof FUNNEL_EVENT_NAMES];

export type BuildStartedSource = "fresh" | "resume" | "deep_link";
export type ShareCopyMethod = "clipboard" | "prompt";
export type ShareLinkKind = "share_card" | "deep_link";
export type PersistenceModeLabel = "worker" | "local";
/** Fixed-cardinality failure class — never a free-form Error.message. */
export type SaveFailureReason = "network" | "conflict" | "validation" | "unknown";

const onceEmitted = new Set<string>();

function emitOnce(key: string, name: FunnelEventName, labels?: Record<string, string>): boolean {
  if (onceEmitted.has(key)) return false;
  onceEmitted.add(key);
  recordMetric({ name, labels });
  return true;
}

/** Clears once-guards. Tests only — production has one funnel session per page load. */
export function resetFunnelTelemetry(): void {
  onceEmitted.clear();
}

export function trackBuildStarted(labels: { source: BuildStartedSource }): void {
  emitOnce("build_started", FUNNEL_EVENT_NAMES.build_started, { source: labels.source });
}

export function trackOptionChanged(labels: { category: string }): void {
  // Category is catalog-fixed (paint, wheels, …); option ids are high-cardinality and skipped.
  recordMetric({
    name: FUNNEL_EVENT_NAMES.option_changed,
    labels: { category: labels.category },
  });
}

export function trackShareCopied(labels: { link_kind: ShareLinkKind; method: ShareCopyMethod }): void {
  recordMetric({
    name: FUNNEL_EVENT_NAMES.share_copied,
    labels: { link_kind: labels.link_kind, method: labels.method },
  });
}

export function trackDeepLinkRestored(): void {
  emitOnce("deep_link_restored", FUNNEL_EVENT_NAMES.deep_link_restored);
}

export function trackSaveSucceeded(labels?: { surface?: "auto" | "garage" }): void {
  recordMetric({
    name: FUNNEL_EVENT_NAMES.save_succeeded,
    labels: labels?.surface ? { surface: labels.surface } : undefined,
  });
}

export function trackSaveFailed(labels: { reason: SaveFailureReason }): void {
  recordMetric({
    name: FUNNEL_EVENT_NAMES.save_failed,
    labels: { reason: labels.reason },
  });
}

export function trackPersistenceMode(mode: PersistenceModeLabel): void {
  emitOnce("persistence_mode", FUNNEL_EVENT_NAMES.persistence_mode, { mode });
}

/** Map an unknown save error to a fixed-cardinality reason for telemetry. */
export function classifySaveFailure(error: unknown): SaveFailureReason {
  if (!error || typeof error !== "object") return "unknown";
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (code === "network_error") return "network";
  if (code === "revision_conflict" || status === 409) return "conflict";
  if (code === "invalid_body" || status === 400 || status === 422) return "validation";
  return "unknown";
}
