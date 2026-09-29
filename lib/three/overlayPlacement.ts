import * as THREE from "three";
import { projectToScreen } from "./hotspots";

/**
 * The DOM half of the per-frame overlay pass: where a hotspot button or a dimension label goes on
 * the canvas, and — the part this module exists for — whether writing that placement to the element
 * is worth doing at all.
 *
 * `VehicleCanvas`'s `updateOverlays` runs on every painted frame, and every overlay element's
 * position is derived from a world-space anchor through the live camera. In a still view those
 * derivations produce the same two values frame after frame, so an unconditional write is a
 * style-invalidation per element per frame — ~11 elements at 60fps, several hundred no-op style
 * writes a second, all of which the browser has to flush before it can paint. Assigning a value a
 * CSS property already holds still dirties that element's style; the write is the cost, not the
 * value. Comparing first makes a still view cost nothing, and a moving one cost exactly the writes
 * whose value changed.
 *
 * Reading `element.style.transform` back to compare is deliberate rather than caching the last
 * written string in a module-level `WeakMap`: the read is an inline-declaration lookup with no
 * layout flush, while a cache would be a second source of truth that goes stale the moment anything
 * else writes that element's style (a React re-render, another overlay path) and would then suppress
 * a write the element actually needs.
 */
export function placeOverlayElement(
  element: HTMLElement,
  point: THREE.Vector3 | null | undefined,
  camera: THREE.Camera,
  width: number,
  height: number,
): void {
  const screen = point ? projectToScreen(point, camera, width, height) : null;
  // Both transitions are writes, both steady states are not: an element that is already hidden
  // (or already shown) is left alone.
  const hidden = !screen;
  if (element.hidden !== hidden) element.hidden = hidden;
  if (!screen) return;
  const transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
  if (element.style.transform === transform) return;
  element.style.transform = transform;
}

/**
 * Hides every element in `elements` that is not already hidden, for the branches that turn the
 * whole overlay off at once (hotspots disabled, or the driver's-seat view, where the buttons would
 * sit on top of a view from inside the cabin). Same reasoning as `placeOverlayElement`: the
 * interesting case is the steady one — an overlay that is off stays off for the rest of the
 * session, and re-writing `hidden = true` every frame is pure style churn.
 */
export function hideOverlayElements(elements: Iterable<HTMLElement>): void {
  for (const element of elements) {
    if (!element.hidden) element.hidden = true;
  }
}
