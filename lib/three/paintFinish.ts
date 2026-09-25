import * as THREE from "three";
import type { PaintFinish } from "../types/customization";

/**
 * Car-paint finish layers on top of the catalog's base colour/metalness/clearcoat numbers.
 *
 * A single clearcoated `MeshPhysicalMaterial` renders every paint as the same smooth enamel with a
 * different tint. What actually distinguishes a metallic from a solid on a real car is the base
 * layer *under* the clearcoat: aluminium flakes that each catch light at a slightly different angle,
 * so the colour sparkles and shifts across a panel while the clearcoat reflection above stays
 * mirror-smooth. Pearl (mica) adds thin-film interference — a hue shift with viewing angle.
 *
 * Both map onto features `MeshPhysicalMaterial` already has on the WebGL *and* WebGPU backends,
 * which is the constraint that ruled out postprocessing (docs/POSTPROCESSING_EVALUATION.md):
 *
 * - flakes → a tiling tangent-space `normalMap` on the base layer only. `clearcoatNormalMap` is left
 *   empty on purpose, so the coat keeps its undisturbed reflection — the physically right split.
 * - pearl → `iridescence`, plus a finer flake.
 */

/** Flake tiles per UV unit. Car bodies are unwrapped roughly 0..1 across a panel. */
export const FLAKE_REPEAT = 90;
const FLAKE_SIZE = 64;

let flakeTexture: THREE.DataTexture | null = null;

/** Deterministic PRNG so the flake pattern — and therefore every render — is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small tiling map of randomly tilted normals, built once and shared by every paint slot.
 *
 * A `DataTexture` rather than a canvas: no DOM dependency, identical on both backends, and cheap
 * (16 KiB). Mipmapped so that at a distance the flakes average out toward the flat normal — which is
 * also what real flakes do: sparkle up close, a smooth metallic sheen from across the room.
 */
export function getFlakeNormalTexture(): THREE.DataTexture {
  if (flakeTexture) return flakeTexture;
  const random = mulberry32(0x7011a);
  const data = new Uint8Array(FLAKE_SIZE * FLAKE_SIZE * 4);
  for (let i = 0; i < FLAKE_SIZE * FLAKE_SIZE; i += 1) {
    // Tilt up to ~35° off the surface normal; most flakes lie close to the panel.
    const tilt = Math.pow(random(), 1.6) * 0.6;
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * tilt;
    const y = Math.sin(angle) * tilt;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    data[i * 4] = Math.round((x * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((y * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((z * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, FLAKE_SIZE, FLAKE_SIZE, THREE.RGBAFormat);
  texture.name = "PAINT_FLAKE_NORMAL";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(FLAKE_REPEAT, FLAKE_REPEAT);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  flakeTexture = texture;
  return texture;
}

/** Custom paint-studio colours have no finish choice; their metalness slider is the viewer's intent. */
export function finishForCustomMetalness(metalness: number): PaintFinish {
  return metalness >= 0.4 ? "metallic" : "solid";
}

/**
 * Applies a finish to one writable (already clone-on-write'd) material.
 *
 * Never replaces a normal map this module did not install: a GLB-authored normal map carries real
 * panel detail, and the flake layer is a nicety that does not get to erase it. `hasUv` guards meshes
 * with no texture coordinates, where a normal map would sample one texel and tilt the whole panel.
 */
export function applyPaintFinish(material: THREE.Material, finish: PaintFinish, hasUv: boolean): void {
  const standard = material as THREE.MeshStandardMaterial;
  if (!("normalMap" in standard)) return;
  const flake = getFlakeNormalTexture();
  const ownsNormal = standard.normalMap === null || standard.normalMap === flake;

  if (ownsNormal) {
    if (finish === "solid" || !hasUv) {
      standard.normalMap = null;
    } else {
      standard.normalMap = flake;
      const strength = finish === "pearl" ? 0.12 : 0.22;
      standard.normalScale.set(strength, strength);
    }
  }

  const physical = material as THREE.MeshPhysicalMaterial;
  if ("iridescence" in physical) {
    if (finish === "pearl") {
      physical.iridescence = 0.55;
      physical.iridescenceIOR = 1.45;
      physical.iridescenceThicknessRange = [260, 480];
    } else {
      physical.iridescence = 0;
    }
  }
}
