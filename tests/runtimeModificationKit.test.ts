import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { VEHICLES } from "../lib/data/vehicles";
import { getOptionsForVehicle } from "../lib/data/options";
import { createProceduralVehicle } from "../lib/three/proceduralParts";
import {
  buildRuntimeModificationKit,
  RUNTIME_MOD_NODE_NAMES,
} from "../lib/three/proceduralMods";
import { verifyNodeContract } from "../lib/three/nodes";

const REQUIRED_RUNTIME_SUFFIXES = [
  "rims-mesh",
  "tires-track",
  "brakes-big-red",
  "exhaust-titanium-dual",
  "aero-ducktail",
  "aero-front-splitter",
  "aero-side-skirts",
  "aero-rear-diffuser",
  "carbon-hood-accent",
  "trim-blackout",
  "lighting-underglow",
  "paint-satin-graphite",
] as const;

describe("runtime modification catalog", () => {
  it.each(VEHICLES.map((vehicle) => [vehicle.slug] as const))(
    "%s receives the complete 12-option runtime package",
    (slug) => {
      const runtime = getOptionsForVehicle(slug).filter((option) => option.id.startsWith(`runtime-${slug}-`));
      expect(runtime).toHaveLength(REQUIRED_RUNTIME_SUFFIXES.length);
      expect(runtime.map((option) => option.id).sort()).toEqual(
        REQUIRED_RUNTIME_SUFFIXES.map((suffix) => `runtime-${slug}-${suffix}`).sort(),
      );
    },
  );

  it("uses dedicated categories for tires, brakes, exhaust, aero, and carbon", () => {
    const runtime = getOptionsForVehicle("camry").filter((option) => option.id.startsWith("runtime-camry-"));
    expect(new Set(runtime.map((option) => option.category))).toEqual(
      new Set(["wheels", "tires", "brakes", "exhaust", "aero", "carbon", "trim", "lighting", "paint"]),
    );
  });
});

describe("runtime modification geometry", () => {
  it("builds every generated target as hidden Three.js geometry before catalog verification", () => {
    const root = createProceduralVehicle();
    buildRuntimeModificationKit(root, "tacoma");

    for (const nodeName of Object.values(RUNTIME_MOD_NODE_NAMES)) {
      const node = root.getObjectByName(nodeName);
      expect(node, nodeName).toBeDefined();
      expect(node?.visible, nodeName).toBe(false);
    }
  });

  it.each(VEHICLES.map((vehicle) => [vehicle.slug] as const))(
    "%s satisfies every procedural-runtime catalog target",
    (slug) => {
      const root = createProceduralVehicle();
      buildRuntimeModificationKit(root, slug);
      const runtimeGeometryOptions = getOptionsForVehicle(slug).filter(
        (option) => option.geometrySource === "procedural-runtime",
      );
      const report = verifyNodeContract(root, runtimeGeometryOptions);
      expect(report.unsatisfied).toEqual([]);
      expect(report.satisfied).toHaveLength(runtimeGeometryOptions.length);
    },
  );

  it("creates four wheel/rim assemblies and four brake assemblies", () => {
    const root = createProceduralVehicle();
    buildRuntimeModificationKit(root, "tacoma");
    const rims = root.getObjectByName(RUNTIME_MOD_NODE_NAMES.rims) as THREE.Group;
    const tires = root.getObjectByName(RUNTIME_MOD_NODE_NAMES.tires) as THREE.Group;
    const brakes = root.getObjectByName(RUNTIME_MOD_NODE_NAMES.brakes) as THREE.Group;
    expect(rims.children).toHaveLength(4);
    expect(tires.children).toHaveLength(4);
    expect(brakes.children).toHaveLength(4);
  });
});
