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

  // PMREMGenerator is WebGL-only; WebGPU builds still get the lighting palette above.
  if (!(renderer instanceof THREE.WebGLRenderer)) {
    refs.scene.environment = null;
    return null;
  }

  try {
    const hdr = await loadHdr(preset.hdrUrl);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromEquirectangular(hdr).texture;
    refs.scene.environment = envMap;
    refs.scene.environmentIntensity = palette.envIntensity;
    pmrem.dispose();
    return {
      dispose: () => {
        if (refs.scene.environment === envMap) refs.scene.environment = null;
        envMap.dispose();
      },
    };
  } catch {
    refs.scene.environment = null;
    return null;
  }
}
