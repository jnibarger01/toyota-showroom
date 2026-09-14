/**
 * XR capability messaging for the builder chrome (#16).
 *
 * Kept free of `navigator.xr` and of React so unit tests can pin the unsupported-device copy and
 * the enter/exit labels without mounting a canvas or stubbing WebXR. Session lifecycle lives in
 * `xrSession.ts`; this module only answers "what should the chrome say".
 */

export type XrCapability = "pending" | "supported" | "unsupported";

/** Shown when `immersive-ar` is unavailable (desktop browsers, iOS Safari today, insecure contexts). */
export const XR_UNSUPPORTED_MESSAGE =
  "AR walkaround is not available on this device or browser.";

export const XR_PENDING_MESSAGE = "Checking AR support…";

export const XR_ENTER_LABEL = "View in AR";
export const XR_EXIT_LABEL = "Exit AR";

/**
 * Accessible title / status text for the AR control given the last known capability.
 * `null` when the control is fully interactive (supported, not pending).
 */
export function describeXrCapability(capability: XrCapability): string | null {
  if (capability === "pending") return XR_PENDING_MESSAGE;
  if (capability === "unsupported") return XR_UNSUPPORTED_MESSAGE;
  return null;
}

/** Label for the viewport AR control. Presenting swaps enter → exit so one control covers both. */
export function xrControlLabel(presenting: boolean): string {
  return presenting ? XR_EXIT_LABEL : XR_ENTER_LABEL;
}

/** Whether the control can start or end a session from a user gesture. */
export function xrControlEnabled(capability: XrCapability): boolean {
  return capability === "supported";
}
