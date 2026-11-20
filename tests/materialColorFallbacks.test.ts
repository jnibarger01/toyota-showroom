import path from "node:path";
import { existsSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyMaterialColorFallbacks } from "../lib/three/materialColorFallbacks";
import { inspectGlb } from "../lib/tooling/glbInspect";
import { VEHICLES } from "../lib/data/vehicles";

/**
 * Repairs for GLB materials that render white because their color lived in a texture that no
 * longer ships (GR Supra and Camry were texture-stripped by scripts/optimize-models.mjs; the
 * `factors-only` policy strips the rest at load). A material whose baseColorFactor was never
 * authored then defaults to white — the Supra's whole wheel assemblies, its grilles, interior
 * and engine, the Camry's chrome, mirrors and decals — and no paint option can fix them,
 * because paint only targets paintableMaterialNames.
 *
 * The repair is deliberately narrow: a fallback applies only to a named material that is
 * textureless AND still white. Anything with a real factor or a surviving texture is never
 * touched, so a future re-authored GLB silently wins over the fallback.
 *
 * `prepareVehicleRoot` (app/components/VehicleCanvas.tsx) is the call site, but it is not
 * imported here: that module pulls in React and CSS, which the plain-Node test project cannot
 * load. The function under test is the whole repair; the call site is one line plus an import,
 * covered by typecheck.
 */

function whiteMaterial(name: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color: 0xffffff });
}

function sceneWith(materials: THREE.Material[]): THREE.Group {
  const root = new THREE.Group();
  for (const material of materials) {
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  }
  return root;
}

describe("applyMaterialColorFallbacks", () => {
  it("recolors a white, textureless named material and reports it", () => {
    const material = whiteMaterial("Wheel1A");
    const root = sceneWith([material]);
    const repaired = applyMaterialColorFallbacks(root, { Wheel1A: "#0d0d0d" });
    expect(repaired).toEqual(["Wheel1A"]);
    expect(material.color.getHexString()).toBe("0d0d0d");
    // three's `needsUpdate` is a write-only setter (it bumps `version`); assert the bump.
    expect(material.version).toBeGreaterThan(0);
  });

  it("leaves a named material alone when it still has a texture", () => {
    const material = whiteMaterial("Wheel1A");
    material.map = new THREE.Texture();
    const root = sceneWith([material]);
    expect(applyMaterialColorFallbacks(root, { Wheel1A: "#0d0d0d" })).toEqual([]);
    expect(material.color.getHexString()).toBe("ffffff");
  });

  it("leaves a named material alone when it has a real authored factor", () => {
    const material = new THREE.MeshStandardMaterial({ name: "Tire", color: 0x050505 });
    const root = sceneWith([material]);
    expect(applyMaterialColorFallbacks(root, { Tire: "#0d0d0d" })).toEqual([]);
    expect(material.color.getHexString()).toBe("050505");
  });

  it("leaves an unnamed white material alone", () => {
    const material = whiteMaterial("Lights");
    const root = sceneWith([material]);
    expect(applyMaterialColorFallbacks(root, { Wheel1A: "#0d0d0d" })).toEqual([]);
    expect(material.color.getHexString()).toBe("ffffff");
  });

  it("repairs a material shared by several meshes exactly once", () => {
    const material = whiteMaterial("Wheel1A");
    const root = sceneWith([material, material]);
    expect(applyMaterialColorFallbacks(root, { Wheel1A: "#0d0d0d" })).toEqual(["Wheel1A"]);
    expect(material.color.getHexString()).toBe("0d0d0d");
  });

  it("ignores an invalid hex instead of throwing", () => {
    const material = whiteMaterial("Wheel1A");
    const root = sceneWith([material]);
    expect(applyMaterialColorFallbacks(root, { Wheel1A: "not-a-color" })).toEqual([]);
    expect(material.color.getHexString()).toBe("ffffff");
  });

  it("is a no-op without fallbacks", () => {
    const material = whiteMaterial("Wheel1A");
    expect(applyMaterialColorFallbacks(sceneWith([material]), undefined)).toEqual([]);
    expect(material.color.getHexString()).toBe("ffffff");
  });
});

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const WHITE_FACTOR: [number, number, number, number] = [1, 1, 1, 1];

function isWhiteDefault(factors: { hasBaseColorTexture: boolean; baseColorFactor?: [number, number, number, number] }): boolean {
  if (factors.hasBaseColorTexture) return false;
  const factor = factors.baseColorFactor;
  return factor === undefined || factor.every((value, index) => value === WHITE_FACTOR[index]);
}

describe("catalog materialColorFallbacks vs. shipped GLB", () => {
  for (const vehicle of VEHICLES) {
    const fallbacks = vehicle.threeDConfig.materialColorFallbacks;
    if (!fallbacks) continue;
    const urls = [vehicle.threeDConfig.modelUrl, vehicle.threeDConfig.lodModelUrl].filter(
      (url): url is string => Boolean(url),
    );
    for (const modelUrl of urls) {
      const filePath = path.join(process.cwd(), "public", modelUrl);
      it(`${vehicle.slug} (${modelUrl}): every fallback names a real, white-default material`, () => {
        expect(existsSync(filePath), `Missing declared model: ${modelUrl}`).toBe(true);
        const inspection = inspectGlb(filePath);
        for (const [name, hex] of Object.entries(fallbacks)) {
          expect(HEX_PATTERN.test(hex), `"${name}" fallback "${hex}" is not a #rrggbb hex`).toBe(true);
          const factors = inspection.materials.get(name);
          expect(factors, `"${name}" is not a material in ${modelUrl}`).toBeDefined();
          expect(
            isWhiteDefault(factors!),
            `"${name}" in ${modelUrl} already has a color or texture — the fallback would never ` +
              `apply (re-authored GLB?) and should be removed from the catalog.`,
          ).toBe(true);
          expect(
            vehicle.threeDConfig.paintableMaterialNames.includes(name),
            `"${name}" is both a paint target and a fallback — paint owns its color, remove it ` +
              `from materialColorFallbacks.`,
          ).toBe(false);
        }
      });
    }
  }
});
