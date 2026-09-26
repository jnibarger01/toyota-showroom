import * as THREE from "three";

/**
 * The showroom's world-space convention for a placed vehicle: nose toward −Z, roof toward +Y, so
 * the vehicle's right-hand side is +X and a left-hand-drive driver sits on the −X side.
 *
 * Not a new assumption — every catalog vehicle's `front` camera preset already sits on the −Z axis
 * looking at the nose, and `prepareVehicleRoot` turns each asset into this pose. Writing it down once
 * lets the features that need a direction (door hinges, the driver's-seat view, the dimensions
 * overlay) share it instead of each guessing from asset-local axes, and
 * `tests/showroomFrame.test.ts` fails if a vehicle's presets ever stop agreeing with it.
 */
export const VEHICLE_FORWARD = new THREE.Vector3(0, 0, -1);
export const VEHICLE_UP = new THREE.Vector3(0, 1, 0);
export const VEHICLE_RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * Rotates a set of nodes rigidly about a world-space axis through a world-space point, from a
 * captured rest pose. Each node's pivot and axis are converted into its own parent's space once, at
 * capture, so the rig keeps working when the vehicle root is later moved (ride height) — the parent
 * moves with it.
 */
export class RigidPivot {
  private readonly parts: Array<{
    node: THREE.Object3D;
    baseQuaternion: THREE.Quaternion;
    basePosition: THREE.Vector3;
    pivot: THREE.Vector3;
    axis: THREE.Vector3;
  }> = [];

  constructor(nodes: readonly THREE.Object3D[], worldPivot: THREE.Vector3, worldAxis: THREE.Vector3) {
    for (const node of nodes) {
      const parent = node.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      const pivot = parent.worldToLocal(worldPivot.clone());
      const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());
      const axis = worldAxis.clone().applyQuaternion(parentWorld.invert()).normalize();
      this.parts.push({
        node,
        baseQuaternion: node.quaternion.clone(),
        basePosition: node.position.clone(),
        pivot,
        axis,
      });
    }
  }

  get size(): number {
    return this.parts.length;
  }

  setAngle(radians: number): void {
    for (const part of this.parts) {
      const turn = new THREE.Quaternion().setFromAxisAngle(part.axis, radians);
      part.node.quaternion.copy(turn).multiply(part.baseQuaternion);
      part.node.position.copy(part.basePosition).sub(part.pivot).applyQuaternion(turn).add(part.pivot);
    }
  }
}

/** World-space bounds of several nodes together. */
export function worldBoundsOf(nodes: readonly THREE.Object3D[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const node of nodes) box.expandByObject(node);
  return box;
}
