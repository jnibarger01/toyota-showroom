import * as THREE from "three";
import gsap from "gsap";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraPresetConfig } from "../types/vehicle";
import { motionDuration, prefersReducedMotion } from "./motionPreference";
import { createCinematicTour, type CinematicTour, type TourStatus } from "./cinematicTour";
import { publishViewerState, subscribeViewerControl } from "./viewerControlEvents";

/** Driver's-seat lens: see `enterDriverView`. */
export const DRIVER_FOV = 72;
export const DRIVER_NEAR = 0.01;
import { DriverLook } from "./interiorView";

export type { TourStatus };

export interface CameraControllerLimits {
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
}

export const DEFAULT_CAMERA_LIMITS: CameraControllerLimits = {
  minDistance: 4,
  maxDistance: 15,
  maxPolarAngle: Math.PI * 0.49,
};

export interface CameraControllerOptions {
  domElement: HTMLElement;
  initialPreset: CameraPresetConfig;
  presets: readonly CameraPresetConfig[];
  limits?: Partial<CameraControllerLimits>;
  fov?: number;
  near?: number;
  far?: number;
  onTourStatusChange?: (status: TourStatus) => void;
  onTourStep?: (preset: CameraPresetConfig, index: number) => void;
  onAutoRotateChange?: (enabled: boolean) => void;
}

const PRESET_TRANSITION_SECONDS = 0.85;
const FOCUS_TRANSITION_SECONDS = PRESET_TRANSITION_SECONDS;
const DEFAULT_FOCUS_PADDING = 1.6;

export interface CameraControllerState {
  position: [number, number, number];
  target: [number, number, number];
  presetId: string | undefined;
  tourStatus: TourStatus;
  autoRotate: boolean;
}

export const KEYBOARD_ORBIT_STEP_RADIANS = 0.12;
export const KEYBOARD_ZOOM_STEP = 0.6;

/** OrbitControls desktop defaults — kept explicit so a three upgrade cannot silently change feel. */
export const DESKTOP_DAMPING_FACTOR = 0.05;
export const DESKTOP_ROTATE_SPEED = 1.0;
export const DESKTOP_ZOOM_SPEED = 1.0;

/**
 * Mobile inertia / gesture speeds.
 *
 * Touch deltas are larger and more abrupt than mouse deltas. The stock `dampingFactor` of 0.05
 * leaves the vehicle coasting for too long after a finger lifts, which reads as lag rather than
 * weight on a phone. A higher factor settles sooner while still keeping a short inertia tail.
 * Slightly lower rotate/zoom speeds compensate for the larger per-frame touch deltas so one-finger
 * orbit and two-finger pinch feel comparable to desktop mouse drag / wheel.
 */
export const MOBILE_DAMPING_FACTOR = 0.1;
export const MOBILE_ROTATE_SPEED = 0.85;
export const MOBILE_ZOOM_SPEED = 0.9;

/**
 * Primary pointing device is a finger (phones / tablets). Prefer `(pointer: coarse)` over UA
 * sniffing; fall back to `maxTouchPoints` only when matchMedia is unavailable (older tests).
 */
export function prefersCoarsePointer(): boolean {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(pointer: coarse)").matches;
  }
  if (typeof navigator !== "undefined") {
    return (navigator.maxTouchPoints ?? 0) > 1;
  }
  return false;
}

