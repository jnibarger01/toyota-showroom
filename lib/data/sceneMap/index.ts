import type { SceneMapEntry } from "../../types/sceneMap";
import { FOUR_RUNNER_SCENE_MAP } from "./4runner";
import { AE86_SCENE_MAP } from "./ae86";

const SCENE_MAPS: Record<string, readonly SceneMapEntry[]> = {
  "4runner": FOUR_RUNNER_SCENE_MAP,
  ae86: AE86_SCENE_MAP,
};

/**
 * Camry and Tacoma have no detailed GLB today (`hasModel: false` in `lib/data/vehicles/*.ts`) and
 * so no scene map: `buildSceneRegistry` against an empty map registers nothing, and every
 * `SceneRegistry` query on it returns "not found" rather than throwing — the same graceful
 * degradation a vehicle with a partial map gets, just total instead of partial.
 */
export function getSceneMapForVehicle(slug: string): readonly SceneMapEntry[] {
  return SCENE_MAPS[slug] ?? [];
}
