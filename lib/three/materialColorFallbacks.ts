import * as THREE from "three";

/**
 * Base-color repairs for GLB materials that render white because their color lived in a
 * texture that no longer ships.
 *
 * `scripts/optimize-models.mjs` strips textures from some assets at build time (GR Supra,
 * Camry), and the `factors-only` texture policy strips the rest at load. Either way a material
 * whose `baseColorFactor` was never authored falls back to the glTF default — white — so the
 * part renders as a flat white blank: the Supra's whole wheel assemblies (its single `Wheel1A`
 * material covers tyre and rim), its grilles, interior tub and engine, and the Camry's chrome
 * garnish, mirrors and decals. Paint cannot fix them: paint only ever targets
 * `paintableMaterialNames`, and these parts are not paint.
 *
 * The repair is deliberately narrow so it can never fight a properly authored asset:
 * - Only materials named in `fallbacks` are considered.
 * - Only when the material has no base-color texture (`map` is null) — a textured material
 *   keeps its authored look, and a future re-authored GLB that restores textures silently
 *   wins over the fallback.
 * - Only when the material's color is still the default white — a material with a real
 *   authored factor (dark tyre, grey paint) is never overwritten.
 *
 * Returns the material names it actually repaired, so callers and tests can tell a repair
 * from a no-op (renamed material, re-authored GLB, invalid hex).
 */
export type MaterialColorFallbacks = Record<string, string>;

const WHITE = new THREE.Color(1, 1, 1);
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function applyMaterialColorFallbacks(
  root: THREE.Object3D,
  fallbacks: MaterialColorFallbacks | undefined,
): string[] {
  if (!fallbacks) return [];
  const repaired: string[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || !Object.hasOwn(fallbacks, material.name)) continue;
      if (repaired.includes(material.name)) continue;
      const colored = material as Partial<THREE.MeshStandardMaterial>;
      if (!colored.color || colored.map) continue;
      if (!colored.color.equals(WHITE)) continue;
      const hex = fallbacks[material.name]!;
      if (!HEX_PATTERN.test(hex)) {
        console.warn(`[customization] ignoring invalid materialColorFallback for "${material.name}": "${hex}"`);
        continue;
      }
      colored.color.set(hex);
      material.needsUpdate = true;
      repaired.push(material.name);
    }
  });
  return repaired;
}
