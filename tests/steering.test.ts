import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FrontWheelSteer, steerAngleForPreset } from "../lib/three/steering";

/** A wheel whose origin is NOT at its centre — the case that makes pivoting about bounds necessary. */
function vehicleWithOffsetWheel() {
  const root = new THREE.Group();
  root.rotation.y = Math.PI; // prepareVehicleRoot turns every vehicle around
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3).translate(1.2, 0.4, 1.5), new THREE.MeshBasicMaterial());
  wheel.name = "FRONT_LEFT";
  root.add(wheel);
  root.updateWorldMatrix(true, true);
  return { root, wheel };
}

const centreOf = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

describe("FrontWheelSteer", () => {
  it("turns a wheel in place, about its own centre, even when its origin is elsewhere", () => {
    const { root, wheel } = vehicleWithOffsetWheel();
    const before = centreOf(wheel);
    const steer = new FrontWheelSteer(root, ["FRONT_LEFT", "MISSING"]);
    expect(steer.wheelCount).toBe(1);
    steer.setAngle(THREE.MathUtils.degToRad(18));
    root.updateWorldMatrix(true, true);
    expect(centreOf(wheel).distanceTo(before)).toBeLessThan(0.02);
    expect(wheel.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(THREE.MathUtils.degToRad(18), 4);
  });

  it("returns exactly to the rest pose at zero", () => {
    const { root, wheel } = vehicleWithOffsetWheel();
    const restPosition = wheel.position.clone();
    const steer = new FrontWheelSteer(root, ["FRONT_LEFT"]);
    steer.setAngle(0.4);
    steer.setAngle(0);
    expect(wheel.position.distanceTo(restPosition)).toBeLessThan(1e-9);
    expect(wheel.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });

  it("steers only on the hero preset, and only when the vehicle configures it", () => {
    expect(steerAngleForPreset("hero", 18)).toBeCloseTo(THREE.MathUtils.degToRad(18));
    expect(steerAngleForPreset("side", 18)).toBe(0);
    expect(steerAngleForPreset("hero", undefined)).toBe(0);
  });
});
