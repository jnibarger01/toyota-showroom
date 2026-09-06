import { describe, expect, it } from "vitest";
import {
  canShowFirstPaint,
  initialProgressiveState,
  isSceneInteractive,
  reduceProgressiveLoad,
} from "../lib/three/progressiveLoad";

describe("progressive GLB load state machine", () => {
  it("starts idle with no placeholder", () => {
    const state = initialProgressiveState();
    expect(state.phase).toBe("idle");
    expect(canShowFirstPaint(state)).toBe(false);
    expect(isSceneInteractive(state)).toBe(false);
  });

  it("walks placeholder → loading → settling → ready", () => {
    let state = initialProgressiveState();
    state = reduceProgressiveLoad(state, { type: "start-placeholder" });
    expect(state.phase).toBe("placeholder");
    expect(state.usedPlaceholder).toBe(true);
    expect(canShowFirstPaint(state)).toBe(true);

    state = reduceProgressiveLoad(state, { type: "start-loading" });
    expect(state.phase).toBe("loading-glb");

    state = reduceProgressiveLoad(state, { type: "glb-decoded" });
    expect(state.phase).toBe("settling");
    expect(state.hasDetailedModel).toBe(true);
    expect(isSceneInteractive(state)).toBe(false);

    state = reduceProgressiveLoad(state, { type: "settled" });
    expect(state.phase).toBe("ready");
    expect(isSceneInteractive(state)).toBe(true);
  });

  it("marks no-model vehicles ready without a placeholder", () => {
    const state = reduceProgressiveLoad(initialProgressiveState(), { type: "no-model" });
    expect(state).toEqual({ phase: "ready", usedPlaceholder: false, hasDetailedModel: false });
    expect(isSceneInteractive(state)).toBe(true);
  });

  it("keeps the stand-in as fallback when the GLB fails", () => {
    let state = initialProgressiveState();
    state = reduceProgressiveLoad(state, { type: "start-placeholder" });
    state = reduceProgressiveLoad(state, { type: "start-loading" });
    state = reduceProgressiveLoad(state, { type: "load-failed" });
    expect(state.phase).toBe("fallback");
    expect(state.hasDetailedModel).toBe(false);
    expect(state.usedPlaceholder).toBe(true);
    expect(isSceneInteractive(state)).toBe(true);
    // settled must not erase the fallback terminal state
    expect(reduceProgressiveLoad(state, { type: "settled" }).phase).toBe("fallback");
  });

  it("ignores out-of-order events", () => {
    const state = initialProgressiveState();
    expect(reduceProgressiveLoad(state, { type: "settled" })).toEqual(state);
    expect(reduceProgressiveLoad(state, { type: "glb-decoded" })).toEqual(state);
  });
});
