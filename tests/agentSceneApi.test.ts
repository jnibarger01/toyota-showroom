// @vitest-environment jsdom
// jsdom (not the default node environment) only because the camera-capability describe block
// below constructs a real `CameraController`, whose `OrbitControls` needs a DOM element — every
// other test in this file is plain THREE.js/business logic and runs identically either way.
import { afterEach, describe, expect, it } from "vitest";
import gsap from "gsap";
import * as THREE from "three";
import { createVehicleFixture, materialAt } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { FOUR_RUNNER_SCENE_MAP } from "../lib/data/sceneMap/4runner";
import { AGENT_CAPABILITIES, VehicleSceneAgentApi } from "../lib/agent/sceneApi";
import { CameraController } from "../lib/three/cameraController";
import type { CameraPresetConfig } from "../lib/types/vehicle";

function makeApi() {
  const fixture = createVehicleFixture();
  const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
  const controller = new VehicleSceneController(fixture.root, satisfied, FOUR_RUNNER_SCENE_MAP);
  return { fixture, controller, api: new VehicleSceneAgentApi(controller) };
}

const HERO_PRESET: CameraPresetConfig = { id: "hero", label: "Hero", position: [7.5, 4, 8.5], target: [0, 1.1, 0] };
const SIDE_PRESET: CameraPresetConfig = { id: "side", label: "Side", position: [10, 2, 0], target: [0, 1, 0] };

/**
 * `OrbitControls.update()` recomputes `camera.position` from a spherical offset each time it
 * runs (its own constructor calls it once, and so does every `CameraController` method ending in
 * `controls.update()`), which round-trips through `sin`/`cos` and introduces ~1e-15 float noise —
 * real, pre-existing OrbitControls behavior, not a defect. See cameraController.test.ts's own
 * `expectVec3CloseTo` for the same rationale in more detail.
 */
function expectVec3CloseTo(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
}

function makeApiWithCamera() {
  const { fixture, controller } = makeApi();
  const dom = document.createElement("div");
  document.body.appendChild(dom);
  const camera = new CameraController({
    domElement: dom,
    initialPreset: HERO_PRESET,
    presets: [HERO_PRESET, SIDE_PRESET],
  });
  return { fixture, controller, camera, api: new VehicleSceneAgentApi(controller, camera) };
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
    const material = materialAt(fixture.root, "BODY", "body.carmain") as THREE.MeshStandardMaterial;
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
    expect(materialAt(fixture.root, "BODY", "body.carmain")).toBeDefined();
  });
});

