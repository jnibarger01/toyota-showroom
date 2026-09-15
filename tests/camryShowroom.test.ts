import path from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { camry } from "../lib/data/vehicles/camry";
import { camryOptions } from "../lib/data/options/camry";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";
import { inspectGlb } from "../lib/tooling/glbInspect";
import { requiredNodeNames } from "../lib/three/nodes";

const MODEL_URL = "/models/camry-2025/2025_toyota_camry_xv80_hybrid.glb";

describe("2025 Camry showroom integration", () => {
  it("ships a real XV80 GLB instead of the procedural fallback", () => {
    expect(camry.threeDConfig.hasModel).toBe(true);
    expect(camry.threeDConfig.modelUrl).toBe(MODEL_URL);
    expect(camry.threeDConfig.scale).toEqual([100, 100, 100]);
    expect(camry.threeDConfig.texturePolicy).toBe("factors-only");
    expect(existsSync(path.join(process.cwd(), "public", MODEL_URL))).toBe(true);
  });

  it("registers an authored scene map", () => {
    const sceneMap = getSceneMapForVehicle("camry");
    expect(sceneMap.length).toBeGreaterThanOrEqual(8);
    expect(sceneMap.some((entry) => entry.id === "body.paint")).toBe(true);
    expect(sceneMap.some((entry) => entry.id === "light.headlights")).toBe(true);
    expect(sceneMap.some((entry) => entry.id === "interior.seats")).toBe(true);
  });
  it("resolves every Camry customization option against the shipped GLB", () => {
    const filePath = path.join(process.cwd(), "public", MODEL_URL);
    expect(existsSync(filePath)).toBe(true);
    if (!existsSync(filePath)) return;

    const inspection = inspectGlb(filePath);
    for (const option of camryOptions) {
      const missingNodes = requiredNodeNames(option).filter((name) => !inspection.nodeNames.has(name));
      const presentMaterials = new Set<string>();
      for (const nodeName of option.targetNodes ?? []) {
        for (const materialName of inspection.materialsByNode.get(nodeName) ?? []) {
          presentMaterials.add(materialName);
        }
      }
      const missingMaterials = (option.targetMaterials ?? []).filter(
        (name) => !presentMaterials.has(name),
      );
      expect(
        { missingNodes, missingMaterials },
        `${option.id} must resolve against the Camry GLB`,
      ).toEqual({ missingNodes: [], missingMaterials: [] });
    }
  });
});