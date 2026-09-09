import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { getHdriPreset, type HdriLightingKey } from "../data/paintStudio";

/**
 * Applies a catalog HDRI preset to a scene.
 *
 * Preset ids are resolved against the trusted catalog — never against client-supplied URLs —
 * so a crafted deep link cannot point the loader at an arbitrary asset.
 */

export type HdriEnvironmentHandle = {
  dispose: () => void;
};

type LightingPalette = {
  bg: string;
  keyColor: string;
  rimColor: string;
  fillColor: string;
  hemiSky: string;
  hemiGround: string;
  key: number;
  rim: number;
  fill: number;
  hemi: number;
  envIntensity: number;
};

const LIGHTING: Record<HdriLightingKey, LightingPalette> = {
  studio: {
    bg: "#0b0f14",
    keyColor: "#ffffff",
    rimColor: "#4169ff",
    fillColor: "#dce8ff",
    hemiSky: "#edf5ff",
    hemiGround: "#18100b",
    key: 4.2,
    rim: 1.6,
    fill: 1.1,
    hemi: 1.8,
    envIntensity: 0.55,
  },
  showroom: {
    bg: "#0a1018",
    keyColor: "#e8f0ff",
    rimColor: "#6aa8ff",
    fillColor: "#c5d7ff",
    hemiSky: "#dce9ff",
    hemiGround: "#12161c",
    key: 3.6,
    rim: 2.0,
    fill: 1.3,
    hemi: 1.5,
    envIntensity: 0.7,
  },
  overcast: {
    bg: "#12151a",
    keyColor: "#d0d5db",
    rimColor: "#8a939e",
    fillColor: "#b8c0c9",
    hemiSky: "#c5ccd4",
    hemiGround: "#1a1d22",
    key: 2.4,
    rim: 1.1,
    fill: 1.4,
    hemi: 2.2,
    envIntensity: 0.45,
  },
  sunset: {
    bg: "#21140f",
    keyColor: "#ffb36b",
    rimColor: "#ff5a36",
    fillColor: "#ffdcb0",
    hemiSky: "#ffd3a1",
    hemiGround: "#5e3023",
    key: 2.6,
    rim: 1.4,
    fill: 0.9,
    hemi: 1.6,
    envIntensity: 0.85,
  },
};

export type HdriLightRefs = {
  scene: THREE.Scene;
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
};

const loader = new RGBELoader();
const textureCache = new Map<string, Promise<THREE.DataTexture>>();

function loadHdr(url: string): Promise<THREE.DataTexture> {
  const cached = textureCache.get(url);
  if (cached) return cached;
  const pending = loader.loadAsync(url).then((texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    return texture;
  });
  pending.catch(() => textureCache.delete(url));
  textureCache.set(url, pending);
  return pending;
}

/**
 * Warms the HDR texture cache for a preset without applying it.
 *
 * `loadHdr` memoises by URL, so a later `applyHdriPreset` for the same preset resolves from cache
 * instead of starting a cold fetch of a multi-hundred-KB `.hdr` — the hitch #53 is about. Resolves
 * to `false` when there is nothing to do (unknown preset, or a procedural-lighting-only preset with
 * no `hdrUrl`) and swallows failures: a prefetch that fails must be indistinguishable from one that
 * never ran, because `applyHdriPreset` will retry and report for itself.
 */
export async function prefetchHdriPreset(hdriPresetId: string): Promise<boolean> {
  const preset = getHdriPreset(hdriPresetId);
  if (!preset?.hdrUrl) return false;
  try {
    await loadHdr(preset.hdrUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Narrows to a real `WebGLRenderer`, the only thing `PMREMGenerator` can be constructed against.
 *
 * Deliberately `instanceof` rather than three's usual `.isWebGLRenderer` duck-type: this module's
 * signature also accepts `{ isWebGLRenderer?: boolean }` test doubles, and a double must never be
 * routed into the PMREM branch, which would immediately touch real GL state and throw.
 */
function isWebGLRenderer(
  renderer: THREE.WebGLRenderer | { isWebGLRenderer?: boolean },
): renderer is THREE.WebGLRenderer {
  return renderer instanceof THREE.WebGLRenderer;
}

/**
 * Applies lighting + optional env map for a catalog HDRI preset id.
 * Returns a dispose handle for any PMREM target created for this application.
 */
export async function applyHdriPreset(
  refs: HdriLightRefs,
  renderer: THREE.WebGLRenderer | { isWebGLRenderer?: boolean },
  hdriPresetId: string | undefined,
  previous?: HdriEnvironmentHandle | null,
): Promise<HdriEnvironmentHandle | null> {
  previous?.dispose();

  const preset = getHdriPreset(hdriPresetId);
  if (!preset) {
    refs.scene.environment = null;
    return null;
  }

  const palette = LIGHTING[preset.lightingKey];
  refs.scene.background = new THREE.Color(palette.bg);
  refs.hemi.color.set(palette.hemiSky);
  refs.hemi.groundColor.set(palette.hemiGround);
  refs.hemi.intensity = palette.hemi;
  refs.key.color.set(palette.keyColor);
  refs.key.intensity = palette.key;
  refs.rim.color.set(palette.rimColor);
  refs.rim.intensity = palette.rim;
  refs.fill.color.set(palette.fillColor);
  refs.fill.intensity = palette.fill;

  if (!preset.hdrUrl) {
    refs.scene.environment = null;
    return null;
  }

  try {
    const hdr = await loadHdr(preset.hdrUrl);

    // `PMREMGenerator` prefilters the equirectangular map into a roughness-matched mip chain, which
    // is what makes a rough material's reflection blur correctly instead of mirroring. It is a
    // WebGL-only generator.
    //
    // It does NOT follow that a non-WebGL renderer should get no environment at all, which is what
    // this branch used to do (`scene.environment = null`). WebGPU is the *preferred* renderer here
    // (`createRenderer` tries `navigator.gpu` first), so that shortcut removed image-based lighting
    // from the path most users hit — and for car paint, environment reflection is the dominant
    // shading cue, not a refinement. The vehicle read as flat under analytic lights only, silently.
    //
    // three's WebGPU backend samples an equirectangular `scene.environment` natively, so assign the
    // texture directly there. Roughness response is less accurate than a prefiltered chain; that is
    // a real but far smaller error than having no reflections.
    if (!isWebGLRenderer(renderer)) {
      refs.scene.environment = hdr;
      refs.scene.environmentIntensity = palette.envIntensity;
      return {
        // `hdr` belongs to `textureCache` and is shared with every later caller for this URL —
        // detach it, never dispose it. Disposing would break the next application that reads the
        // cached promise.
        dispose: () => {
          if (refs.scene.environment === hdr) refs.scene.environment = null;
        },
      };
    }

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromEquirectangular(hdr).texture;
    refs.scene.environment = envMap;
    refs.scene.environmentIntensity = palette.envIntensity;
    pmrem.dispose();
    return {
      dispose: () => {
        if (refs.scene.environment === envMap) refs.scene.environment = null;
        // Unlike `hdr`, this target is created per application and owned solely by this handle.
        envMap.dispose();
      },
    };
  } catch {
    refs.scene.environment = null;
    return null;
  }
}