describe("VehicleSceneAgentApi camera capabilities (Priority 4)", () => {
  afterEach(() => {
    // makeApiWithCamera() builds a fresh CameraController per test without disposing it (dispose()
    // only tears down the cinematic tour, not an in-flight transitionToPreset/focusPoint tween —
    // see cameraController.test.ts's own dispose() tests) — clearing the shared GSAP timeline here
    // is what keeps one test's still-running tween from ticking during a later test's assertions.
    gsap.globalTimeline.clear();
  });

  describe("without a CameraController wired", () => {
    it("read.getCameraState()/getCameraPresets() return undefined rather than throwing", () => {
      const { api } = makeApi();
      expect(api.read.getCameraState()).toBeUndefined();
      expect(api.read.getCameraPresets()).toBeUndefined();
    });

    it("every camera mutation fails closed with a reason instead of silently no-opping", () => {
      const { api } = makeApi();
      expect(api.mutate.setPreset("hero")).toEqual({ ok: false, reason: expect.stringContaining("no camera controller") });
      expect(api.mutate.focusPart("wheel.front-left")).toEqual({ ok: false, reason: expect.stringContaining("no camera controller") });
      expect(api.mutate.orbit(0.1, 0)).toEqual({ ok: false, reason: expect.stringContaining("no camera controller") });
      expect(api.mutate.reset()).toEqual({ ok: false, reason: expect.stringContaining("no camera controller") });
    });
  });

  describe("with a CameraController wired", () => {
    it("read.getCameraState() reports real position/target/preset/tour state", () => {
      const { api } = makeApiWithCamera();
      const state = api.read.getCameraState();
      expectVec3CloseTo(state!.position, HERO_PRESET.position);
      expectVec3CloseTo(state!.target, HERO_PRESET.target);
      expect(state?.presetId).toBe("hero");
      expect(state?.tourStatus).toBe("idle");
    });

    it("read.getCameraPresets() returns the real catalog preset list", () => {
      const { api } = makeApiWithCamera();
      expect(api.read.getCameraPresets()).toEqual([HERO_PRESET, SIDE_PRESET]);
    });

    it("mutate.setPreset() transitions the real camera and updates getCameraState()", () => {
      const { api, camera } = makeApiWithCamera();
      expect(api.mutate.setPreset("side")).toEqual({ ok: true });
      // Instant under vitest's default (non-jsdom-animated) gsap ticking would require advancing
      // the global timeline; asserting the *intent* reached the controller is what this test is
      // for — tests/cameraController.test.ts already covers the tween mechanics themselves.
      expect(camera.getState().presetId).toBe("side");
    });

    it("mutate.setPreset() fails closed on an unknown preset id", () => {
      const { api, camera } = makeApiWithCamera();
      expect(api.mutate.setPreset("does-not-exist")).toEqual({
        ok: false,
        reason: expect.stringContaining("unknown camera preset id"),
      });
      // The failed call must not have moved anything.
      expect(camera.getState().presetId).toBe("hero");
    });

    it("mutate.focusPart() composes read.focusPart's real bounding data with a real camera move", () => {
      const { api, camera } = makeApiWithCamera();
      const target = api.read.focusPart("wheel.front-left");
      expect(target).toBeDefined();

      expect(api.mutate.focusPart("wheel.front-left")).toEqual({ ok: true });
      // Flush the GSAP tween focusPoint starts.
      gsap.globalTimeline.time(gsap.globalTimeline.duration() + 1);

      const state = camera.getState();
      expect(state.target[0]).toBeCloseTo(target!.center[0], 5);
      expect(state.target[1]).toBeCloseTo(target!.center[1], 5);
      expect(state.target[2]).toBeCloseTo(target!.center[2], 5);
    });

    it("mutate.focusPart() fails closed for an unknown or unfocusable part", () => {
      const { api } = makeApiWithCamera();
      expect(api.mutate.focusPart("does-not-exist")).toEqual({
        ok: false,
        reason: expect.stringContaining("unknown or has no focusable geometry"),
      });
    });

    it("mutate.orbit() moves the real camera and rejects non-finite deltas", () => {
      const { api, camera } = makeApiWithCamera();
      const before = camera.camera.position.clone();
      expect(api.mutate.orbit(0.3, 0)).toEqual({ ok: true });
      expect(camera.camera.position.equals(before)).toBe(false);

      expect(api.mutate.orbit(Number.NaN, 0)).toEqual({
        ok: false,
        reason: expect.stringContaining("finite numbers"),
      });
      expect(api.mutate.orbit(0, Number.POSITIVE_INFINITY)).toEqual({
        ok: false,
        reason: expect.stringContaining("finite numbers"),
      });
    });

    it("mutate.reset() returns the real camera to its currently active preset after an orbit", () => {
      const { api, camera } = makeApiWithCamera();
      camera.orbitBy(0.4, 0.1);
      expect(camera.getState().position).not.toEqual(HERO_PRESET.position);

      expect(api.mutate.reset()).toEqual({ ok: true });
      expectVec3CloseTo(camera.getState().position, HERO_PRESET.position);
      expect(camera.getState().presetId).toBe("hero");
    });

    it("mutate.reset() follows setPreset() — resets to the newly active preset, not the original one", () => {
      const { api, camera } = makeApiWithCamera();
      api.mutate.setPreset("side");
      camera.orbitBy(0.2, 0);

      expect(api.mutate.reset()).toEqual({ ok: true });
      expect(camera.getState().presetId).toBe("side");
      expectVec3CloseTo(camera.getState().position, SIDE_PRESET.position);
    });
  });
});
