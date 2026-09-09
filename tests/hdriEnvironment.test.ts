import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyHdriPreset, type HdriLightRefs } from "../lib/three/hdriEnvironment";
import { HDRI_PRESETS } from "../lib/data/paintStudio";

/**
 * Covers the branch `tests/environmentController.test.ts` explicitly declines to: a preset that
 * *does* carry an `hdrUrl`, so `applyHdriPreset` reaches its renderer-dependent env-map path.
 *
 * That branch used to read `if (!(renderer instanceof THREE.WebGLRenderer)) { environment = null }`,
 * which meant the WebGPU renderer — the one `createRenderer` prefers whenever `navigator.gpu`
 * exists — got no image-based lighting at all. These tests pin the fix: a non-WebGL renderer must
 * end up with a real environment texture, and must not dispose the cache-shared source texture.
 *
 * `RGBELoader` is mocked because the real one needs a network fetch for a binary .hdr; the loader
 * boundary is not what is under test here, the renderer branch is.
 */

const hdrPreset = HDRI_PRESETS.find((preset) => preset.hdrUrl);
if (!hdrPreset) throw new Error("catalog has no HDRI preset with an hdrUrl to exercise");

const loadAsync = vi.fn<() => Promise<THREE.DataTexture>>();

vi.mock("three/examples/jsm/loaders/RGBELoader.js", () => ({
  RGBELoader: class {
    loadAsync = (...args: unknown[]) => loadAsync(...(args as []));
  },
}));

function makeRefs(): HdriLightRefs & { scene: THREE.Scene } {
  return {
    scene: new THREE.Scene(),
    hemi: new THREE.HemisphereLight(),
    key: new THREE.DirectionalLight(),
    rim: new THREE.DirectionalLight(),
    fill: new THREE.DirectionalLight(),
  };
}

describe("applyHdriPreset — env map on a non-WebGL renderer", () => {
  beforeEach(() => {
    loadAsync.mockReset();
    // A fresh texture per test would defeat the module-level `textureCache`, which keys on URL and
    // persists across tests. Returning the same instance matches what the cache actually hands out.
    loadAsync.mockImplementation(async () => hdrTexture);
  });

  const hdrTexture = new THREE.DataTexture();

  it("assigns an environment texture on a WebGPU-shaped renderer instead of clearing it", async () => {
    const refs = makeRefs();

    const handle = await applyHdriPreset(refs, { isWebGLRenderer: false }, hdrPreset.id);

    // The regression: this was `null` before, so the preferred renderer drew paint with no
    // environment reflection at all.
    expect(refs.scene.environment).not.toBeNull();
    expect(refs.scene.environment).toBe(hdrTexture);
    expect(refs.scene.environmentIntensity).toBeGreaterThan(0);
    expect(handle).not.toBeNull();
  });

  it("detaches but does not dispose the cache-shared source texture", async () => {
    const refs = makeRefs();
    const disposeSpy = vi.spyOn(hdrTexture, "dispose");

    const handle = await applyHdriPreset(refs, { isWebGLRenderer: false }, hdrPreset.id);
    handle?.dispose();

    expect(refs.scene.environment).toBeNull();
    // `textureCache` hands this same instance to every later caller for this URL; disposing it here
    // would break the next application rather than free anything meaningful.
    expect(disposeSpy).not.toHaveBeenCalled();
    disposeSpy.mockRestore();
  });

  it("still clears the environment when the HDR fails to load", async () => {
    // `loadHdr` memoises by URL in a module-level cache, and the tests above have already primed
    // it with a resolved texture for this preset. Re-import the module so this test gets a cold
    // cache and the rejection actually reaches the catch, rather than silently reusing the hit.
    vi.resetModules();
    const { applyHdriPreset: freshApply } = await import("../lib/three/hdriEnvironment");

    const refs = makeRefs();
    refs.scene.environment = new THREE.Texture();
    loadAsync.mockImplementation(async () => {
      throw new Error("network down");
    });

    const handle = await freshApply(refs, { isWebGLRenderer: false }, hdrPreset.id);

    expect(handle).toBeNull();
    expect(refs.scene.environment).toBeNull();
  });
});
