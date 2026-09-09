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
 * `focusPoint` (Priority 4) is the one method here that is not a pure extraction — nothing in the
 * pre-Priority-3 `VehicleCanvas.tsx` moved the camera to frame an arbitrary world-space point, only
 * to fixed catalog presets. It exists specifically so `docs/AGENT_API.md`'s documented "next
 * evolution" seam — `agentApi.mutate.camera.focusPart(id)` composing `scene.focusPart`'s bounding
 * data with a real camera move — has real camera-side behavior to call, per the mission's explicit
 * requirement that `VehicleSceneAgentApi` reuse `scene.focusPart` rather than reimplement bounding
 * math on the camera side.
 *
 * What this class still does NOT do: no rendering (the renderer/render loop stay in
 * `VehicleCanvas.tsx` until Priority 6), no reading of `Vehicle3DConfig` or any other application
 * type beyond the preset shape itself, no knowledge of the agent API or React at all — `getState`/
 * `getPresets` return plain data for *any* caller, not because this module knows about
 * `VehicleSceneAgentApi` specifically.
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
/** Seconds for a `focusPoint` move — same feel as a preset transition, not a separate constant. */
const FOCUS_TRANSITION_SECONDS = PRESET_TRANSITION_SECONDS;
/** Multiplies the bounding-sphere radius when choosing a framing distance in `focusPoint` — enough
 * headroom that the part doesn't touch the viewport edges, not so much it reads as "zoomed out". */
const DEFAULT_FOCUS_PADDING = 1.6;

/** Plain, serializable camera state — the read-side shape `VehicleSceneAgentApi.read.getCameraState`
 * (Priority 4) hands to a caller, never a live `THREE.Camera`/`OrbitControls` reference. */
export interface CameraControllerState {
  position: [number, number, number];
  target: [number, number, number];
  /** The last preset explicitly transitioned/reset to (`transitionToPreset`/`resetToPreset`) —
   * unaffected by `orbitBy`/`dollyBy`/`focusPoint`, the same "active preset persists through manual
   * orbit" semantics the pre-extraction Home-key handler relied on (`cameraPresetRef.current`).
   * `undefined` only if constructed with a preset that itself has no `id` — never in practice,
   * since every real catalog preset does. */
  presetId: string | undefined;
  tourStatus: TourStatus;
}

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
  /** Full preset list as given, independent of the tour's own `resolveTourPresets`-filtered copy —
   * `getPresets()` and a by-id lookup (`VehicleSceneAgentApi.mutate.camera.setPreset`, Priority 4)
   * need the real catalog list, not the hero/wheels/interior shot order the tour walks. */
  private presets: readonly CameraPresetConfig[];
  private activePresetId: string | undefined;

  constructor(options: CameraControllerOptions) {
    this.limits = { ...DEFAULT_CAMERA_LIMITS, ...options.limits };
    this.presets = options.presets;
    this.activePresetId = options.initialPreset.id;

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

    /*
     * Touch mapping, stated rather than inherited.
     *
     * These happen to be OrbitControls' defaults today, which is exactly why they are written down:
     * a showroom's core gesture is "one finger turns the car, two fingers zoom", and leaving that
     * to a transitive dependency's defaults means a three upgrade can change the product's primary
     * interaction without anything in this repo mentioning it. `DOLLY_PAN` rather than `DOLLY_ROTATE`
     * because a two-finger twist that rolls the camera reads as a bug on a vehicle sitting on a
     * floor plane.
     */
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

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
    this.presets = presets;
    this.tour.setPresets(presets);
  }

  /** The full preset list as given to the constructor/`setPresets` — plain data, safe for any
   * caller (`VehicleSceneAgentApi.read.getCameraPresets`, Priority 4) to hand further outward. */
  getPresets(): readonly CameraPresetConfig[] {
    return this.presets;
  }

  /** Current pose, active preset, and tour status as plain data — no live camera/controls reference. */
  getState(): CameraControllerState {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      presetId: this.activePresetId,
      tourStatus: this.tour.status,
    };
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
    this.activePresetId = preset.id;
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
    this.activePresetId = preset.id;
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

  /**
   * Frames a world-space bounding sphere — `center`/`radius` from `VehicleSceneAgentApi.read.
   * focusPart` (`lib/agent/sceneApi.ts`, backed by `THREE.Box3.setFromObject` on the part's real
   * geometry). Keeps the camera's current viewing angle (spherical theta/phi about the target) and
   * only changes distance and target, so this reframes on the part rather than reorienting the
   * whole shot — a `resetToPreset`-style angle jump would be jarring for "show me this part" versus
   * "show me this angle".
   *
   * Distance is chosen so the sphere fits the vertical FOV with `padding` headroom, clamped to the
   * same distance limits every other move respects, and moved to via the same GSAP tween
   * `transitionToPreset` uses (reduced-motion aware). Does not change `activePresetId` — focusing a
   * part is not "picking a different preset", the same way `orbitBy`/`dollyBy` leave it alone.
   */
  focusPoint(center: readonly [number, number, number], radius: number, padding = DEFAULT_FOCUS_PADDING): void {
    if (this.isTourActive) this.tour.cancel();

    const target = new THREE.Vector3(...center);
    const verticalFovRadians = THREE.MathUtils.degToRad(this.camera.fov);
    // A radius of 0 (a part with degenerate/point-like bounds) still needs a real, clamped distance
    // rather than collapsing onto the target — `Math.max(radius, 0.01)` keeps the framing math
    // meaningful instead of dividing toward zero.
    const distance = THREE.MathUtils.clamp(
      Math.max(radius, 0.01) * padding / Math.sin(verticalFovRadians / 2),
      this.controls.minDistance,
      this.controls.maxDistance,
    );

    const currentOffset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(currentOffset);
    spherical.radius = distance;
    const newPosition = target.clone().add(new THREE.Vector3().setFromSpherical(spherical));

    const duration = motionDuration(FOCUS_TRANSITION_SECONDS);
    gsap.to(this.camera.position, { x: newPosition.x, y: newPosition.y, z: newPosition.z, duration, ease: "power3.inOut" });
    gsap.to(this.controls.target, { x: target.x, y: target.y, z: target.z, duration, ease: "power3.inOut" });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tour.dispose();
    this.controls.dispose();
  }
}
