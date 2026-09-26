// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ArPlacement, isFloorLike, trueScaleFactor, type PlacementSession } from "../lib/three/arPlacement";
import { buildQuickLookRoot, supportsQuickLook } from "../lib/three/quickLook";
import { describeXrCapability, xrControlEnabled, xrControlLabel, XR_QUICK_LOOK_LABEL } from "../lib/three/xrCapability";

function fakeSession(grantHitTest = true) {
  const listeners = new Set<() => void>();
  const cancel = vi.fn();
  const session: PlacementSession & { tap(): void; cancel: typeof cancel } = {
    requestReferenceSpace: async () => ({ kind: "viewer" }),
    requestHitTestSource: grantHitTest ? async () => ({ cancel }) : undefined,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    tap: () => listeners.forEach((listener) => listener()),
    cancel,
  };
  return session;
}

function frameHitting(position: [number, number, number] | null) {
  const matrix = new THREE.Matrix4().makeTranslation(...(position ?? [0, 0, 0])).toArray();
  return {
    getHitTestResults: () => (position ? [{ getPose: () => ({ transform: { matrix } }) }] : []),
  };
}

describe("ArPlacement", () => {
  it("tracks the floor with the reticle and places on tap, side-on to the viewer", async () => {
    const session = fakeSession();
    const onPlace = vi.fn();
    const placement = new ArPlacement(session, onPlace, () => new THREE.Vector3(0, 1.6, 0));
    await expect(placement.start({ kind: "local-floor" })).resolves.toBe(true);

    placement.update(frameHitting([0, 0, -3]));
    expect(placement.reticle.visible).toBe(true);
    session.tap();
    expect(onPlace).toHaveBeenCalledTimes(1);
    const [position, yaw] = onPlace.mock.calls[0]!;
    expect(position.toArray()).toEqual([0, 0, -3]);
    // Viewer is straight ahead (+Z from the spot): the car's +X side turns toward them.
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    expect(right.z).toBeCloseTo(1, 5);
    expect(placement.isPlaced).toBe(true);
    placement.dispose();
    expect(session.cancel).toHaveBeenCalled();
  });

  it("skips wall hits and uses the first floor-like hit behind them", async () => {
    const session = fakeSession();
    const onPlace = vi.fn();
    const placement = new ArPlacement(session, onPlace, () => new THREE.Vector3(0, 1.6, 2));
    await placement.start({ kind: "local-floor" });
    // A wall facing the viewer: its normal (+Y of the pose) points along +Z, not up.
    const wall = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 1, -1).toArray();
    const floor = new THREE.Matrix4().makeTranslation(0, 0, -2).toArray();
    expect(isFloorLike(wall)).toBe(false);
    expect(isFloorLike(floor)).toBe(true);
    placement.update({ getHitTestResults: () => [{ getPose: () => ({ transform: { matrix: wall } }) }] });
    expect(placement.reticle.visible).toBe(false);
    session.tap();
    expect(onPlace).not.toHaveBeenCalled();
    placement.update({
      getHitTestResults: () => [
        { getPose: () => ({ transform: { matrix: wall } }) },
        { getPose: () => ({ transform: { matrix: floor } }) },
      ],
    });
    session.tap();
    expect(onPlace.mock.calls[0]![0].z).toBeCloseTo(-2, 6);
    placement.dispose();
  });

  it("does nothing on tap before the floor is found", async () => {
    const session = fakeSession();
    const onPlace = vi.fn();
    const placement = new ArPlacement(session, onPlace, () => new THREE.Vector3());
    await placement.start({});
    placement.update(frameHitting(null));
    session.tap();
    expect(placement.reticle.visible).toBe(false);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("reports no placement UI when the session did not grant hit-testing", async () => {
    const placement = new ArPlacement(fakeSession(false), vi.fn(), () => new THREE.Vector3());
    await expect(placement.start({})).resolves.toBe(false);
  });
});

describe("trueScaleFactor", () => {
  it("scales the model to the catalog's overall length", () => {
    expect(trueScaleFactor(4.5, 191.3)).toBeCloseTo((191.3 * 0.0254) / 4.5, 6);
  });

  it("refuses implausible corrections and missing data", () => {
    expect(trueScaleFactor(0.049, 191.3)).toBe(1); // a centimetre/metre unit slip, not a modelling error
    expect(trueScaleFactor(4.5, undefined)).toBe(1);
  });
});

describe("Quick Look", () => {
  it("exports only visible geometry, at scale, standing on the origin", () => {
    const root = new THREE.Group();
    root.rotation.y = Math.PI;
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4.8), new THREE.MeshStandardMaterial());
    body.position.set(3, 5, -2);
    const hiddenAccessory = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    hiddenAccessory.name = "ACCESSORY_ROOF_RACK";
    hiddenAccessory.visible = false;
    root.add(body, hiddenAccessory);

    const holder = buildQuickLookRoot(root, 1.1);
    expect(holder.getObjectByName("ACCESSORY_ROOF_RACK")).toBeUndefined();
    const bounds = new THREE.Box3().setFromObject(holder);
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 5);
    expect(bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(4.8 * 1.1, 4);
    // The live scene is untouched.
    expect(body.position.toArray()).toEqual([3, 5, -2]);
    expect(hiddenAccessory.parent).toBe(root);
  });

  it("detects Quick Look through <a rel=ar> support", () => {
    const doc = document.implementation.createHTMLDocument();
    const createElement = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation((tag: string) => {
      const element = createElement(tag);
      Object.defineProperty(element, "relList", { value: { supports: (token: string) => token === "ar" } });
      return element;
    });
    expect(supportsQuickLook(doc)).toBe(true);
  });

  it("makes the AR control usable and says what it will do", () => {
    expect(xrControlEnabled("quicklook")).toBe(true);
    expect(describeXrCapability("quicklook")).toBeNull();
    expect(xrControlLabel(false, "quicklook")).toBe(XR_QUICK_LOOK_LABEL);
    expect(xrControlLabel(true, "quicklook")).toBe("Exit AR");
  });
});
