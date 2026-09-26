import * as THREE from "three";
import type { DimensionSpec } from "../showroom/dimensionSpecs";

export type { DimensionSpec };

/**
 * Dimensions overlay: overall length, width and height drawn onto the vehicle as measurement lines,
 * labelled with the catalog's published figures.
 *
 * Two different sources on purpose. The *lines* come from the loaded model's own bounds, so they sit
 * exactly on the vehicle on screen; the *numbers* come from the catalog specs, which are the figures
 * a buyer can quote. Where the two disagree by more than `SCALE_TOLERANCE`, `scaleMismatch` says so —
 * the same check that has to pass before AR placement can claim true scale.
 */

export interface DimensionLabel {
  key: DimensionSpec["key"];
  text: string;
  /** World-space anchor for the DOM label. */
  anchor: THREE.Vector3;
}

const INCHES_PER_METER = 39.3701;
/** Relative disagreement above which the model's scale is reported as off. */
export const SCALE_TOLERANCE = 0.08;

export function formatDimension(inches: number): string {
  const mm = Math.round((inches / INCHES_PER_METER) * 1000);
  return `${inches.toFixed(1)} in · ${mm.toLocaleString("en-US")} mm`;
}

/**
 * Relative error of the model's measured extents against the catalog's, per dimension that has a
 * catalog figure. Positive = model larger than the real vehicle.
 */
export function scaleMismatch(bounds: THREE.Box3, specs: readonly DimensionSpec[]): Partial<Record<DimensionSpec["key"], number>> {
  const size = bounds.getSize(new THREE.Vector3());
  const measured: Record<DimensionSpec["key"], number> = { length: size.z, width: size.x, height: size.y };
  const out: Partial<Record<DimensionSpec["key"], number>> = {};
  for (const spec of specs) {
    if (spec.inches === undefined) continue;
    const real = spec.inches / INCHES_PER_METER;
    out[spec.key] = measured[spec.key] / real - 1;
  }
  return out;
}

/**
 * Builds the measurement lines (a `THREE.Group` to add to the scene) and the label anchors. Lines
 * run along the floor for length and width, and up the front corner for height, offset slightly
 * off the body so they never z-fight with it. The showroom frame puts the nose at −Z.
 *
 * Only dimensions the catalog publishes are drawn. The model's own extents are not a stand-in for a
 * missing figure: they include mirrors (published widths exclude them) and whatever runtime parts
 * are mounted, so a measured "width" can be 20 cm off while looking authoritative.
 */
export function buildDimensionsOverlay(bounds: THREE.Box3, specs: readonly DimensionSpec[]): { group: THREE.Group; labels: DimensionLabel[] } {
  const size = bounds.getSize(new THREE.Vector3());
  const gap = Math.max(size.x, size.z) * 0.06;
  const floor = bounds.min.y + 0.005;
  const { min, max } = bounds;

  const lengthA = new THREE.Vector3(max.x + gap, floor, min.z);
  const lengthB = new THREE.Vector3(max.x + gap, floor, max.z);
  const widthA = new THREE.Vector3(min.x, floor, min.z - gap);
  const widthB = new THREE.Vector3(max.x, floor, min.z - gap);
  const heightA = new THREE.Vector3(max.x + gap, bounds.min.y, min.z - gap);
  const heightB = new THREE.Vector3(max.x + gap, max.y, min.z - gap);

  const segments: Record<DimensionSpec["key"], [THREE.Vector3, THREE.Vector3]> = {
    length: [lengthA, lengthB],
    width: [widthA, widthB],
    height: [heightA, heightB],
  };
  const published = specs.filter((spec): spec is DimensionSpec & { inches: number } => spec.inches !== undefined);

  const group = new THREE.Group();
  group.name = "DIMENSIONS_OVERLAY";
  const labels: DimensionLabel[] = [];
  if (published.length === 0) return { group, labels };

  const points = published.flatMap((spec) => segments[spec.key]);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: "#ff6b6b", depthTest: false, transparent: true, opacity: 0.9, toneMapped: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 10;
  lines.raycast = () => {};
  group.add(lines);

  for (const spec of published) {
    const [a, b] = segments[spec.key];
    labels.push({ key: spec.key, text: `${spec.label} ${formatDimension(spec.inches)}`, anchor: a.clone().lerp(b, 0.5) });
  }
  return { group, labels };
}

export function disposeDimensionsOverlay(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  group.removeFromParent();
}
