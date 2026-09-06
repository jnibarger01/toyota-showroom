/**
 * Progressive GLB load state machine.
 *
 * VehicleCanvas paints a procedural placeholder first, then swaps in the detailed GLB once it
 * decodes. This module owns the phase transitions so they stay testable without a renderer.
 */

export type ProgressiveLoadPhase =
  | "idle"
  | "placeholder"
  | "loading-glb"
  | "settling"
  | "ready"
  | "fallback";

export type ProgressiveLoadEvent =
  | { type: "start-placeholder" }
  | { type: "start-loading" }
  | { type: "glb-decoded" }
  | { type: "settled" }
  | { type: "load-failed" }
  | { type: "no-model" };

export type ProgressiveLoadState = {
  phase: ProgressiveLoadPhase;
  /** True while a temporary stand-in is (or was) shown before the detailed mesh. */
  usedPlaceholder: boolean;
  /** True once the detailed GLB is the live root (not the procedural fallback). */
  hasDetailedModel: boolean;
};

export function initialProgressiveState(): ProgressiveLoadState {
  return { phase: "idle", usedPlaceholder: false, hasDetailedModel: false };
}

/**
 * Pure transition. Invalid events for the current phase are ignored (state returned unchanged)
 * so the canvas can fire hooks defensively during teardown.
 */
export function reduceProgressiveLoad(
  state: ProgressiveLoadState,
  event: ProgressiveLoadEvent,
): ProgressiveLoadState {
  switch (event.type) {
    case "no-model":
      // Procedural-only vehicles: ready immediately, no GLB path.
      return { phase: "ready", usedPlaceholder: false, hasDetailedModel: false };

    case "start-placeholder":
      if (state.phase !== "idle") return state;
      return { phase: "placeholder", usedPlaceholder: true, hasDetailedModel: false };

    case "start-loading":
      if (state.phase !== "placeholder" && state.phase !== "idle") return state;
      return {
        phase: "loading-glb",
        usedPlaceholder: state.usedPlaceholder || state.phase === "placeholder",
        hasDetailedModel: false,
      };

    case "glb-decoded":
      if (state.phase !== "loading-glb" && state.phase !== "placeholder") return state;
      return { ...state, phase: "settling", hasDetailedModel: true };

    case "settled":
      // Only the post-decode settle path becomes `ready`. `fallback` stays terminal so callers
      // can tell a failed GLB from a successful progressive swap (`isSceneInteractive` covers both).
      if (state.phase === "settling") return { ...state, phase: "ready" };
      return state;

    case "load-failed":
      // Keep whatever stand-in is on screen as the permanent fallback.
      return {
        phase: "fallback",
        usedPlaceholder: state.usedPlaceholder,
        hasDetailedModel: false,
      };

    default:
      return state;
  }
}

/** Whether first paint is allowed to show something other than an empty canvas. */
export function canShowFirstPaint(state: ProgressiveLoadState): boolean {
  return (
    state.phase === "placeholder" ||
    state.phase === "loading-glb" ||
    state.phase === "settling" ||
    state.phase === "ready" ||
    state.phase === "fallback"
  );
}

/** Whether `onReady` / catalog verification should run against the live root. */
export function isSceneInteractive(state: ProgressiveLoadState): boolean {
  return state.phase === "ready" || state.phase === "fallback";
}
