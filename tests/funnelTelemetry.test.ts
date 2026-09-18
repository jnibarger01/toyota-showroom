import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectedMetrics, resetMetrics } from "../lib/observability/clientMetrics";
import {
  FUNNEL_EVENT_NAMES,
  classifySaveFailure,
  resetFunnelTelemetry,
  trackBuildStarted,
  trackDeepLinkRestored,
  trackOptionChanged,
  trackPersistenceMode,
  trackSaveFailed,
  trackSaveSucceeded,
  trackShareCopied,
} from "../lib/observability/funnelTelemetry";

beforeEach(() => {
  resetMetrics();
  resetFunnelTelemetry();
});

afterEach(() => {
  resetMetrics();
  resetFunnelTelemetry();
});

describe("funnel event names", () => {
  it("exposes stable funnel names matching MetricName", () => {
    expect(FUNNEL_EVENT_NAMES).toEqual({
      build_started: "build_started",
      option_changed: "option_changed",
      share_copied: "share_copied",
      deep_link_restored: "deep_link_restored",
      save_succeeded: "save_succeeded",
      save_failed: "save_failed",
      persistence_mode: "persistence_mode",
    });
  });
});

describe("funnel payload shape", () => {
  it("records build_started once with a fixed source label", () => {
    trackBuildStarted({ source: "fresh" });
    trackBuildStarted({ source: "resume" });

    expect(collectedMetrics()).toEqual([
      { name: "build_started", labels: { source: "fresh" } },
    ]);
  });

  it("records option_changed with category only (no option id / PII)", () => {
    trackOptionChanged({ category: "paint" });
    trackOptionChanged({ category: "wheels" });

    expect(collectedMetrics()).toEqual([
      { name: "option_changed", labels: { category: "paint" } },
      { name: "option_changed", labels: { category: "wheels" } },
    ]);
    for (const metric of collectedMetrics()) {
      expect(metric.labels).not.toHaveProperty("optionId");
      expect(metric.labels).not.toHaveProperty("url");
      expect(JSON.stringify(metric)).not.toMatch(/cfg_|token|@/);
    }
  });

  it("records share_copied without the share URL", () => {
    trackShareCopied({ link_kind: "deep_link", method: "clipboard" });

    expect(collectedMetrics()).toEqual([
      {
        name: "share_copied",
        labels: { link_kind: "deep_link", method: "clipboard" },
      },
    ]);
    expect(JSON.stringify(collectedMetrics()[0])).not.toMatch(/https?:/);
  });

  it("records deep_link_restored once per session", () => {
    trackDeepLinkRestored();
    trackDeepLinkRestored();
    expect(collectedMetrics()).toEqual([{ name: "deep_link_restored" }]);
  });

  it("records save_succeeded and save_failed with fixed-cardinality labels", () => {
    trackSaveSucceeded({ surface: "auto" });
    trackSaveFailed({ reason: "conflict" });

    expect(collectedMetrics()).toEqual([
      { name: "save_succeeded", labels: { surface: "auto" } },
      { name: "save_failed", labels: { reason: "conflict" } },
    ]);
  });

  it("records persistence_mode once when mode latches", () => {
    trackPersistenceMode("local");
    trackPersistenceMode("worker");

    expect(collectedMetrics()).toEqual([
      { name: "persistence_mode", labels: { mode: "local" } },
    ]);
  });
});

describe("classifySaveFailure", () => {
  it("maps known API shapes to fixed reasons", () => {
    expect(classifySaveFailure({ code: "network_error" })).toBe("network");
    expect(classifySaveFailure({ code: "revision_conflict", status: 409 })).toBe("conflict");
    expect(classifySaveFailure({ code: "invalid_body", status: 400 })).toBe("validation");
    expect(classifySaveFailure(new Error("boom"))).toBe("unknown");
  });
});
