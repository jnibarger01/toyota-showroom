/**
 * User-facing save failure copy and recovery kinds (#52).
 *
 * Telemetry already maps errors to fixed-cardinality reasons via `classifySaveFailure`.
 * This module turns the same classification into distinct builder copy and flags whether
 * Worker-mode conflict recovery actions should be offered.
 */

import { ApiError } from "./errors";
import {
  classifySaveFailure,
  type SaveFailureReason,
} from "../observability/funnelTelemetry";

export type { SaveFailureReason };

/** Distinct builder copy for each save-failure class — do not reuse across kinds. */
export const SAVE_FAILURE_COPY = {
  conflict:
    "This build was updated elsewhere (stale revision). Reload the saved copy, overwrite it with your changes, or keep your changes as a new draft.",
  network: "Could not reach the cloud save service. Check your connection and try again.",
  validation: "Those changes could not be saved — an option or value is not valid for this build.",
  unknown: "Could not save this build. Try again in a moment.",
} as const satisfies Record<SaveFailureReason, string>;

/** Confirm copy before a force-overwrite PATCH (omits expectedRevision). */
export const OVERWRITE_CONFIRM =
  "Overwrite the saved build with your local changes? The other revision will be replaced and cannot be undone from this screen.";

/** Pure: map any thrown save error to a fixed-cardinality reason. */
export function saveFailureReason(error: unknown): SaveFailureReason {
  return classifySaveFailure(error);
}

/** Pure: user-facing message for a save failure (distinct per reason). */
export function messageForSaveFailure(error: unknown): string {
  return SAVE_FAILURE_COPY[saveFailureReason(error)];
}

/** True when the failure is a 409 / revision_conflict the Worker conflict UX should handle. */
export function isRevisionConflict(error: unknown): boolean {
  return saveFailureReason(error) === "conflict";
}

/** Narrow helper for tests and UI guards. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
