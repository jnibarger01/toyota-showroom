// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gsap from "gsap";
import {
  createCinematicTour,
  resolveTourPresets,
  TOUR_PRESET_IDS,
  type TourStatus,
} from "../lib/three/cinematicTour";
import type { CameraPresetConfig } from "../lib/types/vehicle";

const hero: CameraPresetConfig = {
  id: "hero",
  label: "Hero",
  position: [7.5, 4, 8.5],
  target: [0, 1.1, 0],
};
const wheels: CameraPresetConfig = {
  id: "wheels",
  label: "Wheels",
  position: [4.5, 1.05, 4.8],
  target: [-0.9, 0.55, 1.3],
};
const interior: CameraPresetConfig = {
  id: "interior",
  label: "Interior",
  position: [5.2, 2.35, 1.1],
  target: [0, 1.35, 0],
};
const side: CameraPresetConfig = {
  id: "side",
  label: "Side",
  position: [10, 2.2, 0],
  target: [0, 1, 0],
};

function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce") ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("resolveTourPresets", () => {
  it("sequences hero → wheels → interior when those presetIds exist", () => {
    const resolved = resolveTourPresets([side, interior, hero, wheels]);
    expect(resolved.map((p) => p.id)).toEqual([...TOUR_PRESET_IDS]);
  });

  it("falls back to catalog order when the preferred path is thin", () => {
    expect(resolveTourPresets([hero, side]).map((p) => p.id)).toEqual(["hero", "side"]);
    expect(resolveTourPresets([hero]).map((p) => p.id)).toEqual(["hero"]);
  });
});

describe("createCinematicTour play/pause/cancel", () => {
  let cameraPosition: { x: number; y: number; z: number };
  let cameraTarget: { x: number; y: number; z: number };
  let controlsEnabled: boolean;
  let statuses: TourStatus[];
  let steps: string[];
  let cancels: number;
  let completes: number;
  let dom: HTMLDivElement;

  beforeEach(() => {
    stubMatchMedia(false);
    gsap.globalTimeline.clear();
    cameraPosition = { x: 0, y: 0, z: 0 };
    cameraTarget = { x: 0, y: 0, z: 0 };
    controlsEnabled = true;
    statuses = [];
    steps = [];
    cancels = 0;
    completes = 0;
    dom = document.createElement("div");
    document.body.appendChild(dom);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    gsap.globalTimeline.clear();
    dom.remove();
  });

  function makeTour(presets: CameraPresetConfig[] = [hero, wheels, interior]) {
    return createCinematicTour(
      {
        cameraPosition,
        cameraTarget,
        setControlsEnabled: (enabled) => {
          controlsEnabled = enabled;
        },
        domElement: dom,
      },
      presets,
      {
        onStatusChange: (status) => statuses.push(status),
        onStep: (preset) => steps.push(preset.id),
        onCancel: () => {
          cancels += 1;
        },
        onComplete: () => {
          completes += 1;
        },
      },
    );
  }

  it("plays, seizes orbit controls, and visits each tour preset", () => {
    const tour = makeTour();
    tour.play();
    expect(tour.status).toBe("playing");
    expect(controlsEnabled).toBe(false);
    expect(statuses).toContain("playing");

    // Flush the whole timeline: duration*3 + holds under reduced-motion-off is finite.
    gsap.globalTimeline.time(gsap.globalTimeline.duration() + 1);
    expect(steps).toEqual(["hero", "wheels", "interior"]);
    expect(completes).toBe(1);
    expect(tour.status).toBe("idle");
    expect(controlsEnabled).toBe(true);
    tour.dispose();
  });

  it("pauses and resumes without rebuilding the timeline from scratch", () => {
    const tour = makeTour();
    tour.play();
    gsap.globalTimeline.time(0.2);
    tour.pause();
    expect(tour.status).toBe("paused");
    expect(controlsEnabled).toBe(false);
    const stepsAtPause = steps.slice();

    tour.play();
    expect(tour.status).toBe("playing");
    gsap.globalTimeline.time(gsap.globalTimeline.duration() + 1);
    expect(steps.length).toBeGreaterThanOrEqual(stepsAtPause.length);
    expect(completes).toBe(1);
    tour.dispose();
  });

  it("cancels, re-enables orbit, and leaves the camera where it stopped", () => {
    const tour = makeTour();
    tour.play();
    gsap.globalTimeline.time(0.5);
    const frozen = { ...cameraPosition };
    tour.cancel();
    expect(tour.status).toBe("idle");
    expect(controlsEnabled).toBe(true);
    expect(cancels).toBe(1);
    expect(cameraPosition).toEqual(frozen);
    // Further timeline progress must not move the camera after cancel.
    gsap.globalTimeline.time(gsap.globalTimeline.duration() + 1);
    expect(cameraPosition).toEqual(frozen);
    tour.dispose();
  });

  it("cancels on canvas pointerdown so manual orbit never fights GSAP", () => {
    const tour = makeTour();
    tour.play();
    expect(controlsEnabled).toBe(false);
    dom.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(tour.status).toBe("idle");
    expect(controlsEnabled).toBe(true);
    expect(cancels).toBe(1);
    tour.dispose();
  });

  it("collapses motion under prefers-reduced-motion while still stepping presets", () => {
    stubMatchMedia(true);
    const tour = makeTour();
    tour.play();
    // Zero-duration tweens complete on the next tick of the global timeline.
    gsap.globalTimeline.time(0.01);
    expect(steps).toEqual(["hero", "wheels", "interior"]);
    expect(completes).toBe(1);
    expect(cameraPosition.x).toBe(interior.position[0]);
    expect(cameraPosition.y).toBe(interior.position[1]);
    expect(cameraPosition.z).toBe(interior.position[2]);
    tour.dispose();
  });
});
