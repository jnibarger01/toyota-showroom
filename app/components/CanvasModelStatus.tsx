"use client";

/**
 * Labeled empty/error affordance for the 3D stage when a GLB is missing or fails to load.
 *
 * Distinct from `CanvasErrorBoundary` (#58 / A6): that boundary catches *React render* failures
 * (lazy chunk 404, missing GPU adapter, scene setup throw) and replaces the whole stage with a
 * static hero. This component covers the *asset* path — a network/404/decode failure inside
 * `VehicleCanvas` that would otherwise leave a blank WebGPU hole or a silent procedural swap
 * with no way to retry the download.
 *
 * Empty vs error copy is intentional:
 *   - empty  — vehicle has no detailed model configured (`hasModel: false`); informational.
 *   - error  — a configured GLB failed to fetch/decode; actionable with Retry.
 *
 * Pointer-events stay off the overlay shell so orbit/toolbar chrome keep working; only the
 * notice card (and its Retry button) capture clicks.
 */

import { AlertTriangle, Box, RotateCcw } from "lucide-react";

export type CanvasModelStatusKind = "empty" | "error";

export const CANVAS_MODEL_STATUS_COPY = {
  empty: {
    title: "No detailed 3D model",
    body: "This vehicle has no high-detail model yet. Showing a simplified preview — every configuration option still works.",
  },
  error: {
    title: "3D model could not be loaded",
    body: "The vehicle file failed to download or decode. You can retry, and every configuration option still works.",
  },
} as const;

type Props = {
  kind: CanvasModelStatusKind;
  /** Only wired for `error` — remounts the canvas load path. */
  onRetry?: () => void;
};

export function CanvasModelStatus({ kind, onRetry }: Props) {
  const copy = CANVAS_MODEL_STATUS_COPY[kind];
  const Icon = kind === "error" ? AlertTriangle : Box;

  return (
    <div
      className={`canvas-model-status canvas-model-status--${kind}`}
      data-testid="canvas-model-status"
      data-kind={kind}
      // Error is an alert (failure); empty is status (expected absence of a detailed asset).
      role={kind === "error" ? "alert" : "status"}
    >
      <div className="canvas-model-status-notice">
        <Icon size={18} aria-hidden />
        <div>
          <p className="canvas-model-status-title">{copy.title}</p>
          <p className="canvas-model-status-body">{copy.body}</p>
        </div>
        {kind === "error" && onRetry ? (
          <button
            className="ghost"
            type="button"
            data-testid="canvas-model-retry"
            onClick={onRetry}
          >
            <RotateCcw size={14} /> Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
