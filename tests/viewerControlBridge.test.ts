// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraController, KEYBOARD_ZOOM_STEP } from "../lib/three/cameraController";
import { dispatchViewerControl, subscribeViewerState } from "../lib/three/viewerControlEvents";
import type { CameraPresetConfig } from "../lib/types/vehicle";

const hero: CameraPresetConfig = {
  id: "hero",
  label: "Hero",
  position: [7.5, 4, 8.5],
  target: [0, 1.1, 0],
};

function stubMatchMedia(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("premium viewer control bridge", () => {
  let dom: HTMLDivElement;
  let controller: CameraController;

  beforeEach(() => {
    stubMatchMedia();
    dom = document.createElement("div");
    document.body.appendChild(dom);
    controller = new CameraController({ domElement: dom, initialPreset: hero, presets: [hero] });
  });

  afterEach(() => {
    controller.dispose();
    dom.remove();
    vi.unstubAllGlobals();
  });

  it("routes zoom controls to the active camera", () => {
    const before = controller.camera.position.distanceTo(controller.controls.target);
    dispatchViewerControl("zoom-in");
    const after = controller.camera.position.distanceTo(controller.controls.target);
    expect(after).toBeCloseTo(before - KEYBOARD_ZOOM_STEP, 5);
  });

  it("resets to the active preset after a manual orbit", () => {
    controller.orbitBy(0.4, 0.1);
    expect(controller.camera.position.toArray()).not.toEqual(hero.position);
    dispatchViewerControl("reset-camera");
    expect(controller.camera.position.toArray()).toEqual(hero.position);
    expect(controller.controls.target.toArray()).toEqual(hero.target);
  });

  it("toggles auto-rotate and publishes state for React chrome", () => {
    const states: boolean[] = [];
    const unsubscribe = subscribeViewerState((state) => states.push(state.autoRotate));

    dispatchViewerControl("toggle-auto-rotate");
    expect(controller.getState().autoRotate).toBe(true);
    expect(states.at(-1)).toBe(true);

    controller.controls.dispatchEvent({ type: "start" });
    expect(states.at(-1)).toBe(false);
    unsubscribe();
  });
});
