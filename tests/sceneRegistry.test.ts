import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { SceneRegistry, buildSceneRegistry } from "../lib/three/sceneRegistry";
import { FOUR_RUNNER_SCENE_MAP } from "../lib/data/sceneMap/4runner";
import type { SceneMapEntry } from "../lib/types/sceneMap";

describe("SceneRegistry", () => {
  it("registers, looks up, and unregisters an entry", () => {
    const registry = new SceneRegistry();
    const object = new THREE.Object3D();

    registry.register("wheel.front-left", object, {
      type: "wheel",
      label: "Front-left wheel",
      capabilities: ["selectable", "wheel"],
    });

    expect(registry.has("wheel.front-left")).toBe(true);
    expect(registry.get("wheel.front-left")?.object).toBe(object);

    registry.unregister("wheel.front-left");
    expect(registry.has("wheel.front-left")).toBe(false);
    expect(registry.get("wheel.front-left")).toBeUndefined();
  });

  it("re-registering the same id replaces the previous entry rather than duplicating it", () => {
    const registry = new SceneRegistry();
    const first = new THREE.Object3D();
    const second = new THREE.Object3D();

    registry.register("body.exterior", first, { type: "body", label: "Paint", capabilities: ["paintable"] });
    registry.register("body.exterior", second, { type: "body", label: "Paint", capabilities: ["paintable"] });

    expect(registry.get("body.exterior")?.object).toBe(second);
    // The old object is no longer reachable via reverse lookup either.
    expect(registry.resolve(first)).toBeUndefined();
    expect(registry.resolve(second)?.id).toBe("body.exterior");
  });

  it("findByType and findByCapability filter across registered entries", () => {
    const registry = new SceneRegistry();
    registry.register("wheel.a", new THREE.Object3D(), { type: "wheel", label: "A", capabilities: ["selectable", "wheel"] });
    registry.register("wheel.b", new THREE.Object3D(), { type: "wheel", label: "B", capabilities: ["selectable", "wheel"] });
    registry.register("body.exterior", new THREE.Object3D(), { type: "body", label: "Paint", capabilities: ["paintable"] });

    expect(registry.findByType("wheel").map((e) => e.id).sort()).toEqual(["wheel.a", "wheel.b"]);
    expect(registry.findByCapability("paintable").map((e) => e.id)).toEqual(["body.exterior"]);
    expect(registry.findByCapability("wheel")).toHaveLength(2);
  });

  it("resolve() disambiguates material-region entries sharing one mesh", () => {
    const registry = new SceneRegistry();
    const body = new THREE.Mesh(new THREE.BoxGeometry(), []);
    registry.register("body.exterior", body, {
      type: "body",
      label: "Paint",
      capabilities: ["paintable"],
      materialNames: ["body.carmain"],
    });
    registry.register("glass.windshield", body, {
      type: "glass",
      label: "Windshield",
      capabilities: ["selectable"],
      materialNames: ["glass.windows.windshield"],
    });

    expect(registry.resolve(body, "body.carmain")?.id).toBe("body.exterior");
    expect(registry.resolve(body, "glass.windows.windshield")?.id).toBe("glass.windshield");
    // An unregistered material slot on a registered mesh resolves to nothing, not a wrong region.
    expect(registry.resolve(body, "metal.chrome.004")).toBeUndefined();
  });

  it("resolve() walks up to an ancestor's whole-object registration", () => {
    const registry = new SceneRegistry();
    const group = new THREE.Group();
    const child = new THREE.Mesh(new THREE.BoxGeometry());
    group.add(child);
    registry.register("accessory.roof-rack", group, {
      type: "accessory",
      label: "Roof rack",
      capabilities: ["selectable", "accessory"],
    });

    expect(registry.resolve(child)?.id).toBe("accessory.roof-rack");
  });

  it("resolve() returns undefined for an object with no registered ancestor", () => {
    const registry = new SceneRegistry();
    expect(registry.resolve(new THREE.Object3D())).toBeUndefined();
  });
});

describe("buildSceneRegistry", () => {
  it("registers every satisfied entry from the 4Runner scene map against the fixture", () => {
    const fixture = createVehicleFixture();
    const { registry, report } = buildSceneRegistry(fixture.root, FOUR_RUNNER_SCENE_MAP);

    expect(registry.has("body.exterior")).toBe(true);
    expect(registry.has("wheel.front-left")).toBe(true);
    expect(registry.has("tire.rear-right")).toBe(true);
    expect(registry.has("accessory.roof-rack")).toBe(true);

    expect(report.satisfied.map((e) => e.id)).toContain("body.exterior");
  });

  it("reports doors/mirrors/badge/roof/interior as unsatisfied without throwing (fixture has none)", () => {
    const fixture = createVehicleFixture();
    const { registry, report } = buildSceneRegistry(fixture.root, FOUR_RUNNER_SCENE_MAP);

    for (const id of ["door.front-left", "mirror.left", "badge.front", "interior", "roof"]) {
      expect(registry.has(id)).toBe(false);
    }
    const unsatisfiedIds = report.unsatisfied.map((u) => u.entry.id);
    expect(unsatisfiedIds).toEqual(expect.arrayContaining(["door.front-left", "mirror.left", "badge.front", "interior", "roof"]));
  });

  it("a fully empty scene map registers nothing and reports nothing (vehicles with no GLB)", () => {
    const fixture = createVehicleFixture();
    const { registry, report } = buildSceneRegistry(fixture.root, []);
    expect(registry.list()).toHaveLength(0);
    expect(report.satisfied).toHaveLength(0);
    expect(report.unsatisfied).toHaveLength(0);
  });

  it("resolving a hit on BODY's paint slot returns the body.exterior semantic id", () => {
    const fixture = createVehicleFixture();
    const { registry } = buildSceneRegistry(fixture.root, FOUR_RUNNER_SCENE_MAP);
    const body = fixture.root.getObjectByName("BODY")!;

    expect(registry.resolve(body, "body.carmain")?.id).toBe("body.exterior");
    expect(registry.resolve(body, "glass.windows")?.id).toBe("glass.windows");
    expect(registry.resolve(body, "emissive.foglight")?.id).toBe("light.foglight");
  });

  it("marks an entry unsatisfied when only some of a region's material names are present", () => {
    const fixture = createVehicleFixture();
    const partial: SceneMapEntry[] = [
      {
        id: "body.exterior",
        type: "body",
        label: "Paint",
        capabilities: ["paintable"],
        match: { kind: "material-region", objectName: "BODY", materialNames: ["body.carmain", "does.not.exist"] },
      },
    ];
    const { registry, report } = buildSceneRegistry(fixture.root, partial);
    expect(registry.has("body.exterior")).toBe(false);
    expect(report.unsatisfied[0]?.reason).toContain("does.not.exist");
  });
});
