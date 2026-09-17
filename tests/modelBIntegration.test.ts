import { existsSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getOptionsForVehicle } from "../lib/data/options";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";
import { getAllVehicleSlugs, getVehicleBySlug } from "../lib/data/vehicles";
import { resolveAssetUrl } from "../lib/three/assetUrl";
import { VehicleSceneController } from "../lib/three/sceneController";
import { inspectGlb } from "../lib/tooling/glbInspect";

const GT86_MODEL_PATH = path.join(process.cwd(), "public/models/gt86/toyota_gt86.glb");

function getGt86BodyNodes(): string[] {
  return [...inspectGlb(GT86_MODEL_PATH).materialsByNode.entries()]
    .filter(([, materials]) => materials.has("body.001"))
    .map(([nodeName]) => nodeName)
    .sort();
}

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

  it("covers every GT86 body.001 mesh with every paint option and the semantic body map", () => {
    const bodyNodes = getGt86BodyNodes();

    expect(bodyNodes).toEqual([
      "Object_10",
      "Object_11",
      "Object_12",
      "Object_13",
      "Object_14",
      "Object_15",
      "Object_16",
      "Object_17",
    ]);

    const paintOptions = getOptionsForVehicle("gt86").filter(
      (option) => option.category === "paint" && option.geometrySource !== "procedural-runtime",
    );
    expect(paintOptions.length).toBeGreaterThan(0);
    for (const option of paintOptions) {
      expect([...new Set(option.targetNodes)].sort(), option.id).toEqual(bodyNodes);
    }

    const bodyEntries = getSceneMapForVehicle("gt86").filter(
      (entry) => entry.match.kind === "material-region" && entry.match.materialNames.includes("body.001"),
    );
    expect(new Set(bodyEntries.map((entry) => entry.id)).size).toBe(bodyEntries.length);
    expect(
      bodyEntries.map((entry) => entry.match.objectName).sort(),
    ).toEqual(bodyNodes);
  });

  it("materially repaints every GT86 body mesh through the runtime scene controller", async () => {
    const bodyNodes = getGt86BodyNodes();
    const root = new THREE.Group();
    for (const nodeName of bodyNodes) {
      const material = new THREE.MeshStandardMaterial({ color: "#777777" });
      material.name = "body.001";
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.name = nodeName;
      root.add(mesh);
    }

    const paintOption = getOptionsForVehicle("gt86").find((option) => option.id === "gt86-paint-red");
    expect(paintOption).toBeDefined();
    if (!paintOption) return;

    const bodySceneMap = getSceneMapForVehicle("gt86").filter(
      (entry) => entry.match.kind === "material-region" && entry.match.materialNames.includes("body.001"),
    );
    const controller = new VehicleSceneController(root, [paintOption], bodySceneMap);
    expect(controller.sceneMapReport.unsatisfied).toEqual([]);
    expect(await controller.applyOption(paintOption)).toBe(true);

    const expectedColor = new THREE.Color(paintOption.materialConfig?.color).getHexString();
    for (const nodeName of bodyNodes) {
      const mesh = root.getObjectByName(nodeName);
      expect(mesh, nodeName).toBeInstanceOf(THREE.Mesh);
      const material = (mesh as THREE.Mesh).material;
      expect(material, nodeName).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect((material as THREE.MeshStandardMaterial).color.getHexString(), nodeName).toBe(expectedColor);
    }

    controller.dispose();
  });
});
