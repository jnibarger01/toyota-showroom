import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateStaticParams } from "../app/[slug]/page";
import { getOptionsForVehicle } from "../lib/data/options";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";
import { getAllVehicleSlugs, getVehicleBySlug } from "../lib/data/vehicles";
import { rav4 } from "../lib/data/vehicles/rav4";
import { inspectGlb } from "../lib/tooling/glbInspect";
import { resolveAssetUrl } from "../lib/three/assetUrl";

const assets = [
  {
    slug: "rav4-hybrid",
    modelPath: "/models/rav4-hybrid-2023/rav4-hybrid.glb",
    thumbnailPath: "/images/vehicles/rav4-hybrid/rav4-hybrid-front-three-quarter.png",
    bytes: 4_828_076,
    sha256: "c8add6a54c23575f6240d247e0b7b9e7d663f9fcba6866793d1518188110b95e",
    title: "2023 Toyota RAV4 Hybrid",
  },
  {
    slug: "land-cruiser",
    modelPath: "/models/land-cruiser-250-2025/land-cruiser-250.glb",
    thumbnailPath: "/images/vehicles/land-cruiser/land-cruiser-front-three-quarter.png",
    bytes: 7_730_312,
    sha256: "140424217afacb3f202ee3ae2732fd59b2a6ab36513be2088135a629d0b5012e",
    title: "2025 Toyota Land Cruiser 250",
  },
] as const;

function readAssetExtras(filePath: string): Record<string, string> {
  const buffer = readFileSync(filePath);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8")) as {
    asset?: { extras?: Record<string, string> };
  };
  return json.asset?.extras ?? {};
}

describe("Model Implementation A catalog integration", () => {
  it("adds two distinct vehicles without changing the existing RAV4 identity", () => {
    expect(rav4).toMatchObject({ slug: "rav4", year: 2024, model: "RAV4" });
    expect(rav4.threeDConfig.modelUrl).toBe("/models/rav4-2024/rav4_2024_limited_decoded.glb");

    const slugs = getAllVehicleSlugs();
    expect(slugs).toEqual(expect.arrayContaining(["rav4", "rav4-hybrid", "land-cruiser"]));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(getVehicleBySlug("rav4-hybrid")?.model).toBe("RAV4 Hybrid");
    expect(getVehicleBySlug("land-cruiser")?.model).toBe("Land Cruiser");
  });

  it("pre-renders a route for each new vehicle", () => {
    expect(generateStaticParams()).toEqual(expect.arrayContaining([
      { slug: "rav4-hybrid" },
      { slug: "land-cruiser" },
    ]));
  });

  for (const asset of assets) {
    it(`${asset.slug}: ships a parseable, attributed, base-path-safe GLB and dedicated thumbnail`, () => {
      const vehicle = getVehicleBySlug(asset.slug)!;
      expect(vehicle.threeDConfig.modelUrl).toBe(asset.modelPath);
      expect(vehicle.media.thumbnails[0]?.url).toBe(asset.thumbnailPath);
      expect(resolveAssetUrl(asset.modelPath, "/toyota-showroom")).toBe(`/toyota-showroom${asset.modelPath}`);

      const modelFile = path.join(process.cwd(), "public", asset.modelPath);
      const thumbnailFile = path.join(process.cwd(), "public", asset.thumbnailPath);
      expect(existsSync(modelFile)).toBe(true);
      expect(existsSync(thumbnailFile)).toBe(true);
      expect(statSync(modelFile).size).toBe(asset.bytes);
      expect(createHash("sha256").update(readFileSync(modelFile)).digest("hex")).toBe(asset.sha256);

      const inspection = inspectGlb(modelFile);
      expect(inspection.nodeNames).toContain("Sketchfab_model");
      expect(getOptionsForVehicle(asset.slug).length).toBeGreaterThan(0);
      expect(getSceneMapForVehicle(asset.slug).length).toBeGreaterThan(0);

      expect(readAssetExtras(modelFile)).toMatchObject({
        title: asset.title,
        author: expect.stringContaining("Ddiaz Design"),
        license: expect.stringContaining("CC-BY-NC-SA-4.0"),
      });
    });
  }
});
