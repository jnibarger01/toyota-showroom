import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectedMetrics,
  flushMetrics,
  installMetricsFlush,
  recordMetric,
  resetMetrics,
} from "../../lib/observability/clientMetrics";

/**
 * Under `tests/components/` only because `vitest.config.ts` maps that glob to jsdom, which this
 * needs for `document` and `navigator`. Not a component test.
 */

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetMetrics();
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  infoSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("recordMetric", () => {
  it("buffers rather than sending immediately", () => {
    // Sending per metric would put network requests in the middle of model loading and frame
    // rendering — measurement that degrades the thing being measured.
    recordMetric({ name: "renderer_selected", labels: { renderer: "webgpu" } });
    recordMetric({ name: "first_frame", value: 240 });

    expect(collectedMetrics()).toHaveLength(2);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("ignores metrics recorded after the batch has gone", () => {
    // The page is on its way out; a late metric would never be delivered, and buffering it would
    // only grow an array nobody reads.
    recordMetric({ name: "first_frame", value: 100 });
    flushMetrics();
    recordMetric({ name: "quality_changed", value: 40 });

    expect(collectedMetrics()).toHaveLength(1);
  });
});

describe("flushMetrics", () => {
  it("logs the batch when no collector is configured", () => {
    // The honest default for this deployment: there is no analytics backend, and posting to an
    // endpoint that silently 404s would look like working telemetry while producing nothing.
    recordMetric({ name: "model_loaded", value: 812 });
    flushMetrics();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(infoSpy.mock.calls[0]![1] as string);
    expect(payload.metrics).toEqual([{ name: "model_loaded", value: 812 }]);
    expect(payload.at).toBeTruthy();
  });

  it("is idempotent", () => {
    // visibilitychange can fire repeatedly as a tab is hidden, shown, and hidden again. A second
    // flush would double-count every metric in the batch.
    recordMetric({ name: "first_frame", value: 300 });
    flushMetrics();
    flushMetrics();

    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is nothing to report", () => {
    flushMetrics();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("installMetricsFlush", () => {
  it("flushes when the page is hidden", () => {
    const uninstall = installMetricsFlush();
    recordMetric({ name: "first_frame", value: 180 });

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(infoSpy).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("does not flush while the page is still visible", () => {
    const uninstall = installMetricsFlush();
    recordMetric({ name: "first_frame", value: 180 });

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(infoSpy).not.toHaveBeenCalled();
    uninstall();
  });

  it("flushes on pagehide, which Safari uses instead of a visibility transition", () => {
    const uninstall = installMetricsFlush();
    recordMetric({ name: "model_loaded", value: 512 });

    window.dispatchEvent(new Event("pagehide"));

    expect(infoSpy).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("stops listening after teardown", () => {
    const uninstall = installMetricsFlush();
    uninstall();

    recordMetric({ name: "first_frame", value: 180 });
    window.dispatchEvent(new Event("pagehide"));

    expect(infoSpy).not.toHaveBeenCalled();
  });
});
