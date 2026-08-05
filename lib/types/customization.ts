/**
 * Customization schema (v1) — the contract that binds a UI control to a 3D mutation and to a
 * persisted record. Every layer (React control, Three.js scene, REST API, database) refers to an
 * option by its stable `id`; display labels, hex values, GLB paths, and node names are never sent
 * from the browser as instructions.
 */

export const CUSTOMIZATION_SCHEMA_VERSION = "1.0.0";

export type CustomizationCategory =
  | "paint"
  | "wheels"
  | "hood"
  | "panel"
  | "decal"
  | "trim"
  | "accessory"
  | "interior";

/**
 * Deterministic application order. Later categories may depend on nodes introduced by earlier
 * ones (a decal targets a panel; paint must repaint whatever hood is currently mounted), so
 * restoration always walks this list rather than object key order, which is insertion-dependent.
 * `interior` sits beside `paint` — both are colour/material choices with no dependency on, or
 * from, any other category.
 */
export const CATEGORY_APPLY_ORDER: readonly CustomizationCategory[] = [
  "trim",
  "panel",
  "hood",
  "wheels",
  "paint",
  "interior",
  "decal",
  "accessory",
];

/**
 * Categories where exactly one option is active at a time (a vehicle has one paint colour) versus
 * categories that accumulate (a vehicle may carry several accessories). Drives both the store's
 * selection semantics and server-side validation.
 */
export const MULTI_SELECT_CATEGORIES: readonly CustomizationCategory[] = ["accessory", "decal"];

export function isMultiSelect(category: CustomizationCategory): boolean {
  return MULTI_SELECT_CATEGORIES.includes(category);
}

export type CustomizationOperation =
  | "material-update"
  | "mesh-visibility"
  | "mesh-replacement"
  | "texture-update";

export interface MaterialConfig {
  color?: string;
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  textureUrl?: string;
}

export interface CustomizationOption {
  id: string;
  category: CustomizationCategory;
  label: string;
  thumbnailUrl?: string;
  /**
   * Exact `Object3D.name` values to resolve with `getObjectByName`. Never an index, never a
   * traversal position. A name that is absent from the loaded GLB is a contract violation and is
   * reported by `verifyNodeContract` at load time rather than failing silently on click.
   */
  targetNodes?: string[];
  /**
   * Exact `Material.name` values. Used to select slots *within* a multi-material mesh — the
   * 4Runner `BODY` mesh carries ten materials, so a paint option must name `body.carmain` rather
   * than rewrite the whole array.
   */
  targetMaterials?: string[];
  operation: CustomizationOperation;
  /**
   * Sub-group within a category that shares the category's cardinality independently.
   *
   * A category is too coarse a unit on its own: `trim` covers both grille finish and tyre lettering,
   * which are separately configurable. Without a group, choosing a grille would evict the tyre
   * selection from state while its material stayed applied to the scene. Defaults to the category,
   * so options that don't need sub-grouping are unaffected.
   */
  selectionGroup?: string;
  /** Server-resolved. Populated from the trusted asset map; never accepted from a client. */
  assetUrl?: string;
  materialConfig?: MaterialConfig;
  /**
   * Names of sibling nodes this option hides when it is applied. Models exported with every
   * variant baked in (stock + sport hood in one GLB) use visibility rather than mesh replacement;
   * this makes the mutual exclusion explicit instead of implied by category.
   */
  hidesNodes?: string[];
  /** Mount point (`Object3D.name`) a replacement asset is attached to, preserving its transform. */
  mountNodes?: string[];
  priceDelta?: number;
  compatibleVehicleIds: string[];
  /** Grade ids this option is restricted to. Empty/undefined means every grade of a compatible vehicle. */
  compatibleGradeIds?: string[];
}

export interface CameraState {
  presetId?: string;
  position: [number, number, number];
  target: [number, number, number];
}

/** A selection map keyed by category. Single-select categories hold at most one id. */
export type SelectionMap = Partial<Record<CustomizationCategory, string[]>>;

export interface VehicleConfiguration {
  configurationId: string;
  vehicleId: string;
  modelYear: number;
  model: string;
  gradeId: string;
  selections: SelectionMap;
  cameraState?: CameraState;
  /** Bumped by the server on every accepted mutation; used for optimistic-concurrency checks. */
  revision: number;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
}

/** Client-side draft before the server has minted an id. */
export type ConfigurationDraft = Omit<
  VehicleConfiguration,
  "configurationId" | "revision" | "createdAt" | "updatedAt" | "schemaVersion"
>;

export function selectedIds(configuration: VehicleConfiguration): string[] {
  return CATEGORY_APPLY_ORDER.flatMap((category) => configuration.selections[category] ?? []);
}

/** The unit that single-select cardinality applies to. Defaults to the category. */
export function selectionGroupOf(
  option: Pick<CustomizationOption, "category" | "selectionGroup">,
): string {
  return option.selectionGroup ?? option.category;
}

/**
 * Applies one option to a selection map without mutating the input, honouring single- versus
 * multi-select semantics. Shared by the client store and the server so both compute identical
 * results from the same inputs.
 *
 * A single-select choice evicts only the other members of its own `selectionGroup`, so picking a
 * grille does not silently drop an unrelated tyre-lettering selection filed under the same category.
 * Resolving the group needs the rest of the catalog, which is why the whole option list is passed.
 */
export function withOptionSelected(
  selections: SelectionMap,
  option: Pick<CustomizationOption, "id" | "category" | "selectionGroup">,
  catalog: readonly CustomizationOption[] = [],
): SelectionMap {
  const current = selections[option.category] ?? [];
  if (current.includes(option.id)) {
    return isMultiSelect(option.category) ? selections : { ...selections, [option.category]: [option.id] };
  }

  if (isMultiSelect(option.category)) {
    return { ...selections, [option.category]: [...current, option.id] };
  }

  const group = selectionGroupOf(option);
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const kept = current.filter((id) => {
    const existing = byId.get(id);
    // An id the catalog cannot resolve is dropped: it is either stale or from another vehicle,
    // and keeping it would let an unverifiable selection survive indefinitely.
    return existing ? selectionGroupOf(existing) !== group : false;
  });

  return { ...selections, [option.category]: [...kept, option.id] };
}

export function withOptionDeselected(
  selections: SelectionMap,
  option: Pick<CustomizationOption, "id" | "category">,
): SelectionMap {
  const current = selections[option.category] ?? [];
  return { ...selections, [option.category]: current.filter((id) => id !== option.id) };
}

export function isSelected(
  selections: SelectionMap,
  option: Pick<CustomizationOption, "id" | "category">,
): boolean {
  return (selections[option.category] ?? []).includes(option.id);
}
