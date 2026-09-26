import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FrontWheelSteer, steerAngleForPreset } from "../lib/three/steering";
import { buildWheelPackage } from "../lib/three/proceduralWheels";
import { WHEEL_PACKAGES } from "../lib/data/wheelPackages";

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

  it("also steers the front corners of procedural wheel packages, which sit outside the wheel nodes", () => {
    const root = new THREE.Group();
    const at = (x: number, z: number) => ({ position: new THREE.Vector3(x, 0.4, z), radius: 0.4, width: 0.28, side: (x > 0 ? 1 : -1) as 1 | -1 });
    // Nose at −Z: the z = −1.5 pair is the front axle.
    const pack = buildWheelPackage(WHEEL_PACKAGES[0]!, [at(-0.8, -1.5), at(0.8, -1.5), at(-0.8, 1.5), at(0.8, 1.5)]);
    root.add(pack);
    root.updateWorldMatrix(true, true);
    const steer = new FrontWheelSteer(root, []);
    expect(steer.wheelCount).toBe(4); // two front rim assemblies + their two tyres
    const tagged: THREE.Object3D[] = [];
    pack.traverse((object) => {
      if (object.userData.wheelPackageCorner) tagged.push(object);
    });
    const rest = tagged.map((object) => object.quaternion.clone());
    steer.setAngle(THREE.MathUtils.degToRad(-18));
    tagged.forEach((object, index) => {
      const turned = object.quaternion.angleTo(rest[index]!) > 0.1;
      expect(turned, `z=${object.position.z}`).toBe(object.position.z < 0);
    });
  });

  it("skips empty mounts and never turns a listed node that sits under another listed node", () => {
    const root = new THREE.Group();
    const emptyMount = new THREE.Group();
    emptyMount.name = "MOUNT_FRONT_LEFT"; // low tier: no authored wheel attached
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3), new THREE.MeshBasicMaterial());
    stock.name = "STOCK_FRONT_LEFT";
    stock.position.set(-0.8, 0.4, -1.5);
    const nestedTyre = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1), new THREE.MeshBasicMaterial());
    nestedTyre.name = "TYRE_FRONT_LEFT";
    stock.add(nestedTyre);
    root.add(emptyMount, stock);
    root.updateWorldMatrix(true, true);
    const steer = new FrontWheelSteer(root, ["MOUNT_FRONT_LEFT", "STOCK_FRONT_LEFT", "TYRE_FRONT_LEFT"]);
    expect(steer.wheelCount).toBe(1); // only the stock wheel; its tyre turns with it
    steer.setAngle(THREE.MathUtils.degToRad(20));
    expect(nestedTyre.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
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
