import { describe, expect, it } from "vitest";
import { checkSceneMapContract } from "../lib/tooling/sceneMapContract";
import type { SceneMapEntry } from "../lib/types/sceneMap";
import type { GlbInspection } from "../lib/tooling/glbInspect";
import { FOUR_RUNNER_SCENE_MAP } from "../lib/data/sceneMap/4runner";

function inspection(nodeNames: string[], materialsByNode: Record<string, string[]> = {}): GlbInspection {
  return {
    nodeNames: new Set(nodeNames),
    materialsByNode: new Map(Object.entries(materialsByNode).map(([node, names]) => [node, new Set(names)])),
  };
}

describe("checkSceneMapContract", () => {
  it("satisfies an object-level entry whose node is present", () => {
    const report = checkSceneMapContract(inspection(["PLACED_WEISU_front_left"]), [
      {
        id: "wheel.front-left",
        type: "wheel",
        label: "Front-left wheel",
        capabilities: ["selectable", "wheel"],
        match: { kind: "object", objectName: "PLACED_WEISU_front_left" },
      },
    ]);
    expect(report.satisfied.map((e) => e.id)).toEqual(["wheel.front-left"]);
    expect(report.unsatisfied).toEqual([]);
  });

  it("reports a missing node without throwing", () => {
    const report = checkSceneMapContract(inspection([]), [
      {
        id: "door.front-left",
        type: "door",
        label: "Front-left door",
        capabilities: ["selectable"],
        match: { kind: "object", objectName: "DOOR_FRONT_LEFT" },
      },
    ]);
    expect(report.satisfied).toEqual([]);
    expect(report.unsatisfied[0]?.reason).toContain('missing node "DOOR_FRONT_LEFT"');
  });

  it("satisfies a material-region entry only when every named slot is present on that node", () => {
    const entries: SceneMapEntry[] = [
      {
        id: "body.exterior",
        type: "body",
        label: "Exterior paint",
        capabilities: ["paintable"],
        match: { kind: "material-region", objectName: "BODY", materialNames: ["body.carmain"] },
      },
    ];

    const satisfied = checkSceneMapContract(inspection(["BODY"], { BODY: ["body.carmain", "glass.windows"] }), entries);
    expect(satisfied.satisfied).toHaveLength(1);

    const missingMaterial = checkSceneMapContract(inspection(["BODY"], { BODY: ["glass.windows"] }), entries);
    expect(missingMaterial.unsatisfied[0]?.reason).toContain("body.carmain");
  });

  it("resolves the real 4Runner scene map against a synthetic inspection matching the shipped GLB's known structure", () => {
    const glb = inspection(
      ["VEHICLE_ROOT", "BODY", "Tun_GRILLE", "PLACED_WEISU_front_left", "PLACED_WEISU_front_right", "PLACED_WEISU_rear_left", "PLACED_WEISU_rear_right", "PLACED_KO3_front_left", "PLACED_KO3_front_right", "PLACED_KO3_rear_left", "PLACED_KO3_rear_right", "ACCESSORY_ROOF_RACK", "ACCESSORY_LIGHT_BAR", "ACCESSORY_ROCK_SLIDERS", "ACCESSORY_UNDERGLOW", "ACCESSORY_FOG_LIGHTS"],
      {
        BODY: [
          "body.carmain",
          "metal.chrome.004",
          "glass.windows",
          "glass.windows.windshield",
          "glass.windows.rear.windshield",
          "plastik.all.004",
          "glass.light.002",
          "emissive.foglight",
          "emissive.brakelights.001",
          "emissive.turnsignal.002",
        ],
      },
    );

    const report = checkSceneMapContract(glb, FOUR_RUNNER_SCENE_MAP);
    // Every entry except the forward-declared, not-yet-modeled parts should resolve.
    const stillMissing = ["door.front-left", "door.front-right", "mirror.left", "mirror.right", "badge.front", "interior", "roof"];
    expect(report.unsatisfied.map((u) => u.entry.id).sort()).toEqual(stillMissing.sort());
    expect(report.satisfied.length).toBe(FOUR_RUNNER_SCENE_MAP.length - stillMissing.length);
  });
});
