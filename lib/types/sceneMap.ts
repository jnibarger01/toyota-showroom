/**
 * Semantic scene identity — the mapping/validation layer between an imported GLB's node and
 * material names and the stable IDs the runtime (`SceneRegistry`, picking, `VehicleSceneController`)
 * addresses vehicle parts by.
 *
 * Deliberately a separate schema from `CustomizationOption` (`lib/types/customization.ts`):
 * that type answers "what can a user do to this part" (materials to write, nodes to hide), this
 * one answers "what is this part called and how do I find it" — identity, not behaviour. A part
 * can have scene identity with no customization option (a windshield you can click but not repaint)
 * and vice versa is not meaningful, which is exactly why the two are not merged into one record.
 */

/** What a semantic part can be used for — drives `SceneRegistry.findByCapability` queries. */
export type SemanticCapability =
  | "selectable"
  | "paintable"
  | "highlightable"
  | "wheel"
  | "tire"
  | "light"
  | "accessory";

/**
 * How a semantic ID resolves against the loaded scene graph.
 *
 * - `object` — the semantic part *is* a named node (a wheel, an accessory group).
 * - `material-region` — the semantic part is one material slot of a node that carries several
 *   (the 4Runner's single-mesh `BODY`, whose ten material slots are paint, glass, chrome, and
 *   four distinct light types). Picking disambiguates by the raycast hit's face material index.
 */
export type SceneMapMatch =
  | { kind: "object"; objectName: string }
  | { kind: "material-region"; objectName: string; materialNames: readonly string[] };

export interface SceneMapEntry {
  /** Stable semantic ID, e.g. "wheel.front-left". Never a raw node or material name. */
  id: string;
  /** Coarse part category — "wheel" | "body" | "light" | "accessory" | "door" | ... */
  type: string;
  /** Human-readable label for UI (part lists, ARIA labels, agent-facing descriptions). */
  label: string;
  capabilities: readonly SemanticCapability[];
  match: SceneMapMatch;
}
