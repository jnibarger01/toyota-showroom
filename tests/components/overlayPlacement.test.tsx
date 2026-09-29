import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { placeOverlayElement, hideOverlayElements } from "../../lib/three/overlayPlacement";
import { projectToScreen } from "../../lib/three/hotspots";

/**
 * The overlay pass runs on every painted frame for every hotspot button and dimension label. These
 * tests pin the two properties that make a still view cheap: the placement is written once and then
 * left alone while it does not change, and hiding an already-hidden overlay is not a write either.
 *
 * jsdom is the right environment here because the thing under test *is* the DOM side of the pass —
 * unlike `VehicleCanvas`'s own wiring (covered source-level in `tests/partInteraction.test.ts`,
 * because jsdom cannot render a WebGL canvas), there is nothing GPU-bound about deciding whether to
 * assign a CSS property.
 */

/** An `HTMLElement` stand-in that records exactly which property assignments happen. */
function countingElement() {
  const transformWrites: string[] = [];
  let hiddenWrites = 0;
  let isHidden = false;
  const style = new Proxy(
    { transform: "" },
    {
      set(target, property, value) {
        if (property === "transform") transformWrites.push(String(value));
        Reflect.set(target, property, value);
        return true;
      },
    },
  );
  const element = {
    get hidden() {
      return isHidden;
    },
    set hidden(value: boolean) {
      hiddenWrites += 1;
      isHidden = value;
    },
    style,
  };
  return {
    element: element as unknown as HTMLElement,
    transformWrites,
    hiddenWrites: () => hiddenWrites,
    hidden: () => isHidden,
  };
}

function cameraAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe("placeOverlayElement", () => {
  it("writes the placement once and then leaves an unchanged element alone", () => {
    const { element, transformWrites, hiddenWrites } = countingElement();
    const camera = cameraAt(0, 0, 5);
    const anchor = new THREE.Vector3(0, 0, 0);

    placeOverlayElement(element, anchor, camera, 800, 400);
    placeOverlayElement(element, anchor, camera, 800, 400);
    placeOverlayElement(element, anchor, camera, 800, 400);

    expect(transformWrites).toEqual(["translate(400px, 200px) translate(-50%, -50%)"]);
    // The element was already visible, so neither was a `hidden` write either.
    expect(hiddenWrites()).toBe(0);
  });

  it("rewrites the placement when the camera moves", () => {
    const { element, transformWrites } = countingElement();
    const anchor = new THREE.Vector3(0, 0, 0);

    placeOverlayElement(element, anchor, cameraAt(0, 0, 5), 800, 400);
    placeOverlayElement(element, anchor, cameraAt(1, 0, 5), 800, 400);

    expect(transformWrites).toHaveLength(2);
    expect(transformWrites[0]).not.toBe(transformWrites[1]);
  });

  it("hides an element with no anchor and does not re-hide it every frame", () => {
    const { element, hiddenWrites, hidden } = countingElement();

    placeOverlayElement(element, null, cameraAt(0, 0, 5), 800, 400);
    placeOverlayElement(element, null, cameraAt(0, 0, 5), 800, 400);
    placeOverlayElement(element, undefined, cameraAt(0, 0, 5), 800, 400);

    expect(hidden()).toBe(true);
    expect(hiddenWrites()).toBe(1);
  });

  it("shows an element again when its anchor comes back", () => {
    const { element, hidden, transformWrites } = countingElement();
    const camera = cameraAt(0, 0, 5);
    const anchor = new THREE.Vector3(0, 0, 0);

    placeOverlayElement(element, null, camera, 800, 400);
    expect(hidden()).toBe(true);
    placeOverlayElement(element, anchor, camera, 800, 400);
    expect(hidden()).toBe(false);
    expect(transformWrites).toHaveLength(1);
  });

  it("drops an anchor behind the camera and says nothing about the transform", () => {
    const { element, hidden, transformWrites } = countingElement();

    placeOverlayElement(element, new THREE.Vector3(0, 0, 10), cameraAt(0, 0, 5), 800, 400);

    expect(hidden()).toBe(true);
    expect(transformWrites).toHaveLength(0);
  });

  it("positions a real DOM element with the same pixels projectToScreen computes", () => {
    // The counting stand-in above proves *when* a write happens; this proves the value reaches a
    // real element's inline style and hides through the real `hidden` property.
    const element = document.createElement("button");
    const camera = cameraAt(0, 0, 5);
    const anchor = new THREE.Vector3(0, 0, 0);
    const screen = projectToScreen(anchor, camera, 800, 400);

    placeOverlayElement(element, anchor, camera, 800, 400);

    expect(screen).not.toBeNull();
    expect(element.hidden).toBe(false);
    expect(element.style.transform).toBe(`translate(${screen!.x}px, ${screen!.y}px) translate(-50%, -50%)`);

    placeOverlayElement(element, null, camera, 800, 400);
    expect(element.hidden).toBe(true);
  });
});

describe("hideOverlayElements", () => {
  it("writes `hidden` only for the elements that are not already hidden", () => {
    const visible = countingElement();
    const alreadyHidden = countingElement();
    hideOverlayElements([alreadyHidden.element]);

    hideOverlayElements([visible.element, alreadyHidden.element]);

    expect(visible.hiddenWrites()).toBe(1);
    expect(alreadyHidden.hiddenWrites()).toBe(1);
    expect(visible.hidden()).toBe(true);
    expect(alreadyHidden.hidden()).toBe(true);
  });
});