/** Framing range for `focusOnPick`, in metres of part radius. */
export const FOCUS_PICK_MIN_RADIUS = 0.35;
export const FOCUS_PICK_MAX_RADIUS = 1.1;

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly tour: CinematicTour;
  private readonly limits: CameraControllerLimits;
  private readonly onAutoRotateChange?: (enabled: boolean) => void;
  private readonly unsubscribeViewerControl: () => void;
  private disposed = false;
  private presets: readonly CameraPresetConfig[];
  private activePresetId: string | undefined;

  private readonly handleControlsStart = (): void => {
    if (this.controls.autoRotate) this.setAutoRotate(false);
  };

  constructor(options: CameraControllerOptions) {
    this.limits = { ...DEFAULT_CAMERA_LIMITS, ...options.limits };
    this.presets = options.presets;
    this.activePresetId = options.initialPreset.id;
    this.onAutoRotateChange = options.onAutoRotateChange;

    this.camera = new THREE.PerspectiveCamera(options.fov ?? 38, 1, options.near ?? 0.05, options.far ?? 100);
    this.camera.position.set(...options.initialPreset.position);

    this.controls = new OrbitControls(this.camera, options.domElement);
    this.controls.enableDamping = !prefersReducedMotion();
    this.controls.minDistance = this.limits.minDistance;
    this.controls.maxDistance = this.limits.maxDistance;
    this.controls.maxPolarAngle = this.limits.maxPolarAngle;
    // Wheel/pinch zoom dollies toward what is under the cursor rather than the orbit target, so
    // zooming at a wheel or a badge actually gets closer to it instead of to the car's centre.
    this.controls.zoomToCursor = true;

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

    /*
     * Inertia / speed tuned for the primary pointer. Coarse (touch) devices get a snappier
     * dampingFactor and slightly gentler rotate/zoom speeds — see MOBILE_* constants above.
     * Reduced-motion already disabled damping entirely; the factor is still set so a later
     * preference flip mid-session (rare) would resume with the right feel.
     */
    const coarse = prefersCoarsePointer();
    this.controls.dampingFactor = coarse ? MOBILE_DAMPING_FACTOR : DESKTOP_DAMPING_FACTOR;
    this.controls.rotateSpeed = coarse ? MOBILE_ROTATE_SPEED : DESKTOP_ROTATE_SPEED;
    this.controls.zoomSpeed = coarse ? MOBILE_ZOOM_SPEED : DESKTOP_ZOOM_SPEED;

    this.controls.target.set(...options.initialPreset.target);
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.addEventListener("start", this.handleControlsStart);

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

    this.unsubscribeViewerControl = subscribeViewerControl((action) => {
      switch (action) {
        case "zoom-in":
          this.dollyBy(-KEYBOARD_ZOOM_STEP);
          break;
        case "zoom-out":
          this.dollyBy(KEYBOARD_ZOOM_STEP);
          break;
        case "reset-camera": {
          const preset = this.presets.find((item) => item.id === this.activePresetId) ?? this.presets[0];
          if (preset) this.resetToPreset(preset);
          break;
        }
        case "toggle-auto-rotate":
          this.setAutoRotate(!this.controls.autoRotate);
          break;
      }
    });
  }

  get isTourActive(): boolean {
    return this.tour.status !== "idle";
  }

  get tourStatus(): TourStatus {
    return this.tour.status;
  }

  playTour(): void {
    // The tour flies OrbitControls' camera; from the seat it would fly a camera that `update()`
    // no longer drives, with the cabin lens still on.
    this.leaveDriverSeat();
    this.setAutoRotate(false);
    this.tour.play();
  }

  pauseTour(): void {
    this.tour.pause();
  }

  cancelTour(): void {
    this.tour.cancel();
  }

  setPresets(presets: readonly CameraPresetConfig[]): void {
    this.presets = presets;
    this.tour.setPresets(presets);
  }

  getPresets(): readonly CameraPresetConfig[] {
    return this.presets;
  }

  getState(): CameraControllerState {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      presetId: this.activePresetId,
      tourStatus: this.tour.status,
      autoRotate: this.controls.autoRotate,
    };
  }

  setAutoRotate(enabled: boolean): void {
    if (this.controls.autoRotate === enabled) return;
    if (enabled && this.isTourActive) this.tour.cancel();
    this.controls.autoRotate = enabled;
    this.onAutoRotateChange?.(enabled);
    publishViewerState({ autoRotate: enabled });
  }

  /**
   * Enables or disables `OrbitControls`.
   *
   * Exists for XR (#16): while an immersive session is presenting, the device owns the camera pose
   * completely, and orbit input writing to the same camera fights head tracking — which reads as
   * motion sickness, not as a camera bug. The cinematic tour already takes the controls this way
   * for the same reason (via its own `setControlsEnabled` seam); this exposes it to a second caller
   * rather than giving XR a private path to the same field.
   */
  setControlsEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** Non-null while the driver's-seat view owns the camera. See `enterDriverView`. */
  private driverLook: DriverLook | null = null;
  private driverDrag: { x: number; y: number } | null = null;
  /** The showroom lens, restored on leaving the driver's seat. */
  private showroomLens: { fov: number; near: number } | null = null;
  private readonly handleDriverPointerDown = (event: PointerEvent) => {
    this.driverDrag = { x: event.clientX, y: event.clientY };
  };
  private readonly handleDriverPointerMove = (event: PointerEvent) => {
    if (!this.driverDrag || !this.driverLook) return;
    this.driverLook.dragBy(event.clientX - this.driverDrag.x, event.clientY - this.driverDrag.y);
    this.driverDrag = { x: event.clientX, y: event.clientY };
  };
  private readonly handleDriverPointerUp = () => {
    this.driverDrag = null;
  };

  get isDriverView(): boolean {
    return this.driverLook !== null;
  }

  /**
   * Puts the camera at `eye`, looking forward out of the vehicle, and turns pointer drag into head
   * turns. `OrbitControls` is disabled for the duration rather than fought with: it would keep
   * re-deriving the pose from its own target on every `update()`.
   */
  enterDriverView(eye: THREE.Vector3): void {
    if (this.isTourActive) this.tour.cancel();
    this.setAutoRotate(false);
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.controls.enabled = false;
    // The showroom's long lens, from a metre off the dash, frames one switch. A cabin wants a wide
    // lens (roughly what a driver takes in without turning their head) and a near plane short
    // enough that the A-pillars and wheel rim a few centimetres away are not clipped.
    this.showroomLens ??= { fov: this.camera.fov, near: this.camera.near };
    this.camera.fov = DRIVER_FOV;
    this.camera.near = DRIVER_NEAR;
    this.camera.updateProjectionMatrix();
    this.driverLook = new DriverLook(this.camera, eye);
    this.driverLook.apply();
    const element = this.controls.domElement as HTMLElement;
    element.addEventListener("pointerdown", this.handleDriverPointerDown);
    element.addEventListener("pointermove", this.handleDriverPointerMove);
    element.addEventListener("pointerup", this.handleDriverPointerUp);
    element.addEventListener("pointerleave", this.handleDriverPointerUp);
  }

  /** Follows the vehicle while seated: the eye is re-placed each frame from the vehicle's pose. */
  moveDriverEye(eye: THREE.Vector3): void {
    this.driverLook?.moveEye(eye);
  }

  /** Leaves the driver's seat, back to `preset`'s framing. */
  exitDriverView(preset?: CameraPresetConfig): void {
    if (!this.leaveDriverSeat()) return;
    const target = preset ?? this.presets.find((item) => item.id === this.activePresetId) ?? this.presets[0];
    if (target) this.resetToPreset(target);
  }

  /** Hands the camera back to OrbitControls with the showroom lens, without re-framing. */
  private leaveDriverSeat(): boolean {
    if (!this.driverLook) return false;
    this.driverLook = null;
    this.driverDrag = null;
    const element = this.controls.domElement as HTMLElement;
    element.removeEventListener("pointerdown", this.handleDriverPointerDown);
    element.removeEventListener("pointermove", this.handleDriverPointerMove);
    element.removeEventListener("pointerup", this.handleDriverPointerUp);
    element.removeEventListener("pointerleave", this.handleDriverPointerUp);
    this.controls.enabled = true;
    if (this.showroomLens) {
      this.camera.fov = this.showroomLens.fov;
      this.camera.near = this.showroomLens.near;
      this.camera.updateProjectionMatrix();
      this.showroomLens = null;
    }
    return true;
  }

  update(): void {
    // The driver view aims the camera itself; OrbitControls must not re-derive it from its target.
    if (this.driverLook) return;
    this.controls.update();
  }

  setAspect(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  transitionToPreset(preset: CameraPresetConfig): void {
    // Picking a camera angle is a request to leave the seat.
    if (this.driverLook) this.exitDriverView(preset);
    this.setAutoRotate(false);
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

  resetToPreset(preset: CameraPresetConfig): void {
    if (this.driverLook) {
      this.exitDriverView(preset);
      return;
    }
    this.setAutoRotate(false);
    if (this.isTourActive) this.tour.cancel();
    this.activePresetId = preset.id;
    this.camera.position.set(...preset.position);
    this.controls.target.set(...preset.target);
    this.controls.update();
  }

  orbitBy(deltaTheta: number, deltaPhi: number): void {
    // Arrow keys look around from the driver's seat instead of orbiting the car.
    if (this.driverLook) {
      this.driverLook.turnBy(-deltaTheta, -deltaPhi);
      return;
    }
    this.setAutoRotate(false);
    if (this.isTourActive) this.tour.cancel();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += deltaTheta;
    spherical.phi += deltaPhi;
    spherical.phi = Math.min(Math.max(spherical.phi, 0.05), this.controls.maxPolarAngle);
    spherical.radius = Math.min(Math.max(spherical.radius, this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(offset.setFromSpherical(spherical).add(this.controls.target));
    this.controls.update();
  }

  dollyBy(deltaMeters: number): void {
    if (this.driverLook) return; // the driver's head does not zoom
    this.setAutoRotate(false);
    if (this.isTourActive) this.tour.cancel();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.radius = Math.min(Math.max(spherical.radius + deltaMeters, this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(offset.setFromSpherical(spherical).add(this.controls.target));
    this.controls.update();
  }

  focusPoint(center: readonly [number, number, number], radius: number, padding = DEFAULT_FOCUS_PADDING): void {
    if (this.driverLook) return;
    this.setAutoRotate(false);
    if (this.isTourActive) this.tour.cancel();

    const target = new THREE.Vector3(...center);
    const verticalFovRadians = THREE.MathUtils.degToRad(this.camera.fov);
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

  /**
   * Frames a picked point on the vehicle: `point` becomes the orbit target, and the distance fits a
   * sphere of `partRadius` clamped to a detail-shot range. Clamped because a part's bounds can be the
   * whole car (a material region lives on the full `BODY` mesh) — the viewer double-clicked a spot,
   * so the spot is what they want to see, not the part's entire extent.
   */
  focusOnPick(point: readonly [number, number, number], partRadius: number): void {
    this.focusPoint(point, THREE.MathUtils.clamp(partRadius, FOCUS_PICK_MIN_RADIUS, FOCUS_PICK_MAX_RADIUS));
  }

  dispose(): void {
    if (this.disposed) return;
    this.exitDriverView();
    this.disposed = true;
    this.unsubscribeViewerControl();
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.tour.dispose();
    this.controls.dispose();
  }
}
