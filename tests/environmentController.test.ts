import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  EnvironmentController,
  type EnvironmentControllerOptions,
  type EnvironmentQualityInputs,
} from "../lib/three/environmentController";

/**
 * Every catalog HDRI preset now carries an `hdrUrl` (docs/HDRI_PROVENANCE.md), so `applyHdri` always
 * reaches the loader. The real `RGBELoader` needs a network fetch this environment cannot make, so
 * it is replaced with one that resolves a named texture per URL — which also lets the supersession
 * tests below assert *which* preset's map won, not only which palette.
 */
vi.mock("three/examples/jsm/loaders/RGBELoader.js", () => ({
  RGBELoader: class {
    loadAsync = async (url: string) => {
      const texture = new THREE.DataTexture();
      texture.name = url;
      return texture;
    };
  },
}));

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

  describe("starfield density follows the quality tier", () => {
    /**
     * `starfieldCount` sat in the tier table beside `maxPixelRatio` and `shadowsEnabled` but was
     * read once at construction, so a governor downgrade to `low` still drew all 400 points. These
     * pin it as a live knob.
     */
    it("draws only the constructed count, not the whole allocated buffer", () => {
      const { controller } = makeController({ starfieldCount: 40 });
      expect(controller.stars.geometry.drawRange.count).toBe(40);
    });

    it("narrows the draw range when the tier steps down", () => {
      const { controller } = makeController({ starfieldCount: 400 });

      controller.applyQuality({ ...HIGH_QUALITY, starfieldCount: 80 });

      expect(controller.stars.geometry.drawRange.count).toBe(80);
    });

    it("leaves the count alone when a caller supplies no starfieldCount", () => {
      const { controller } = makeController({ starfieldCount: 120 });

      // `EnvironmentQualityInputs.starfieldCount` is optional; a caller that only cares about
      // shadows must not silently blank the sky.
      controller.applyQuality(HIGH_QUALITY);

      expect(controller.stars.geometry.drawRange.count).toBe(120);
    });

    it("clamps a count above the allocated ceiling instead of rendering nothing", () => {
      const { controller } = makeController({ starfieldCount: 400 });

      controller.applyQuality({ ...HIGH_QUALITY, starfieldCount: 10_000 });

      // Past the end of the buffer three draws nothing, which would read as broken stars rather
      // than a misconfigured tier table.
      expect(controller.stars.geometry.drawRange.count).toBe(400);
      expect(controller.stars.geometry.getAttribute("position").count).toBeGreaterThanOrEqual(400);
    });
  });

  describe("AR passthrough", () => {
    /**
     * `alpha: true` on the renderer is necessary but not sufficient for AR: the scene still paints an
     * opaque background, fogs everything, and stands the vehicle on a floor with grid/stars/rocks
     * around it. All of that occludes camera passthrough, so without this the AR feature showed the
     * virtual showroom instead of the viewer's room.
     */
    it("clears everything that would occlude the camera feed", () => {
      const { scene, controller } = makeController();
      expect(scene.background).not.toBeNull();

      controller.setPassthrough(true);

      expect(scene.background).toBeNull();
      expect(scene.fog).toBeNull();
      expect(controller.floor.visible).toBe(false);
      expect(controller.grid.visible).toBe(false);
      expect(controller.stars.visible).toBe(false);
      expect(controller.rocks.visible).toBe(false);
      expect(controller.isPassthrough).toBe(true);
    });

    it("keeps the light rig, which is what makes the vehicle read as a physical object", () => {
      const { controller } = makeController();
      controller.setPassthrough(true);
      for (const light of [controller.hemi, controller.key, controller.rim, controller.fill]) {
        expect(light.visible).toBe(true);
      }
    });

    it("restores the staged environment on exit", () => {
      const { scene, controller } = makeController({ initialTerrain: "Studio" });
      controller.setPassthrough(true);
      controller.setPassthrough(false);

      expect(scene.background).not.toBeNull();
      expect(scene.fog).not.toBeNull();
      expect(controller.floor.visible).toBe(true);
      expect(controller.grid.visible).toBe(true); // Studio terrain
      expect(controller.isPassthrough).toBe(false);
    });

    it("survives a preset change mid-session without putting the showroom back", () => {
      const { scene, controller } = makeController();
      controller.setPassthrough(true);

      // `applyPalette` is the single writer of background/fog and runs on any preset/terrain change.
      controller.setPreset("Night");

      expect(scene.background).toBeNull();
      expect(scene.fog).toBeNull();
      expect(controller.stars.visible).toBe(false);
    });

    it("is idempotent in both directions", () => {
      const { scene, controller } = makeController();
      controller.setPassthrough(true);
      controller.setPassthrough(true);
      expect(scene.background).toBeNull();
      controller.setPassthrough(false);
      controller.setPassthrough(false);
      expect(scene.background).not.toBeNull();
    });
  });

  describe("applyHdri", () => {
    // The WebGL PMREM branch needs a real WebGLRenderer, unavailable here; it is exercised by the
    // browser suites. A WebGPU-shaped renderer takes the direct-equirect branch, which is plain
    // texture assignment and fully testable with the mocked loader above.
    const nonWebglRenderer = { isWebGLRenderer: false };

    it("applies the preset's lighting palette and its environment map", async () => {
      const { scene, controller } = makeController();
      await controller.applyHdri(nonWebglRenderer, "hdri-showroom");
      expect(controller.hemi.color.getHexString()).toBe("dce9ff");
      expect(controller.key.intensity).toBeCloseTo(3.6, 5);
      expect(scene.environment?.name).toMatch(/photo_studio_loft_hall_512\.hdr$/);
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

    it("a WebGPU-shaped (non-WebGLRenderer) renderer gets the equirect map directly, never the WebGL-only PMREM path", async () => {
      const { scene, controller } = makeController();
      // A PMREM attempt against a test double would throw inside three; resolving cleanly with the
      // loader's own texture assigned is the proof the WebGL-only branch was not taken.
      await expect(controller.applyHdri(nonWebglRenderer, "hdri-sunset")).resolves.toBe(true);
      expect(scene.environment?.name).toMatch(/venice_sunset_512\.hdr$/);
    });

    it("reports a commit only when the requested lighting is actually installed", async () => {
      const { controller } = makeController();
      const superseded = controller.applyHdri(nonWebglRenderer, "hdri-studio");
      const current = controller.applyHdri(nonWebglRenderer, "hdri-showroom");
      await expect(superseded).resolves.toBe(false);
      await expect(current).resolves.toBe(true);
      await expect(controller.applyHdri(nonWebglRenderer, "does-not-exist")).resolves.toBe(false);
    });

    it("re-applying the live preset restores its palette without rebuilding its map", async () => {
      const { scene, controller } = makeController();
      await controller.applyHdri(nonWebglRenderer, "hdri-showroom");
      const map = scene.environment;
      controller.key.intensity = 0; // a terrain/lighting change repainted the lights
      await expect(controller.applyHdri(nonWebglRenderer, "hdri-showroom")).resolves.toBe(true);
      expect(scene.environment).toBe(map);
      expect(controller.key.intensity).toBeCloseTo(3.6, 5);
    });

    it("can install a preset's map without its palette, leaving the environment controls in charge", async () => {
      const { scene, controller } = makeController();
      controller.setTerrainAndPreset("Studio", "Sunset");
      const sunsetKey = controller.key.color.getHexString();
      await expect(controller.applyHdri(nonWebglRenderer, "hdri-showroom", { palette: false })).resolves.toBe(true);
      expect(scene.environment?.name).toMatch(/photo_studio_loft_hall_512\.hdr$/);
      expect(controller.key.color.getHexString()).toBe(sunsetKey);
      expect(controller.requestedHdriPresetId).toBe("hdri-showroom");
    });

    it("exposes when the latest request has settled, including a failed one", async () => {
      const { controller } = makeController();
      void controller.applyHdri(nonWebglRenderer, "hdri-overcast");
      await expect(controller.whenHdriSettled()).resolves.toBeUndefined();
    });

    it("a later call's final state wins over an earlier call resolved after it", async () => {
      const { scene, controller } = makeController();
      const first = controller.applyHdri(nonWebglRenderer, "hdri-studio");
      const second = controller.applyHdri(nonWebglRenderer, "hdri-showroom");
      await Promise.all([first, second]);
      // The second call's palette *and* map (showroom) must be the ones left standing, regardless of
      // which internal promise happened to settle first.
      expect(controller.key.intensity).toBeCloseTo(3.6, 5); // showroom's key intensity
      expect(scene.environment?.name).toMatch(/photo_studio_loft_hall_512\.hdr$/);
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
      // The load resolved after dispose; its handle must be released rather than left assigned
      // into a torn-down scene.
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
