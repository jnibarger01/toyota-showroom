import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { FOUR_RUNNER_SCENE_MAP } from "../lib/data/sceneMap/4runner";
import { AGENT_CAPABILITIES, VehicleSceneAgentApi } from "../lib/agent/sceneApi";

function makeApi() {
  const fixture = createVehicleFixture();
  const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
  const controller = new VehicleSceneController(fixture.root, satisfied, FOUR_RUNNER_SCENE_MAP);
  return { fixture, controller, api: new VehicleSceneAgentApi(controller) };
}

describe("VehicleSceneAgentApi capability manifest", () => {
  it("declares every capability as exactly one of read or mutation", () => {
    expect(AGENT_CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of AGENT_CAPABILITIES) {
      expect(["read", "mutation"]).toContain(capability.kind);
      expect(capability.name).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    }
  });
});

describe("VehicleSceneAgentApi.read", () => {
  it("inspect() reports part counts and the current hover/selection state", () => {
    const { api } = makeApi();
    const inspection = api.read.inspect();
    expect(inspection.partCount).toBeGreaterThan(0);
    expect(inspection.satisfiedPartIds).toContain("wheel.front-left");
    expect(inspection.unsatisfiedPartIds).toContain("door.front-left");
    expect(inspection.hoveredPartId).toBeUndefined();
    expect(inspection.selectedPartId).toBeUndefined();
  });

  it("listParts() filters by type and by capability, returning plain data only", () => {
    const { api } = makeApi();
    const wheels = api.read.listParts({ type: "wheel" });
    expect(wheels).toHaveLength(4);
    // Serializable only — never a THREE.Object3D reference.
    expect(wheels[0]).not.toHaveProperty("object");
    expect(typeof wheels[0]!.id).toBe("string");

    const paintable = api.read.listParts({ capability: "paintable" });
    expect(paintable.map((p) => p.id)).toContain("body.exterior");
  });

  it("getPart() returns a summary for a known id and undefined for an unknown one", () => {
    const { api } = makeApi();
    expect(api.read.getPart("body.exterior")?.type).toBe("body");
    expect(api.read.getPart("does-not-exist")).toBeUndefined();
  });

  it("focusPart() returns world-space bounding info derived from real geometry", () => {
    const { api } = makeApi();
    const focus = api.read.focusPart("wheel.front-left");
    expect(focus).toBeDefined();
    expect(focus!.id).toBe("wheel.front-left");
    expect(focus!.radius).toBeGreaterThan(0);
    expect(focus!.center).toHaveLength(3);
  });

  it("focusPart() returns undefined for an unknown part rather than throwing", () => {
    const { api } = makeApi();
    expect(api.read.focusPart("does-not-exist")).toBeUndefined();
  });

  it("pick() resolves a raycast to a part summary without selecting it, taking only a serializable camera pose", () => {
    const { api, controller } = makeApi();
    // +x face of BODY -> body.carmain -> body.exterior. No THREE.Camera is constructed by the
    // caller here — CameraPose is plain data, per the module's own "no raw Three.js crosses this
    // boundary" rule.
    const pose = { position: [10, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 50, aspect: 1 };

    const hit = api.read.pick({ ndcX: 0, ndcY: 0 }, pose);
    expect(hit?.id).toBe("body.exterior");
    expect(controller.selectedPartId).toBeUndefined(); // read-only: no mutation happened
  });
});

describe("VehicleSceneAgentApi.mutate", () => {
  it("selectPart()/hoverPart() mutate the controller's real selection state", () => {
    const { api, controller } = makeApi();
    expect(api.mutate.selectPart("wheel.front-left")).toEqual({ ok: true });
    expect(controller.selectedPartId).toBe("wheel.front-left");

    expect(api.mutate.hoverPart("wheel.front-right")).toEqual({ ok: true });
    expect(controller.hoveredPartId).toBe("wheel.front-right");
  });

  it("selectPart()/hoverPart() fail closed on an unknown id instead of reporting a false success", () => {
    const { api, controller } = makeApi();
    expect(api.mutate.selectPart("does-not-exist")).toEqual({ ok: false, reason: expect.stringContaining("unknown part id") });
    expect(controller.selectedPartId).toBeUndefined(); // the controller-level call never even ran

    expect(api.mutate.hoverPart("also-not-real")).toEqual({ ok: false, reason: expect.stringContaining("unknown part id") });
    expect(controller.hoveredPartId).toBeUndefined();
  });

  it("selectPart(undefined)/hoverPart(undefined) always succeed — clearing is always valid", () => {
    const { api, controller } = makeApi();
    api.mutate.selectPart("wheel.front-left");
    expect(api.mutate.selectPart(undefined)).toEqual({ ok: true });
    expect(controller.selectedPartId).toBeUndefined();
  });

  it("setPaint() applies a real paint option and rejects an id from the wrong category", async () => {
    const { api, fixture } = makeApi();
    const result = await api.mutate.setPaint("paint-3u5-barcelona-red");
    expect(result).toEqual({ ok: true });
    const body = fixture.root.getObjectByName("BODY") as THREE.Mesh;
    const material = (Array.isArray(body.material) ? body.material : [body.material])[0] as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe("9d1d20");

    const wrongCategory = await api.mutate.setPaint("wheels-weisu-bronze");
    expect(wrongCategory.ok).toBe(false);
  });

  it("setWheels() applies a real wheel option through the same governed path", async () => {
    const { api, fixture } = makeApi();
    const result = await api.mutate.setWheels("wheels-weisu-bronze");
    expect(result).toEqual({ ok: true });
    const wheel = fixture.root.getObjectByName("PLACED_WEISU_front_left") as THREE.Mesh;
    const material = wheel.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe("8c6239");
  });

  it("setAccessory() toggles a real accessory option on and off", async () => {
    const { api, fixture } = makeApi();
    const node = () => fixture.root.getObjectByName("ACCESSORY_ROOF_RACK")!;

    expect(node().visible).toBe(false);
    expect(await api.mutate.setAccessory("accessory-roof-rack", true)).toEqual({ ok: true });
    expect(node().visible).toBe(true);
    expect(await api.mutate.setAccessory("accessory-roof-rack", false)).toEqual({ ok: true });
    expect(node().visible).toBe(false);
  });

  it("rejects an unknown option id instead of throwing", async () => {
    const { api } = makeApi();
    const result = await api.mutate.setPaint("does-not-exist");
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("unknown option id") });
  });

  it("applyConfiguration() delegates to the controller and returns the same applied/failed shape", async () => {
    const { api, fixture } = makeApi();
    const { applied, failed } = await api.mutate.applyConfiguration({ paint: ["paint-3u5-barcelona-red"] });
    expect(applied).toEqual(["paint-3u5-barcelona-red"]);
    expect(failed).toEqual([]);
    expect((fixture.root.getObjectByName("BODY") as THREE.Mesh).material).toBeDefined();
  });
});
