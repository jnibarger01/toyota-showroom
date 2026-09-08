import * as THREE from "three";
import gsap from "gsap";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraPresetConfig } from "../types/vehicle";
import { motionDuration, prefersReducedMotion } from "./motionPreference";
import { createCinematicTour, type CinematicTour, type TourStatus } from "./cinematicTour";

export type { TourStatus };

/**
 * Owns every camera-related runtime concern `VehicleCanvas.tsx` used to keep as scattered local
 * state and effects: the `THREE.PerspectiveCamera` itself, `OrbitControls`, preset transitions
 * (GSAP tweens, reduced-motion aware), keyboard orbit/dolly/reset, and cinematic-tour coordination.
 * Extracted so the camera surface has one owner with a small, typed API instead of being reachable
 * (and mutable) from anywhere in a 1300-line component — Mission Priority 3.
 *
 * Deliberately plain TypeScript, the same shape `VehicleSceneController`
 * (`lib/three/sceneController.ts`) and `createCinematicTour` (`lib/three/cinematicTour.ts`)
 * already use: no React import, no application-state or agent-layer dependency, a constructor that
 * takes exactly what it needs, and a single `dispose()` that undoes everything the constructor and
 * its methods did. `VehicleCanvas.tsx` becomes a caller of this class, not camera state's owner.
 *
 * What this class does NOT do, on purpose: no "focus on part" framing (nothing in the app computes
 * that today — extracting a feature that does not exist yet would be inventing one, not extracting
 * it; that is Priority 4's job once there is real behavior to expose through the agent API), no
 * rendering (the renderer/render loop stay in `VehicleCanvas.tsx` until Priority 6), no reading of
 * `Vehicle3DConfig` or any other application type beyond the preset shape itself.
 */

export interface CameraControllerLimits {
  /** Nearest `OrbitControls` dolly distance, metres. */
  minDistance: number;
  /** Farthest `OrbitControls` dolly distance, metres. */
  maxDistance: number;
  /** Radians; `Math.PI` would let the camera pass under the floor. */
  maxPolarAngle: number;
}

/** The exact defaults `VehicleCanvas.tsx` hardcoded before this extraction — unchanged. */
export const DEFAULT_CAMERA_LIMITS: CameraControllerLimits = {
  minDistance: 4,
  maxDistance: 15,
  maxPolarAngle: Math.PI * 0.49,
};

export interface CameraControllerOptions {
  /** Element `OrbitControls` and the cinematic tour's cancel-on-interrupt listen on. */
  domElement: HTMLElement;
  /** Camera pose on construction — usually the vehicle's first catalog preset. */
  initialPreset: CameraPresetConfig;
  /** Full preset list, resolved into the cinematic tour's shot order (`resolveTourPresets`). */
  presets: readonly CameraPresetConfig[];
  limits?: Partial<CameraControllerLimits>;
  /** Vertical FOV, degrees. Matches the value every vehicle in this catalog has shared to date. */
  fov?: number;
  near?: number;
  far?: number;
  onTourStatusChange?: (status: TourStatus) => void;
  onTourStep?: (preset: CameraPresetConfig, index: number) => void;
}

/** Seconds for a manual preset-button transition (collapsed under reduced motion). */
const PRESET_TRANSITION_SECONDS = 0.85;

