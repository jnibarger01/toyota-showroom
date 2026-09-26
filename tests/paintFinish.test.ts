import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyPaintFinish,
  finishForCustomMetalness,
  getFlakeNormalTexture,
} from "../lib/three/paintFinish";
import { PAINT_FINISHES } from "../lib/data/paintFinishes";
import { MaterialWriter } from "../lib/three/materials";

function paintMesh(withUv = true) {
  const geometry = new THREE.PlaneGeometry();
  if (!withUv) geometry.deleteAttribute("uv");
  const material = new THREE.MeshPhysicalMaterial({ name: "body.carmain" });
  return new THREE.Mesh(geometry, material);
}

describe("finish sources", () => {
  it("each catalog paint finish names its base layer; only metallic and pearl add one", () => {
    const layer = Object.fromEntries(PAINT_FINISHES.map((finish) => [finish.id, finish.surface.finish]));
    expect(layer).toEqual({ gloss: "solid", metallic: "metallic", pearl: "pearl", satin: "solid", matte: "solid" });
  });

  it("maps the custom studio's metalness slider to a finish", () => {
    expect(finishForCustomMetalness(0.65)).toBe("metallic");
    expect(finishForCustomMetalness(0.1)).toBe("solid");
  });
});

describe("applyPaintFinish", () => {
  it("puts flakes on the base layer only, leaving the clearcoat reflection smooth", () => {
    const material = new THREE.MeshPhysicalMaterial({ clearcoat: 1 });
    applyPaintFinish(material, "metallic", true);
    expect(material.normalMap).toBe(getFlakeNormalTexture());
    expect(material.clearcoatNormalMap).toBeNull();
    expect(material.iridescence).toBe(0);
  });

  it("adds thin-film iridescence for pearl and clears both layers for solid", () => {
    const material = new THREE.MeshPhysicalMaterial();
    applyPaintFinish(material, "pearl", true);
    expect(material.iridescence).toBeGreaterThan(0);
    applyPaintFinish(material, "solid", true);
    expect(material.normalMap).toBeNull();
    expect(material.iridescence).toBe(0);
  });

  it("never replaces a GLB-authored normal map, and skips flakes on meshes without UVs", () => {
    const authored = new THREE.Texture();
    const withAuthored = new THREE.MeshPhysicalMaterial({ normalMap: authored });
    applyPaintFinish(withAuthored, "metallic", true);
    expect(withAuthored.normalMap).toBe(authored);
    applyPaintFinish(withAuthored, "solid", true);
    expect(withAuthored.normalMap).toBe(authored);

    const noUv = new THREE.MeshPhysicalMaterial();
    applyPaintFinish(noUv, "metallic", false);
    expect(noUv.normalMap).toBeNull();
  });

  it("builds a deterministic, tiling flake map once", () => {
    const texture = getFlakeNormalTexture();
    expect(getFlakeNormalTexture()).toBe(texture);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    // Every texel is a unit-ish normal pointing out of the surface (z > 0.5 once decoded).
    const data = texture.image.data as Uint8Array;
    for (let i = 0; i < data.length; i += 4) expect(data[i + 2]! / 255).toBeGreaterThan(0.75);
  });
});

describe("MaterialWriter + finish", () => {
  it("applies the finish through the clone-on-write path, per mesh UV availability", () => {
    const writer = new MaterialWriter();
    const withUv = paintMesh(true);
    const withoutUv = paintMesh(false);
    writer.applyMaterialConfig([withUv, withoutUv], ["body.carmain"], { color: "#9d1d20", finish: "metallic" });
    expect((withUv.material as THREE.MeshPhysicalMaterial).normalMap).toBe(getFlakeNormalTexture());
    expect((withoutUv.material as THREE.MeshPhysicalMaterial).normalMap).toBeNull();
  });
});
