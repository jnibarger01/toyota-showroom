import * as THREE from "three";
import { getWheelFitment, type VehicleWheelFitment, type WheelAnchorSource } from "../data/wheelFitment";
import { WHEEL_PACKAGES_BY_ID } from "../data/wheelPackages";
import { buildWheelPackage, type WheelFitment } from "./proceduralWheels";

/**
 * Measures a vehicle's running-gear fitment off the loaded scene and mounts every wheel package the
 * catalog offers for it, hidden.
 *
 * Runs after `prepareVehicleRoot` and alongside `buildProceduralAccessories`, for the same reason
 * those do: the catalog is verified against the loaded root immediately afterwards
 * (`verifyNodeContract`), so anything a customization option names has to already be in the graph
 * or the option is dropped from the served catalog.
 */
export function installProceduralWheelPackages(root: THREE.Object3D, vehicleId: string): string[] {
  const fitment = getWheelFitment(vehicleId);
  if (!fitment) return [];

  const corners = resolveCorners(root, fitment.anchors);
  if (corners.length !== 4) {
    // A missing anchor means the asset changed shape under the fitment data. Warn once, with the
    // vehicle attached, and mount nothing: a package built from two corners would be worse than the
    // catalog simply not offering wheel packages for this vehicle.
    console.warn(
      `[wheels] "${vehicleId}" wheel anchors could not be resolved; wheel packages are unavailable.`,
      { expected: 4, resolved: corners.length },
    );
    return [];
  }

  const installed: string[] = [];
  for (const packageId of fitment.packageIds) {
    const spec = WHEEL_PACKAGES_BY_ID.get(packageId);
    if (!spec) {
      console.warn(`[wheels] "${vehicleId}" references unknown wheel package "${packageId}".`);
      continue;
    }
    root.add(buildWheelPackage(spec, corners));
    installed.push(packageId);
  }
  return installed;
}

/** Exported for the fitment tests, which assert measured geometry rather than mounted nodes. */
export function resolveCorners(root: THREE.Object3D, anchors: WheelAnchorSource): WheelFitment[] {
  root.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();

  switch (anchors.kind) {
    case "fixed":
      return withSides(
        anchors.corners.map(([x, y, z]) =>
          corner(new THREE.Vector3(x, y, z), anchors.radius, anchors.width),
        ),
      );

    case "mount": {
      const fitments: WheelFitment[] = [];
      for (const name of anchors.nodeNames) {
        const node = root.getObjectByName(name);
        if (!node) continue;
        const position = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(toLocal);
        // The rig node's own height is not used: it is where the asset's author put a hub, not
        // where this scene's floor is. See `wheelFitment.ts`'s RAV4 entry.
        position.y = anchors.floorLocalY + anchors.radius;
        fitments.push(corner(position, anchors.radius, anchors.width));
      }
      return withSides(fitments);
    }

    case "corner": {
      const fitments: WheelFitment[] = [];
      for (const name of anchors.nodeNames) {
        const node = root.getObjectByName(name);
        if (!node) continue;
        const box = localBox(node, toLocal);
        if (!box || box.isEmpty()) continue;

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // The axle is always the wheel's smallest extent and the tyre diameter its largest — true
        // of all four assets measured this way, and independent of which axis the asset calls "up",
        // so no per-vehicle axis convention is needed.
        const radius = Math.max(size.x, size.y, size.z) / 2;
        const measuredWidth = Math.min(size.x, size.y, size.z);
        // Some stock "wheel" nodes bundle brake and suspension geometry into the same mesh, which
        // inflates the measured width well past any real tyre (the AE86's wheels measure 0.58 of
        // their own diameter). Clamping keeps such an asset from producing an absurdly fat tyre
        // while leaving a cleanly-modelled wheel — the 4Runner's, at 0.41 — untouched.
        fitments.push(corner(center, radius, Math.min(measuredWidth, radius * 0.9)));
      }
      return withSides(fitments);
    }
  }
}

function corner(position: THREE.Vector3, radius: number, width: number): WheelFitment {
  // `side` is filled in by `withSides`, which needs the whole set. Provisional until then.
  return { position, radius, width, side: 1 };
}

/**
 * Assigns each corner its side of the vehicle, relative to the *track's* centre line.
 *
 * Not the sign of the corner's own X: a model is not obliged to be centred on its own origin, and
 * the Land Cruiser is not — its wheels sit at x +0.591 and -1.095, so absolute X would have called
 * both of one axle's corners the same side on a model offset just a little further. The midpoint of
 * the measured corners is the track's centre line by construction, whatever the origin.
 */
function withSides(fitments: WheelFitment[]): WheelFitment[] {
  if (fitments.length === 0) return fitments;
  const xs = fitments.map((fitment) => fitment.position.x);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  return fitments.map((fitment) => ({ ...fitment, side: fitment.position.x >= centreX ? 1 : -1 }));
}

/**
 * Bounding box of `node`'s meshes expressed in the root's local space.
 *
 * `Box3.setFromObject` would give a *world*-space box, which for a root carrying the catalog's
 * `scale` (100x on the Camry and Supra) and `rotation` (always a half turn) is the wrong space to
 * place a child in. Composing each mesh's world matrix with the root's inverse converts once,
 * exactly, instead of dividing sizes by a scale afterwards and hoping it was uniform.
 */
function localBox(node: THREE.Object3D, toLocal: THREE.Matrix4): THREE.Box3 | null {
  const box = new THREE.Box3();
  const transform = new THREE.Matrix4();
  let found = false;

  node.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.geometry) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const geometryBox = object.geometry.boundingBox;
    if (!geometryBox) return;
    transform.multiplyMatrices(toLocal, object.matrixWorld);
    box.union(geometryBox.clone().applyMatrix4(transform));
    found = true;
  });

  return found ? box : null;
}

/** Test/debug helper: the fitment a vehicle would be measured at, without mounting anything. */
export function measureFitment(root: THREE.Object3D, fitment: VehicleWheelFitment): WheelFitment[] {
  return resolveCorners(root, fitment.anchors);
}
