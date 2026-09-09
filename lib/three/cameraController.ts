import * as THREE from "three";
import gsap from "gsap";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraPresetConfig } from "../types/vehicle";
import { motionDuration, prefersReducedMotion } from "./motionPreference";
import { createCinematicTour, type CinematicTour, type TourStatus } from "./cinematicTour";

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

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly tour: CinematicTour;
  private readonly limits: CameraControllerLimits;
  private readonly onAutoRotateChange?: (enabled: boolean) => void;
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
  }

  get isTourActive(): boolean {
    return this.tour.status !== "idle";
  }

  get tourStatus(): TourStatus {
    return this.tour.status;
  }

  playTour(): void {
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
  }

  update(): void {
    this.controls.update();
  }

  setAspect(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  transitionToPreset(preset: CameraPresetConfig): void {
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
    this.setAutoRotate(false);
    if (this.isTourActive) this.tour.cancel();
    this.activePresetId = preset.id;
    this.camera.position.set(...preset.position);
    this.controls.target.set(...preset.target);
    this.controls.update();
  }

  orbitBy(deltaTheta: number, deltaPhi: number): void {
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
    this.setAutoRotate(false);
    if (this.isTourActive) this.tour.cancel();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.radius = Math.min(Math.max(spherical.radius + deltaMeters, this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(offset.setFromSpherical(spherical).add(this.controls.target));
    this.controls.update();
  }

  focusPoint(center: readonly [number, number, number], radius: number, padding = DEFAULT_FOCUS_PADDING): void {
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.tour.dispose();
    this.controls.dispose();
  }
}
