import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getOptionsForVehicle } from "../lib/data/options";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";
import { getAllVehicleSlugs, getVehicleBySlug } from "../lib/data/vehicles";
import { resolveAssetUrl } from "../lib/three/assetUrl";

const integrations = [
  {
    slug: "gr-corolla",
    model: "GR Corolla",
    modelUrl: "/models/gr-corolla-2023/2023_toyota_gr_corolla.glb",
    thumbnailUrl: "/images/vehicles/gr-corolla/gr-corolla-front-three-quarter.png",
  },
  {
    slug: "gt86",
    model: "GT86",
    modelUrl: "/models/gt86/toyota_gt86.glb",
    thumbnailUrl: "/images/vehicles/gt86/gt86-front-three-quarter.png",
  },
] as const;

describe("Model B catalog integration", () => {
  it("registers distinct GR Corolla and Toyota GT86 identities without a GR86 duplicate", () => {
    expect(getAllVehicleSlugs()).toContain("gr-corolla");
    expect(getAllVehicleSlugs()).toContain("gt86");
    expect(getAllVehicleSlugs()).not.toContain("gr86");
    expect(getAllVehicleSlugs().filter((slug) => slug === "gt86")).toHaveLength(1);
  });

  for (const integration of integrations) {
    it(`${integration.slug} has a checked-in, base-path-safe model and thumbnail`, () => {
      const vehicle = getVehicleBySlug(integration.slug);
      expect(vehicle).toBeDefined();
      if (!vehicle) return;

      expect(vehicle.model).toBe(integration.model);
      expect(vehicle.threeDConfig.hasModel).toBe(true);
      expect(vehicle.threeDConfig.modelUrl).toBe(integration.modelUrl);
      expect(vehicle.media.thumbnails[0]?.url).toBe(integration.thumbnailUrl);
      expect(resolveAssetUrl(integration.modelUrl, "/toyota-showroom")).toBe(
        `/toyota-showroom${integration.modelUrl}`,
      );
      expect(resolveAssetUrl(integration.thumbnailUrl, "/toyota-showroom")).toBe(
        `/toyota-showroom${integration.thumbnailUrl}`,
      );
      expect(existsSync(path.join(process.cwd(), "public", integration.modelUrl))).toBe(true);
      expect(existsSync(path.join(process.cwd(), "public", integration.thumbnailUrl))).toBe(true);
    });

    it(`${integration.slug} registers authored options and scene identity`, () => {
      const options = getOptionsForVehicle(integration.slug).filter(
        (option) => option.geometrySource !== "procedural-runtime",
      );
      expect(options.length).toBeGreaterThan(0);
      expect(options.every((option) => option.compatibleVehicleIds.includes(integration.slug))).toBe(true);
      expect(getSceneMapForVehicle(integration.slug).length).toBeGreaterThan(0);
    });
  }
});
