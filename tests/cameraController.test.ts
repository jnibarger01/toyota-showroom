// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gsap from "gsap";
import * as THREE from "three";
import { CameraController, DEFAULT_CAMERA_LIMITS } from "../lib/three/cameraController";
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

/**
 * `OrbitControls.update()` — called once inside its own constructor, and again by every method
 * here that ends with `controls.update()` — recomputes `camera.position` from a spherical offset
 * derived from whatever `camera.position`/`controls.target` currently hold. That round-trip
 * through `sin`/`cos` introduces float noise on the order of 1e-15, even when nothing conceptually
 * moved (e.g. `4.5` reads back as `4.499999999999999`). Real, pre-existing OrbitControls behavior
 * (the original VehicleCanvas.tsx Home-key handler had the same `set(...); controls.update()`
 * shape), not a defect this class introduces — so comparisons that cross an `update()` call use
 * this instead of exact `toEqual`.
 */
function expectVec3CloseTo(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
}

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

describe("CameraController", () => {
  let dom: HTMLDivElement;

  beforeEach(() => {
    stubMatchMedia(false);
    gsap.globalTimeline.clear();
    dom = document.createElement("div");
    document.body.appendChild(dom);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    gsap.globalTimeline.clear();
    dom.remove();
  });

  function makeController(presets: CameraPresetConfig[] = [hero, wheels, interior]) {
    return new CameraController({
      domElement: dom,
      initialPreset: hero,
      presets,
    });
  }

  describe("construction", () => {
    it("positions the camera and orbit target from the initial preset", () => {
      const controller = makeController();
      expectVec3CloseTo(controller.camera.position.toArray(), hero.position);
      expectVec3CloseTo(controller.controls.target.toArray(), hero.target);
      controller.dispose();
    });

    it("applies the default distance and polar-angle limits", () => {
      const controller = makeController();
      expect(controller.controls.minDistance).toBe(DEFAULT_CAMERA_LIMITS.minDistance);
      expect(controller.controls.maxDistance).toBe(DEFAULT_CAMERA_LIMITS.maxDistance);
      expect(controller.controls.maxPolarAngle).toBe(DEFAULT_CAMERA_LIMITS.maxPolarAngle);
      controller.dispose();
    });

    it("accepts overridden limits", () => {
      const controller = new CameraController({
        domElement: dom,
        initialPreset: hero,
        presets: [hero],
        limits: { minDistance: 1, maxDistance: 3 },
      });
      expect(controller.controls.minDistance).toBe(1);
      expect(controller.controls.maxDistance).toBe(3);
      // Unspecified limits keep their default rather than becoming undefined.
      expect(controller.controls.maxPolarAngle).toBe(DEFAULT_CAMERA_LIMITS.maxPolarAngle);
      controller.dispose();
    });

    it("disables OrbitControls damping under reduced motion", () => {
      stubMatchMedia(true);
      const controller = makeController();
      expect(controller.controls.enableDamping).toBe(false);
      controller.dispose();

      stubMatchMedia(false);
      const controller2 = makeController();
      expect(controller2.controls.enableDamping).toBe(true);
      controller2.dispose();
    });

    it("starts the tour idle", () => {
      const controller = makeController();
      expect(controller.tourStatus).toBe("idle");
      expect(controller.isTourActive).toBe(false);
      controller.dispose();
    });
  });

  describe("transitionToPreset", () => {
    it("tweens camera position and orbit target to the preset", () => {
      const controller = makeController();
      controller.transitionToPreset(wheels);
      gsap.globalTimeline.time(gsap.globalTimeline.duration() + 1);
      expect(controller.camera.position.toArray()).toEqual(wheels.position);
      expect(controller.controls.target.toArray()).toEqual(wheels.target);
      controller.dispose();
    });

    it("collapses to an instant set under reduced motion", () => {
      stubMatchMedia(true);
      const controller = makeController();
      controller.transitionToPreset(wheels);
      // Zero-duration tweens complete on the next tick of the global timeline.
      gsap.globalTimeline.time(0.01);
      expect(controller.camera.position.toArray()).toEqual(wheels.position);
      expect(controller.controls.target.toArray()).toEqual(wheels.target);
      controller.dispose();
    });
  });

  describe("resetToPreset", () => {
    it("snaps to the preset with no tween", () => {
      const controller = makeController();
      controller.camera.position.set(0, 0, 0);
      controller.controls.target.set(99, 99, 99);
      controller.resetToPreset(wheels);
      expectVec3CloseTo(controller.camera.position.toArray(), wheels.position);
      expectVec3CloseTo(controller.controls.target.toArray(), wheels.target);
      controller.dispose();
    });

    it("cancels an in-flight tour first, so GSAP cannot overwrite the reset a frame later", () => {
      const controller = makeController();
      controller.playTour();
      expect(controller.isTourActive).toBe(true);
      controller.resetToPreset(hero);
      expect(controller.isTourActive).toBe(false);
      expectVec3CloseTo(controller.camera.position.toArray(), hero.position);
      // Advancing the (killed) timeline must not move the camera off the reset pose.
      gsap.globalTimeline.time(gsap.globalTimeline.duration() + 1);
      expectVec3CloseTo(controller.camera.position.toArray(), hero.position);
      controller.dispose();
    });
  });

  describe("orbitBy", () => {
    it("rotates the camera about the target and preserves distance", () => {
      const controller = makeController();
      const before = controller.camera.position.distanceTo(controller.controls.target);
      controller.orbitBy(0.5, 0);
      const after = controller.camera.position.distanceTo(controller.controls.target);
      expect(after).toBeCloseTo(before, 5);
      // theta changed, so the position itself moved.
      expect(controller.camera.position.toArray()).not.toEqual(hero.position);
    });

    it("clamps phi away from the poles", () => {
      const controller = new CameraController({
        domElement: dom,
        initialPreset: { id: "top", label: "Top", position: [0, 14.9, 0.1], target: [0, 0, 0] },
        presets: [],
      });
      // A huge negative delta would otherwise flip the camera through the pole.
      controller.orbitBy(0, -10);
      const offset = controller.camera.position.clone().sub(controller.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      expect(spherical.phi).toBeGreaterThanOrEqual(0.05);
      controller.dispose();
    });

    it("clamps radius to the configured distance limits", () => {
      const controller = new CameraController({
        domElement: dom,
        initialPreset: hero,
        presets: [],
        limits: { minDistance: 4, maxDistance: 5 },
      });
      controller.orbitBy(0, 0); // establishes baseline inside limits via the clamp itself
      const before = controller.camera.position.distanceTo(controller.controls.target);
      // 1e-9 slack for the same OrbitControls.update() spherical round-trip noise
      // `expectVec3CloseTo`'s doc comment explains — the distance itself is unclamped math here,
      // not read back through `update()`, but `orbitBy`'s own clamp already bounds it to [4, 5].
      expect(before).toBeLessThanOrEqual(5 + 1e-9);
      expect(before).toBeGreaterThanOrEqual(4 - 1e-9);
      controller.dispose();
    });

    it("cancels an in-flight tour before orbiting", () => {
      const controller = makeController();
      controller.playTour();
      expect(controller.isTourActive).toBe(true);
      controller.orbitBy(0.1, 0);
      expect(controller.isTourActive).toBe(false);
      controller.dispose();
    });
  });

  describe("dollyBy", () => {
    it("changes only the distance to the target, not the viewing angle", () => {
      const controller = makeController();
      const offsetBefore = controller.camera.position.clone().sub(controller.controls.target);
      const sphericalBefore = new THREE.Spherical().setFromVector3(offsetBefore);

      controller.dollyBy(1);

      const offsetAfter = controller.camera.position.clone().sub(controller.controls.target);
      const sphericalAfter = new THREE.Spherical().setFromVector3(offsetAfter);
      expect(sphericalAfter.radius).toBeCloseTo(sphericalBefore.radius + 1, 5);
      expect(sphericalAfter.theta).toBeCloseTo(sphericalBefore.theta, 5);
      expect(sphericalAfter.phi).toBeCloseTo(sphericalBefore.phi, 5);
      controller.dispose();
    });

    it("clamps to the configured distance limits", () => {
      const controller = new CameraController({
        domElement: dom,
        initialPreset: hero,
        presets: [],
        limits: { minDistance: 4, maxDistance: 15 },
      });
      controller.dollyBy(-1000);
      const offset = controller.camera.position.clone().sub(controller.controls.target);
      expect(offset.length()).toBeCloseTo(4, 5);

      controller.dollyBy(1000);
      const offset2 = controller.camera.position.clone().sub(controller.controls.target);
      expect(offset2.length()).toBeCloseTo(15, 5);
      controller.dispose();
    });
  });

  describe("tour delegation", () => {
    it("plays, pauses, and cancels the underlying tour", () => {
      const controller = makeController();
      controller.playTour();
      expect(controller.tourStatus).toBe("playing");
      controller.pauseTour();
      expect(controller.tourStatus).toBe("paused");
      controller.cancelTour();
      expect(controller.tourStatus).toBe("idle");
      controller.dispose();
    });

    it("setPresets re-resolves the tour's shot order without throwing", () => {
      const controller = makeController([hero]);
      expect(() => controller.setPresets([hero, wheels, interior])).not.toThrow();
      controller.dispose();
    });

    it("a tour with no presets is a no-op play, not a throw", () => {
      const controller = new CameraController({ domElement: dom, initialPreset: hero, presets: [] });
      expect(() => controller.playTour()).not.toThrow();
      expect(controller.tourStatus).toBe("idle");
      controller.dispose();
    });
  });

  describe("setAspect", () => {
    it("updates the camera's aspect ratio", () => {
      const controller = makeController();
      controller.setAspect(1600, 800);
      expect(controller.camera.aspect).toBeCloseTo(2, 5);
      controller.dispose();
    });

    it("guards against a zero-height canvas rather than dividing by zero", () => {
      const controller = makeController();
      controller.setAspect(800, 0);
      expect(Number.isFinite(controller.camera.aspect)).toBe(true);
      controller.dispose();
    });
  });

  describe("update", () => {
    it("does not throw when called repeatedly (idempotent per-frame tick)", () => {
      const controller = makeController();
      expect(() => {
        controller.update();
        controller.update();
        controller.update();
      }).not.toThrow();
      controller.dispose();
    });
  });

  describe("disposal", () => {
    it("disposes the tour and OrbitControls, and is idempotent", () => {
      const controller = makeController();
      const controlsDisposeSpy = vi.spyOn(controller.controls, "dispose");
      controller.playTour();
      controller.dispose();
      expect(controlsDisposeSpy).toHaveBeenCalledTimes(1);
      expect(controller.isTourActive).toBe(false);

      // A second dispose must not throw or double-dispose OrbitControls.
      expect(() => controller.dispose()).not.toThrow();
      expect(controlsDisposeSpy).toHaveBeenCalledTimes(1);
    });

    it("kills the tour's own tweens on dispose, so a running tour cannot move the camera afterward", () => {
      const controller = makeController();
      controller.playTour();
      gsap.globalTimeline.time(0.1); // mid-flight, well before the tour would complete
      controller.dispose();
      const frozen = controller.camera.position.toArray();
      // Advancing the global timeline must not move the camera further — the tour's timeline was
      // killed by dispose (CinematicTour.dispose() calls cancel(), which kills its own tweens).
      gsap.globalTimeline.time(gsap.globalTimeline.duration() + 1);
      expect(controller.camera.position.toArray()).toEqual(frozen);
    });

    it("a disposed controller's camera object is still safe to read (no null/undefined ref)", () => {
      const controller = makeController();
      controller.dispose();
      expect(controller.camera).toBeInstanceOf(THREE.PerspectiveCamera);
      expect(controller.controls.target).toBeInstanceOf(THREE.Vector3);
    });
  });

  describe("reinitialization / ownership boundaries", () => {
    it("two independently constructed controllers do not share camera or controls state", () => {
      const a = makeController();
      const b = new CameraController({ domElement: dom, initialPreset: wheels, presets: [wheels] });
      expect(a.camera).not.toBe(b.camera);
      expect(a.controls).not.toBe(b.controls);
      a.orbitBy(1, 0);
      expectVec3CloseTo(b.camera.position.toArray(), wheels.position);
      a.dispose();
      b.dispose();
    });

    it("disposing one controller does not affect a second controller on the same domElement", () => {
      const a = makeController();
      const b = new CameraController({ domElement: dom, initialPreset: wheels, presets: [wheels] });
      a.dispose();
      expect(() => b.update()).not.toThrow();
      expect(b.tourStatus).toBe("idle");
      b.dispose();
    });
  });
});
