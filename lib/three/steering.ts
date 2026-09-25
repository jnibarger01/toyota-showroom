import * as THREE from "three";
import { findNodeByName } from "./nodes";

/**
 * Front-wheel steering for the hero shot.
 *
 * A car photographed with its front wheels turned toward the camera is the standard product pose:
 * it shows the wheel *face* — the thing a wheel option actually changes — instead of the tread.
 *
 * Steering rotates each front wheel node about the vehicle's vertical axis through the wheel's own
 * centre. The rotation is done about the node's world-space bounding-box centre rather than its
 * origin because asset authors put origins anywhere: a hub mount's origin is at the hub, but a tyre
 * mesh exported with an origin at the model's root would otherwise swing around the car instead of
 * turning in place. Everything parented under a wheel node (an authored rim, a mesh-replacement
 * wheel option) turns with it.
 */
export class FrontWheelSteer {
  private readonly wheels: Array<{
    node: THREE.Object3D;
    baseQuaternion: THREE.Quaternion;
    basePosition: THREE.Vector3;
    /** Wheel centre in the node's parent space — the steering pivot. */
    pivot: THREE.Vector3;
    /** World up expressed in the node's parent space — the steering axis. */
    axis: THREE.Vector3;
  }> = [];
  private angle = 0;

  /**
   * Captures each wheel's rest pose. Call after the root is placed and grounded (world matrices
   * current), before any steering is applied.
   */
  constructor(root: THREE.Object3D, nodeNames: readonly string[]) {
    root.updateWorldMatrix(true, true);
    for (const name of nodeNames) {
      const node = findNodeByName(root, name);
      const parent = node?.parent;
      if (!node || !parent) continue;
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) continue;
      const pivot = parent.worldToLocal(box.getCenter(new THREE.Vector3()));
      const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(parentWorld.invert()).normalize();
      this.wheels.push({
        node,
        baseQuaternion: node.quaternion.clone(),
        basePosition: node.position.clone(),
        pivot,
        axis,
      });
    }
  }

  /** How many of the named wheels resolved — zero means steering is a no-op for this vehicle. */
  get wheelCount(): number {
    return this.wheels.length;
  }

  get currentAngle(): number {
    return this.angle;
  }

  /** Steers to `radians` (positive = counter-clockwise seen from above), from the rest pose. */
  setAngle(radians: number): void {
    this.angle = radians;
    for (const wheel of this.wheels) {
      const turn = new THREE.Quaternion().setFromAxisAngle(wheel.axis, radians);
      wheel.node.quaternion.copy(turn).multiply(wheel.baseQuaternion);
      wheel.node.position.copy(wheel.basePosition).sub(wheel.pivot).applyQuaternion(turn).add(wheel.pivot);
    }
  }
}

/** The angle for a camera preset: the configured steer on the hero shot, straight ahead otherwise. */
export function steerAngleForPreset(presetId: string | undefined, degrees: number | undefined): number {
  if (!degrees || presetId !== "hero") return 0;
  return THREE.MathUtils.degToRad(degrees);
}
