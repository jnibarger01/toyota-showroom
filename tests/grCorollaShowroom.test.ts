import path from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getVehicleBySlug } from "../lib/data/vehicles";
import { getOptionsForVehicle } from "../lib/data/options";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";

const MODEL_URL = "/models/gr-corolla-2023/2023_toyota_gr_corolla.glb";
const THUMBNAIL_URL = "/images/vehicles/gr-corolla/gr-corolla-front-three-quarter.png";

describe("2023 GR Corolla showroom integration", () => {
  it("registers the GR Corolla as a 3D hatchback", () => {
    const vehicle = getVehicleBySlug("gr-corolla");
    expect(vehicle).toBeDefined();
    if (!vehicle) return;

    expect(vehicle.year).toBe(2023);
    expect(vehicle.model).toBe("GR Corolla");
    expect(vehicle.bodyStyle).toBe("hatchback");
    expect(vehicle.threeDConfig.hasModel).toBe(true);
    expect(vehicle.threeDConfig.modelUrl).toBe(MODEL_URL);
    expect(vehicle.media.thumbnails[0]?.url).toBe(THUMBNAIL_URL);
  });

  it("ships both the runtime GLB and Explore thumbnail", () => {
    expect(existsSync(path.join(process.cwd(), "public", MODEL_URL))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public", THUMBNAIL_URL))).toBe(true);
  });

  it("registers authored scene metadata and customization options", () => {
    const sceneMap = getSceneMapForVehicle("gr-corolla");
    const options = getOptionsForVehicle("gr-corolla");

    expect(sceneMap.length).toBeGreaterThan(0);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.compatibleVehicleIds.includes("gr-corolla"))).toBe(true);
  });
});
