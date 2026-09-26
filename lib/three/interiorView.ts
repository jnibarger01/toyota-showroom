import * as THREE from "three";
import { VEHICLE_FORWARD, VEHICLE_UP } from "./showroomFrame";

/**
 * The driver's-seat view: the camera at the driver's eye, looking out through the windscreen, with
 * drag / arrow keys turning the head rather than orbiting the car.
 *
 * `OrbitControls` cannot do this — it always orbits a target, so "look left" would swing the
 * camera's position around a point ahead of it. This is a small yaw/pitch camera of its own, active
 * only while the view is on; `CameraController` hands the camera over and takes it back.
 *
 * Offered only for vehicles whose config names a steering wheel (`threeDConfig.driverView`) — a
 * body-shell capture like the RAV4 would put the viewer inside an empty hull, which reads as broken
 * rather than as a feature.
 */

/** Where a seated driver's eyes sit relative to the steering-wheel hub, in metres: behind it and
 * above it. Close to the SAE 95th-percentile eyellipse for both sedans and sports cars; the wheel is
 * what moves between them, which is why the eye is placed from it rather than from the body. */
export const EYE_BEHIND_WHEEL = 0.5;
export const EYE_ABOVE_WHEEL = 0.3;

/**
 * The driver's eye, from the steering wheel's world bounds in the showroom frame (nose −Z). An
 * earlier version derived it from the body's overall bounds by proportion; that put the eye in the
 * Camry's dashboard and on the Supra's bonnet — cabins sit too differently in their bodies. The
 * wheel also settles which side the driver is on, left- or right-hand drive, without a flag.
 */
export function driverEyeFromSteeringWheel(wheelBounds: THREE.Box3): THREE.Vector3 {
  return wheelBounds
    .getCenter(new THREE.Vector3())
    .addScaledVector(VEHICLE_FORWARD, -EYE_BEHIND_WHEEL)
    .addScaledVector(VEHICLE_UP, EYE_ABOVE_WHEEL);
}

/** Head-turn limits: a real driver can look well over a shoulder, but not straight up or down. */
export const MAX_YAW = THREE.MathUtils.degToRad(120);
export const MAX_PITCH = THREE.MathUtils.degToRad(50);
/** Radians of head turn per pixel of drag. */
const DRAG_RADIANS_PER_PX = 0.004;

export class DriverLook {
  yaw = 0;
  pitch = THREE.MathUtils.degToRad(-6); // eyes on the road, slightly down, as a driver sits

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly eye: THREE.Vector3,
  ) {}

  /** Positions and aims the camera for the current yaw/pitch. */
  apply(): void {
    this.camera.position.copy(this.eye);
    const direction = VEHICLE_FORWARD.clone()
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.camera.lookAt(this.eye.clone().add(direction));
  }

  turnBy(deltaYaw: number, deltaPitch: number): void {
    this.yaw = THREE.MathUtils.clamp(this.yaw + deltaYaw, -MAX_YAW, MAX_YAW);
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaPitch, -MAX_PITCH, MAX_PITCH);
    this.apply();
  }

  /** Pointer drag in pixels → head turn. Dragging right looks right, as in every first-person viewer. */
  dragBy(dxPx: number, dyPx: number): void {
    this.turnBy(-dxPx * DRAG_RADIANS_PER_PX, -dyPx * DRAG_RADIANS_PER_PX);
  }
}
