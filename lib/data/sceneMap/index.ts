import type { SceneMapEntry } from "../../types/sceneMap";
import { FOUR_RUNNER_SCENE_MAP } from "./4runner";
import { AE86_SCENE_MAP } from "./ae86";
import { RAV4_SCENE_MAP } from "./rav4";
import { GR_SUPRA_SCENE_MAP } from "./gr-supra";
import { CAMRY_SCENE_MAP } from "./camry";
import { RAV4_HYBRID_SCENE_MAP } from "./rav4-hybrid";
import { LAND_CRUISER_SCENE_MAP } from "./land-cruiser";

const SCENE_MAPS: Record<string, readonly SceneMapEntry[]> = {
  "4runner": FOUR_RUNNER_SCENE_MAP,
  ae86: AE86_SCENE_MAP,
  rav4: RAV4_SCENE_MAP,
  "rav4-hybrid": RAV4_HYBRID_SCENE_MAP,
  "land-cruiser": LAND_CRUISER_SCENE_MAP,
  "gr-supra": GR_SUPRA_SCENE_MAP,
  camry: CAMRY_SCENE_MAP,
};

/** Tacoma still uses the procedural fallback and therefore has no authored scene map. */
export function getSceneMapForVehicle(slug: string): readonly SceneMapEntry[] {
  return SCENE_MAPS[slug] ?? [];
}
