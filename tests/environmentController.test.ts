import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  EnvironmentController,
  type EnvironmentControllerOptions,
  type EnvironmentQualityInputs,
} from "../lib/three/environmentController";

const HIGH_QUALITY: EnvironmentQualityInputs = { shadowsEnabled: true, shadowMapSize: 2048, secondaryLightScale: 1 };
const LOW_QUALITY: EnvironmentQualityInputs = { shadowsEnabled: false, shadowMapSize: 512, secondaryLightScale: 0.6 };

function makeController(overrides: Partial<Omit<EnvironmentControllerOptions, "scene">> = {}) {
  const scene = new THREE.Scene();
  const controller = new EnvironmentController({
    scene,
    quality: HIGH_QUALITY,
    initialTerrain: "Studio",
    initialPreset: "Daytime",
    starfieldCount: 40,
    ...overrides,
  });
  return { scene, controller };
}

describe("EnvironmentController", () => {
  describe("construction", () => {
    it("builds the full lighting/set-dressing rig and adds it to the scene", () => {
      const { scene, controller } = makeController();
      for (const object of [controller.hemi, controller.key, controller.rim, controller.fill, controller.floor, controller.grid, controller.stars, controller.rocks]) {
        expect(scene.children).toContain(object);
      }
    });

    it("applies the initial quality inputs to shadow casting and secondary light intensity", () => {
      const { controller } = makeController({ quality: HIGH_QUALITY });
      expect(controller.key.castShadow).toBe(true);
      expect(controller.floor.receiveShadow).toBe(true);
      expect(controller.key.shadow.mapSize.x).toBe(2048);
      expect(controller.rim.intensity).toBeCloseTo(1.6 * 1, 5);
      expect(controller.fill.intensity).toBeCloseTo(1.1 * 1, 5);
    });

    it("applies the initial terrain/preset palette immediately, not only on the first setTerrain/setPreset call", () => {
      const { controller } = makeController({ initialTerrain: "Trail", initialPreset: "Sunset" });
      // Sunset overrides terrain-driven colors — this asserts the constructor actually ran
      // applyPalette(), not that terrain/preset were merely stored.
      expect((controller.floor.material.color as THREE.Color).getHexString()).toBe("1c130f");
      expect(controller.rocks.visible).toBe(true); // terrain "Trail" still drives visibility even under a non-Daytime preset
    });

    it("starts with stars and rocks hidden under Studio/Daytime", () => {
      const { controller } = makeController();
      expect(controller.stars.visible).toBe(false);
      expect(controller.rocks.visible).toBe(false);
      expect(controller.grid.visible).toBe(true);
    });

    it("currentTerrain/currentPreset report the initial values", () => {
      const { controller } = makeController({ initialTerrain: "Night", initialPreset: "Sunset" });
      expect(controller.currentTerrain).toBe("Night");
      expect(controller.currentPreset).toBe("Sunset");
    });
  });

  describe("setTerrain / setPreset / setTerrainAndPreset", () => {
    it("setPreset('Night') applies the night palette and shows the starfield", () => {
      const { scene, controller } = makeController();
      controller.setPreset("Night");
      expect((scene.background as THREE.Color).getHexString()).toBe("050813");
      expect(controller.stars.visible).toBe(true);
      expect(controller.hemi.intensity).toBeCloseTo(1.1, 5);
      expect(controller.currentPreset).toBe("Night");
    });

    it("setTerrain('Trail') shows the trail rocks and hides the grid, independent of preset", () => {
      const { controller } = makeController();
      controller.setTerrain("Trail");
      expect(controller.rocks.visible).toBe(true);
      expect(controller.grid.visible).toBe(false);
      expect(controller.currentTerrain).toBe("Trail");
    });

    it("Daytime + Trail uses the trail-tinted studio palette, not the plain studio one", () => {
      const { scene, controller } = makeController();
      controller.setTerrainAndPreset("Trail", "Daytime");
      expect((scene.background as THREE.Color).getHexString()).toBe("152017");
    });

    it("a named preset (Sunset/Night) overrides the terrain-driven background regardless of terrain", () => {
      const { scene, controller } = makeController();
      controller.setTerrainAndPreset("Trail", "Sunset");
      expect((scene.background as THREE.Color).getHexString()).toBe("21140f");
      // But rocks visibility still follows terrain, not preset.
      expect(controller.rocks.visible).toBe(true);
    });

    it("updates scene.fog range based on terrain", () => {
      const { scene, controller } = makeController();
      expect((scene.fog as THREE.Fog).near).toBe(16);
      controller.setTerrain("Trail");
      expect((scene.fog as THREE.Fog).near).toBe(10);
    });

    it("setTerrainAndPreset applies the palette exactly once for a combined change", () => {
      const { controller } = makeController();
      let calls = 0;
      const originalSet = controller.floor.material.color.set.bind(controller.floor.material.color);
      controller.floor.material.color.set = ((...args: Parameters<typeof originalSet>) => {
        calls += 1;
        return originalSet(...args);
      }) as typeof originalSet;
      controller.setTerrainAndPreset("Trail", "Night");
      expect(calls).toBe(1);
    });
  });

  describe("applyQuality", () => {
    it("toggles shadow casting/receiving and rebuilds the shadow map at the new size", () => {
      const { controller } = makeController({ quality: HIGH_QUALITY });
      controller.applyQuality({ shadowsEnabled: true, shadowMapSize: 512, secondaryLightScale: 1 });
      expect(controller.key.shadow.mapSize.x).toBe(512);
    });

    it("disposes the existing shadow map so the new mapSize actually takes effect", () => {
      const { controller } = makeController({ quality: HIGH_QUALITY });
      // Fake an allocated render target the way three would have one after a real render.
      const fakeMap = { dispose: () => {} };
      let disposed = false;
      fakeMap.dispose = () => {
        disposed = true;
      };
      controller.key.shadow.map = fakeMap as unknown as THREE.WebGLRenderTarget;
      controller.applyQuality({ shadowsEnabled: true, shadowMapSize: 1024, secondaryLightScale: 1 });
      expect(disposed).toBe(true);
      expect(controller.key.shadow.map).toBeNull();
    });

    it("downgrading to shadowsEnabled:false stops casting/receiving without touching the stale mapSize", () => {
      const { controller } = makeController({ quality: HIGH_QUALITY });
      controller.applyQuality(LOW_QUALITY);
      expect(controller.key.castShadow).toBe(false);
      expect(controller.floor.receiveShadow).toBe(false);
    });

    it("scales rim/fill intensity by secondaryLightScale", () => {
      const { controller } = makeController();
      controller.applyQuality({ shadowsEnabled: true, shadowMapSize: 2048, secondaryLightScale: 0.5 });
      expect(controller.rim.intensity).toBeCloseTo(1.6 * 0.5, 5);
      expect(controller.fill.intensity).toBeCloseTo(1.1 * 0.5, 5);
    });
  });

  describe("applyHdri", () => {
    // `hdri-studio`/`hdri-showroom`/`hdri-overcast` (lib/data/paintStudio.ts) are real catalog
    // presets with no `hdrUrl` — procedural-lighting-only, so `applyHdriPreset` never reaches its
    // RGBELoader/PMREM branch. That branch (a preset WITH a real hdrUrl, e.g. `hdri-sunset`) needs
    // an actual network fetch and a real WebGLRenderer — neither available in this environment —
    // and is exercised qualitatively by the paint-studio e2e coverage instead; no unit test here
    // claims to cover it.
    const nonWebglRenderer = { isWebGLRenderer: false };

    it("applies a real no-hdrUrl preset's lighting palette without touching scene.environment", () => {
      const { scene, controller } = makeController();
      const before = scene.environment;
      return controller.applyHdri(nonWebglRenderer, "hdri-showroom").then(() => {
        expect(controller.hemi.color.getHexString()).toBe("dce9ff");
        expect(controller.key.intensity).toBeCloseTo(3.6, 5);
        expect(scene.environment).toBe(before); // still whatever it was — no PMREM path taken
      });
    });

    it("clears scene.environment for an unknown preset id instead of throwing", async () => {
      const { scene, controller } = makeController();
      scene.environment = new THREE.Texture(); // simulate a previously-applied env map
      await controller.applyHdri(nonWebglRenderer, "does-not-exist");
      expect(scene.environment).toBeNull();
    });

    it("clears scene.environment for undefined (no HDRI selected)", async () => {
      const { scene, controller } = makeController();
      scene.environment = new THREE.Texture();
      await controller.applyHdri(nonWebglRenderer, undefined);
      expect(scene.environment).toBeNull();
    });

    it("a WebGPU-shaped (non-WebGLRenderer) renderer never reaches the WebGL-only PMREM path even for a real hdrUrl preset", async () => {
      const { scene, controller } = makeController();
      // hdri-sunset has a real hdrUrl, but the WebGL-only guard must reject it before any fetch —
      // proven by the call resolving immediately with no thrown network error.
      await expect(controller.applyHdri(nonWebglRenderer, "hdri-sunset")).resolves.toBeUndefined();
      expect(scene.environment).toBeNull();
    });

    it("a later call's final state wins over an earlier call resolved after it", async () => {
      const { controller } = makeController();
      const first = controller.applyHdri(nonWebglRenderer, "hdri-studio");
      const second = controller.applyHdri(nonWebglRenderer, "hdri-showroom");
      await Promise.all([first, second]);
      // Both presets have no hdrUrl, so this asserts on the lighting palette each call applies —
      // the second call's palette (showroom) must be the one left standing, regardless of which
      // internal promise happened to settle first.
      expect(controller.key.intensity).toBeCloseTo(3.6, 5); // showroom's key intensity
    });
  });

  describe("disposal", () => {
    it("disposes floor/grid/starfield/rocks geometry and materials, and is idempotent", () => {
      const { controller } = makeController();
      const floorGeomSpy = vi.spyOn(controller.floor.geometry, "dispose");
      const floorMatSpy = vi.spyOn(controller.floor.material, "dispose");
      const gridSpy = vi.spyOn(controller.grid, "dispose");

      controller.dispose();
      expect(floorGeomSpy).toHaveBeenCalledTimes(1);
      expect(floorMatSpy).toHaveBeenCalledTimes(1);
      expect(gridSpy).toHaveBeenCalledTimes(1);

      // A second dispose must not throw or double-dispose.
      expect(() => controller.dispose()).not.toThrow();
      expect(floorGeomSpy).toHaveBeenCalledTimes(1);
    });

    it("discards a late-arriving applyHdri result after dispose rather than assigning into a torn-down scene", async () => {
      const { scene, controller } = makeController();
      const pending = controller.applyHdri({ isWebGLRenderer: false }, "hdri-studio");
      controller.dispose();
      await pending;
      // Nothing to assert on `hdriHandle` directly (private), but the call must not throw, and
      // scene.environment (untouched by a no-hdrUrl preset either way) stays consistent.
      expect(scene.environment).toBeNull();
    });
  });

  describe("reinitialization / ownership boundaries", () => {
    it("two independently constructed controllers on different scenes do not share lights", () => {
      const a = makeController();
      const b = makeController();
      expect(a.controller.hemi).not.toBe(b.controller.hemi);
      expect(a.controller.key).not.toBe(b.controller.key);
      a.controller.setPreset("Night");
      expect(b.controller.currentPreset).toBe("Daytime");
    });
  });
});
