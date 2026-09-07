import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { buildSceneRegistry } from "../lib/three/sceneRegistry";
import { VehiclePicker, pointerToNdc } from "../lib/three/picking";
import { FOUR_RUNNER_SCENE_MAP } from "../lib/data/sceneMap/4runner";

/**
 * The fixture's `BODY` and wheel/tyre meshes are unit boxes at the positions
 * `tests/fixtures/scene.ts` sets — real geometry, not mocks, so these tests exercise the actual
 * three.js raycast path (BVH-accelerated for `BODY`, since `VehiclePicker.prepare` computes a
 * bounds tree for it) rather than asserting against a stub.
 */
/** Ray travels along -axis toward the origin, so it hits the box face whose outward normal is +axis. */
function orthoCameraAlongAxis(axis: "x" | "y" | "z", target: THREE.Vector3 = new THREE.Vector3()): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  const offset = new THREE.Vector3(axis === "x" ? 10 : 0, axis === "y" ? 10 : 0, axis === "z" ? 10 : 0);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return camera;
}

describe("VehiclePicker", () => {
  it("resolves a hit on the body's paint slot to body.exterior", () => {
    const fixture = createVehicleFixture();
    const { registry } = buildSceneRegistry(fixture.root, FOUR_RUNNER_SCENE_MAP);
    const picker = new VehiclePicker(registry);
    picker.prepare(fixture.root);

    // BoxGeometry's default material groups are [+x, -x, +y, -y, +z, -z]; BODY_MATERIAL_NAMES[0]
    // ("body.carmain") is the +x face, so the ray must approach from +x to hit that slot.
    const camera = orthoCameraAlongAxis("x");
    const result = picker.pick(new THREE.Vector2(0, 0), camera, fixture.root);

    expect(result?.entry.id).toBe("body.exterior");
    picker.dispose();
  });

  it("resolves a hit on a named object to its semantic id", () => {
    // A minimal, non-overlapping scene — the shared material-test fixture stacks a wheel and a
    // tyre as identical, coincident unit boxes (by design, for the material-sharing tests it
    // exists for), which makes "which one did the ray hit" geometrically ambiguous. Picking wants
    // a scene where the answer is unambiguous.
    const root = new THREE.Group();
    root.name = "VEHICLE_ROOT";
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    wheel.name = "PLACED_WEISU_front_left";
    root.add(wheel);

    const { registry } = buildSceneRegistry(root, [
      {
        id: "wheel.front-left",
        type: "wheel",
        label: "Front-left wheel",
        capabilities: ["selectable", "wheel"],
        match: { kind: "object", objectName: "PLACED_WEISU_front_left" },
      },
    ]);
    const picker = new VehiclePicker(registry);
    picker.prepare(root);

    const camera = orthoCameraAlongAxis("y");
    const result = picker.pick(new THREE.Vector2(0, 0), camera, root);

    expect(result?.entry.id).toBe("wheel.front-left");
    picker.dispose();
  });

  it("returns null for a miss", () => {
    const fixture = createVehicleFixture();
    const { registry } = buildSceneRegistry(fixture.root, FOUR_RUNNER_SCENE_MAP);
    const picker = new VehiclePicker(registry);
    picker.prepare(fixture.root);

    const camera = orthoCameraAlongAxis("y", new THREE.Vector3(50, 0, 50));
    expect(picker.pick(new THREE.Vector2(0, 0), camera, fixture.root)).toBeNull();
    picker.dispose();
  });

  it("degrades gracefully when the hit resolves to no registered part", () => {
    const fixture = createVehicleFixture();
    // Empty map: nothing is registered, so every hit is geometrically real but semantically unknown.
    const { registry } = buildSceneRegistry(fixture.root, []);
    const picker = new VehiclePicker(registry);
    picker.prepare(fixture.root);

    const camera = orthoCameraAlongAxis("x");
    expect(picker.pick(new THREE.Vector2(0, 0), camera, fixture.root)).toBeNull();
    picker.dispose();
  });

  it("prepare() is idempotent — a second call does not rebuild an existing bounds tree", () => {
    const fixture = createVehicleFixture();
    const { registry } = buildSceneRegistry(fixture.root, FOUR_RUNNER_SCENE_MAP);
    const picker = new VehiclePicker(registry);
    const body = fixture.root.getObjectByName("BODY") as THREE.Mesh;

    picker.prepare(fixture.root);
    const tree = body.geometry.boundsTree;
    picker.prepare(fixture.root);

    expect(body.geometry.boundsTree).toBe(tree);
    picker.dispose();
    expect(body.geometry.boundsTree).toBeFalsy();
  });

  it("dispose() only ever touches meshes still reachable from root, never a mesh detached earlier", () => {
    // Regression guard: an earlier version tracked every mesh a bounds tree was ever built for in
    // a running array, so a mesh-replacement option (a wheel/tire style swap, which detaches and
    // disposes the previous mesh mid-session) leaked one retired mesh's geometry per swap — kept
    // alive by the array reference alone until the whole controller tore down. `dispose()` now
    // re-traverses whatever is actually under `root` at call time instead of a remembered list.
    // Proven here by two meshes prepared together, one detached (simulating a mesh-replacement
    // swap via the same shape `detachFromMount`/`disposeSubtree` in lib/three/assets.ts use) before
    // `dispose()` runs: the still-attached mesh's tree is released as normal, and disposing the
    // detached one's geometry ahead of time (as the real removal path does) causes no error —
    // dispose() never had to reach for it via a stale reference.
    const fixture = createVehicleFixture();
    const { registry } = buildSceneRegistry(fixture.root, FOUR_RUNNER_SCENE_MAP);
    const picker = new VehiclePicker(registry);

    const staysAttached = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    staysAttached.name = "TEMP_STAYS_ATTACHED";
    const getsSwappedOut = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    getsSwappedOut.name = "TEMP_SWAPPED_OUT";
    fixture.root.add(staysAttached, getsSwappedOut);
    picker.prepare(fixture.root);
    expect(staysAttached.geometry.boundsTree).toBeTruthy();
    expect(getsSwappedOut.geometry.boundsTree).toBeTruthy();

    fixture.root.remove(getsSwappedOut);
    getsSwappedOut.geometry.dispose(); // the real removal path disposes geometry entirely, not just the bounds tree

    expect(() => picker.dispose()).not.toThrow();
    expect(staysAttached.geometry.boundsTree).toBeFalsy(); // still-attached mesh: released as normal
  });
});

describe("pointerToNdc", () => {
  it("maps a client point to normalized device coordinates", () => {
    const bounds = { left: 100, top: 50, width: 200, height: 100 } as DOMRect;
    expect(pointerToNdc(100, 50, bounds)).toEqual(new THREE.Vector2(-1, 1));
    expect(pointerToNdc(300, 150, bounds)).toEqual(new THREE.Vector2(1, -1));
    expect(pointerToNdc(200, 100, bounds)).toEqual(new THREE.Vector2(0, 0));
  });
});
