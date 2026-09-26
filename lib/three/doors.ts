import * as THREE from "three";
import { findNodeByName } from "./nodes";
import { RigidPivot, VEHICLE_RIGHT, VEHICLE_UP, worldBoundsOf } from "./showroomFrame";
import type { DoorSpec } from "../types/vehicle";

/**
 * Opening doors, tailgates and boot lids on assets that model them as separate geometry.
 *
 * No asset in this catalog ships hinge metadata or animation, so the hinge is derived from the
 * geometry and the showroom frame (`showroomFrame.ts`):
 *
 * - a **side door** hinges on its front edge (the edge furthest toward −Z), on its outer face, about
 *   the vertical axis;
 * - a **boot lid / tailgate** hinges on its top edge, about the vehicle's lateral axis.
 *
 * Which way is "open" is decided the same way a person would check it: of the two rotation
 * directions, the one that swings the panel *away* from the body — outward for a door, upward for a
 * lid. That makes the rig independent of each asset's local axes and winding, which vary across
 * this catalog (FBX, Blender and Sketchfab exports).
 *
 * Only vehicles whose `threeDConfig.doors` names real door geometry get the control; the 4Runner's
 * scene map forward-declares doors its GLB does not model, and those stay unoffered.
 */

export type { DoorKind, DoorSpec } from "../types/vehicle";

function nodesForSpec(root: THREE.Object3D, spec: DoorSpec): THREE.Object3D[] {
  if (spec.nodeNames?.length) {
    return spec.nodeNames.map((name) => findNodeByName(root, name)).filter((node): node is THREE.Object3D => Boolean(node));
  }
  if (!spec.nodePrefix) return [];
  const prefixes = [spec.nodePrefix, THREE.PropertyBinding.sanitizeNodeName(spec.nodePrefix)];
  const matches = (object: THREE.Object3D) => prefixes.some((prefix) => object.name.startsWith(prefix));
  const found: THREE.Object3D[] = [];
  root.traverse((object) => {
    // Topmost matches only: rotating a node and then its matching child again would double-turn it.
    if (!matches(object)) return;
    let ancestor = object.parent;
    while (ancestor && ancestor !== root) {
      if (matches(ancestor)) return;
      ancestor = ancestor.parent;
    }
    found.push(object);
  });
  return found;
}

interface RiggedDoor {
  spec: DoorSpec;
  pivot: RigidPivot;
  openRadians: number;
}

export class DoorRig {
  private readonly doors: RiggedDoor[] = [];
  private amount = 0;

  /** Captures every configured door at rest. Call once the root is placed and grounded. */
  constructor(root: THREE.Object3D, specs: readonly DoorSpec[]) {
    root.updateWorldMatrix(true, true);
    const bodyCenter = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());

    for (const spec of specs) {
      const nodes = nodesForSpec(root, spec);
      if (nodes.length === 0) continue;
      const box = worldBoundsOf(nodes);
      if (box.isEmpty()) continue;
      const center = box.getCenter(new THREE.Vector3());

      let hinge: THREE.Vector3;
      let axis: THREE.Vector3;
      if (spec.kind === "side") {
        const outerX = center.x >= bodyCenter.x ? box.max.x : box.min.x;
        hinge = new THREE.Vector3(outerX, center.y, box.min.z);
        axis = VEHICLE_UP.clone();
      } else {
        hinge = new THREE.Vector3(center.x, box.max.y, center.z >= bodyCenter.z ? box.min.z : box.max.z);
        axis = VEHICLE_RIGHT.clone();
      }

      const magnitude = THREE.MathUtils.degToRad(spec.openDegrees ?? (spec.kind === "side" ? 62 : 70));
      const pivot = new RigidPivot(nodes, hinge, axis);
      const openRadians = pickOpeningDirection(center, hinge, axis, magnitude, (moved) =>
        spec.kind === "side" ? Math.abs(moved.x - bodyCenter.x) : moved.y,
      );
      this.doors.push({ spec, pivot, openRadians });
    }
  }

  /** The doors this vehicle actually has, for the chrome to offer. */
  get available(): ReadonlyArray<Pick<DoorSpec, "id" | "label" | "kind">> {
    return this.doors.map(({ spec }) => ({ id: spec.id, label: spec.label, kind: spec.kind }));
  }

  get openAmount(): number {
    return this.amount;
  }

  /** 0 = closed, 1 = fully open; every door together. */
  setOpenAmount(amount: number): void {
    this.amount = THREE.MathUtils.clamp(amount, 0, 1);
    for (const door of this.doors) door.pivot.setAngle(door.openRadians * this.amount);
  }
}

/**
 * Signed opening angle: tries both directions on the panel's centre and keeps the one that scores
 * higher (further from the body's centre line for a door, higher for a lid).
 */
export function pickOpeningDirection(
  center: THREE.Vector3,
  hinge: THREE.Vector3,
  axis: THREE.Vector3,
  magnitude: number,
  score: (movedCenter: THREE.Vector3) => number,
): number {
  const swing = (radians: number) =>
    center.clone().sub(hinge).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, radians)).add(hinge);
  return score(swing(magnitude)) >= score(swing(-magnitude)) ? magnitude : -magnitude;
}
