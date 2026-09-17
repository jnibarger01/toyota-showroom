import path from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getVehicleBySlug } from "../lib/data/vehicles";
import { getOptionsForVehicle } from "../lib/data/options";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";

const cases = [
  { slug: "rav4-hybrid", year: 2023, model: "RAV4 Hybrid", modelUrl: "/models/rav4-hybrid-2023/rav4-hybrid.glb", thumbnail: "/images/vehicles/rav4-hybrid/rav4-hybrid-front-three-quarter.png" },
  { slug: "land-cruiser", year: 2025, model: "Land Cruiser", modelUrl: "/models/land-cruiser-250-2025/land-cruiser-250.glb", thumbnail: "/images/vehicles/land-cruiser/land-cruiser-front-three-quarter.png" },
] as const;

describe("RAV4 Hybrid and Land Cruiser showroom integration", () => {
  for (const entry of cases) {
    it(`registers ${entry.model} with its authored GLB and customization metadata`, () => {
      const vehicle = getVehicleBySlug(entry.slug);
      expect(vehicle).toBeDefined();
      if (!vehicle) return;
      expect(vehicle.year).toBe(entry.year);
      expect(vehicle.threeDConfig.hasModel).toBe(true);
      expect(vehicle.threeDConfig.modelUrl).toBe(entry.modelUrl);
      expect(vehicle.media.thumbnails[0]?.url).toBe(entry.thumbnail);
      expect(existsSync(path.join(process.cwd(), "public", entry.modelUrl))).toBe(true);
      expect(getSceneMapForVehicle(entry.slug).length).toBeGreaterThan(0);
      const options = getOptionsForVehicle(entry.slug);
      expect(options.length).toBeGreaterThanOrEqual(20);
      expect(options.every((option) => option.compatibleVehicleIds.includes(entry.slug))).toBe(true);
    });
  }
});