/** Radians per keyboard orbit step — `KEYBOARD_ORBIT_STEP_RADIANS` in the pre-extraction component. */
export const KEYBOARD_ORBIT_STEP_RADIANS = 0.12;
/** Metres per keyboard dolly step — `KEYBOARD_ZOOM_STEP` in the pre-extraction component. */
export const KEYBOARD_ZOOM_STEP = 0.6;

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly tour: CinematicTour;
  private readonly limits: CameraControllerLimits;
  private disposed = false;

  constructor(options: CameraControllerOptions) {
    this.limits = { ...DEFAULT_CAMERA_LIMITS, ...options.limits };

    this.camera = new THREE.PerspectiveCamera(options.fov ?? 38, 1, options.near ?? 0.05, options.far ?? 100);
    this.camera.position.set(...options.initialPreset.position);

    this.controls = new OrbitControls(this.camera, options.domElement);
    // Damping is inertia: the scene keeps moving after the user stops dragging. That is exactly
    // the "motion I did not ask for and cannot stop" the reduced-motion preference covers, so it
    // is a preference check rather than a constant.
    this.controls.enableDamping = !prefersReducedMotion();
    this.controls.minDistance = this.limits.minDistance;
    this.controls.maxDistance = this.limits.maxDistance;
    this.controls.maxPolarAngle = this.limits.maxPolarAngle;
    this.controls.target.set(...options.initialPreset.target);

    // Cinematic tour seizes these controls while playing; pointer/wheel on `domElement` cancels.
    this.tour = createCinematicTour(
      {
        cameraPosition: this.camera.position,
        cameraTarget: this.controls.target,
        setControlsEnabled: (enabled) => {
          this.controls.enabled = enabled;
        },
        domElement: options.domElement,
      },
      options.presets,
      {
        onStatusChange: options.onTourStatusChange,
        onStep: options.onTourStep,
      },
    );
  }

  /** True while the cinematic tour owns the camera — callers should suppress their own preset-change reactions. */
  get isTourActive(): boolean {
    return this.tour.status !== "idle";
  }

  get tourStatus(): TourStatus {
    return this.tour.status;
  }

  playTour(): void {
    this.tour.play();
  }

  pauseTour(): void {
    this.tour.pause();
  }

  /** Cancels the tour and hands control back to `OrbitControls`, leaving the camera where it stopped. */
  cancelTour(): void {
    this.tour.cancel();
  }

  /** Re-resolves the tour's shot order — call when the vehicle's catalog presets change. */
  setPresets(presets: readonly CameraPresetConfig[]): void {
    this.tour.setPresets(presets);
  }

  /** Per-frame tick: advances `OrbitControls` damping. Call once before each render. */
  update(): void {
    this.controls.update();
  }

  /** Keeps the projection matrix in sync with the canvas's CSS size. */
  setAspect(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Smoothly moves to `preset` (a manual preset-button pick). Reduced motion collapses this to an
   * instant set via the same GSAP call site (`motionDuration` returns 0, and GSAP treats a
   * zero-duration tween as an immediate set) rather than a separate branch.
   */
  transitionToPreset(preset: CameraPresetConfig): void {
    const duration = motionDuration(PRESET_TRANSITION_SECONDS);
    gsap.to(this.camera.position, {
      x: preset.position[0],
      y: preset.position[1],
      z: preset.position[2],
      duration,
      ease: "power3.inOut",
    });
    gsap.to(this.controls.target, {
      x: preset.target[0],
      y: preset.target[1],
      z: preset.target[2],
      duration,
      ease: "power3.inOut",
    });
  }

  /**
   * Instantly snaps to `preset` with no tween — the Home-key "back to the active preset" escape
   * hatch from a lost orbit. Cancels any in-flight tour first, the same hand-off keyboard orbit
   * already performs, so GSAP and this direct write never fight over `camera.position`/
   * `controls.target` for a frame.
   */
  resetToPreset(preset: CameraPresetConfig): void {
    if (this.isTourActive) this.tour.cancel();
    this.camera.position.set(...preset.position);
    this.controls.target.set(...preset.target);
    this.controls.update();
  }

  /**
   * Orbits by a spherical delta about the current target, clamped to the same polar/distance
   * limits pointer input is constrained by. Cancels an in-flight tour first — the same keyboard
   * orbit vs. GSAP hand-off `resetToPreset` performs.
   */
  orbitBy(deltaTheta: number, deltaPhi: number): void {
    if (this.isTourActive) this.tour.cancel();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += deltaTheta;
    spherical.phi += deltaPhi;
    // `phi` additionally avoids exactly 0, where the camera's up-vector becomes degenerate and the
    // view flips.
    spherical.phi = Math.min(Math.max(spherical.phi, 0.05), this.controls.maxPolarAngle);
    spherical.radius = Math.min(Math.max(spherical.radius, this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(offset.setFromSpherical(spherical).add(this.controls.target));
    this.controls.update();
  }

  /** Dollies by `deltaMeters` (positive moves away from the target), clamped to the distance limits. */
  dollyBy(deltaMeters: number): void {
    // Its own small spherical round-trip rather than a call through `orbitBy(0, 0)`: dolly has no
    // angular component, and writing it out directly keeps the intent ("change radius only")
    // legible at the call site instead of implying an orbit happened.
    if (this.isTourActive) this.tour.cancel();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.radius = Math.min(Math.max(spherical.radius + deltaMeters, this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(offset.setFromSpherical(spherical).add(this.controls.target));
    this.controls.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tour.dispose();
    this.controls.dispose();
  }
}
