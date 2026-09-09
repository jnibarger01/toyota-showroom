// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraController } from "../lib/three/cameraController";
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

describe("CameraController premium viewer controls", () => {
  let dom: HTMLDivElement;

  beforeEach(() => {
    stubMatchMedia();
    dom = document.createElement("div");
    document.body.appendChild(dom);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.remove();
  });

  function makeController(onAutoRotateChange?: (enabled: boolean) => void): CameraController {
    return new CameraController({
      domElement: dom,
      initialPreset: hero,
      presets: [hero],
      onAutoRotateChange,
    });
  }

  it("starts with auto-rotate disabled and reports that state", () => {
    const controller = makeController();
    expect(controller.controls.autoRotate).toBe(false);
    expect(controller.getState().autoRotate).toBe(false);
    controller.dispose();
  });

  it("enables and disables OrbitControls auto-rotation through the typed API", () => {
    const onAutoRotateChange = vi.fn();
    const controller = makeController(onAutoRotateChange);

    controller.setAutoRotate(true);
    expect(controller.controls.autoRotate).toBe(true);
    expect(controller.getState().autoRotate).toBe(true);
    expect(onAutoRotateChange).toHaveBeenLastCalledWith(true);

    controller.setAutoRotate(false);
    expect(controller.controls.autoRotate).toBe(false);
    expect(controller.getState().autoRotate).toBe(false);
    expect(onAutoRotateChange).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });

  it("pauses auto-rotate when the user begins a direct OrbitControls interaction", () => {
    const onAutoRotateChange = vi.fn();
    const controller = makeController(onAutoRotateChange);
    controller.setAutoRotate(true);

    controller.controls.dispatchEvent({ type: "start" });

    expect(controller.controls.autoRotate).toBe(false);
    expect(controller.getState().autoRotate).toBe(false);
    expect(onAutoRotateChange).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });

  it("pauses auto-rotate before explicit orbit and dolly commands", () => {
    const controller = makeController();
    controller.setAutoRotate(true);
    controller.orbitBy(0.1, 0);
    expect(controller.getState().autoRotate).toBe(false);

    controller.setAutoRotate(true);
    controller.dollyBy(-0.6);
    expect(controller.getState().autoRotate).toBe(false);
    controller.dispose();
  });
});
