import * as THREE from "three";
import {
  CATEGORY_APPLY_ORDER,
  isMultiSelect,
  selectionGroupOf,
  type CustomizationOption,
  type SelectionMap,
} from "../types/customization";
import { MaterialWriter } from "./materials";
import { resolveMeshes, resolveNodes } from "./nodes";
import { attachToMount, detachFromMount, disposeSubtree, instantiateAsset, loadAsset } from "./assets";
import type { PaintStudioState } from "../types/paintStudio";
import { finishForCustomMetalness } from "./paintFinish";
import {
  materialConfigFromPaintStudio,
  PAINT_CUSTOM_OPTION_ID,
  PAINT_STUDIO_TARGET_MATERIALS,
  PAINT_STUDIO_TARGET_NODES,
} from "../data/paintStudio";
import { buildSceneRegistry, SceneRegistry, type SceneMapReport } from "./sceneRegistry";
import { PartHighlighter, type HighlightState } from "./highlight";
import type { SceneMapEntry } from "../types/sceneMap";
import { VehiclePicker, type PickResult } from "./picking";

/**
 * Owns every mutation applied to a loaded vehicle scene.
 *
 * One controller per loaded model. It holds the `MaterialWriter` (and therefore every cloned
 * material), tracks attachments it made, and is the only thing in the codebase that writes to the
 * scene graph — so teardown is a single `dispose()` rather than a scatter of cleanup callbacks.
 */
export class VehicleSceneController {
  readonly root: THREE.Object3D;
  private readonly writer = new MaterialWriter();
  private readonly catalog: Map<string, CustomizationOption>;
  private readonly highlighter = new PartHighlighter();
  private readonly registry: SceneRegistry;
  private readonly picker: VehiclePicker;
  readonly sceneMapReport: SceneMapReport;
  private hoveredId: string | undefined;
  private selectedId: string | undefined;
  /**
   * `Object3D.visible` as the loaded scene supplied it, for every node any catalog option can show
   * or hide. Captured once, at construction, *after* `prepareVehicleRoot` has hidden the donor
   * geometry — so "original" means "what this vehicle looks like with nothing selected", which is
   * exactly the state a reverted option has to return to.
   */
  private readonly originalVisibility = new Map<THREE.Object3D, boolean>();
  /**
   * The option currently applied in each single-select `selectionGroup`.
   *
   * Single-select is enforced in the selection map, but the *scene* needs the same guarantee and
   * cannot infer it: an option that hid geometry has to be told to give it back when a sibling in
   * its group replaces it. Without this, choosing a wheel package and then a factory wheel finish
   * leaves the vehicle with no wheels at all — the package's `hidesNodes` still in force with the
   * package itself no longer shown.
   */
  private readonly activeByGroup = new Map<string, string>();

  /**
   * `sceneMap` is optional and defaults to empty so every existing call site (which predates
   * semantic scene identity) keeps compiling and behaving exactly as before — a controller built
   * with no scene map simply has no addressable parts, the same graceful-empty behavior
   * `buildSceneRegistry` gives any vehicle without one (`lib/data/sceneMap/index.ts`).
   */
  constructor(root: THREE.Object3D, catalog: readonly CustomizationOption[], sceneMap: readonly SceneMapEntry[] = []) {
    this.root = root;
    this.catalog = new Map(catalog.map((option) => [option.id, option]));
    const built = buildSceneRegistry(root, sceneMap);
    this.registry = built.registry;
    this.sceneMapReport = built.report;
    this.picker = new VehiclePicker(this.registry);
    this.picker.prepare(root);
    this.captureOriginalVisibility(catalog);
  }

  private captureOriginalVisibility(catalog: readonly CustomizationOption[]): void {
    for (const option of catalog) {
      for (const name of [...(option.targetNodes ?? []), ...(option.hidesNodes ?? [])]) {
        const node = this.root.getObjectByName(name);
        if (node && !this.originalVisibility.has(node)) {
          this.originalVisibility.set(node, node.visible);
        }
      }
    }
  }

  /** Restores one node to the visibility the loaded scene gave it, defaulting to visible. */
  private restoreVisibility(node: THREE.Object3D): void {
    node.visible = this.originalVisibility.get(node) ?? true;
  }

  /**
   * Undoes an option's visibility effects without touching materials.
   *
   * Materials are deliberately left alone: `MaterialWriter` is restored wholesale by
   * `applyConfiguration`, and an incremental single-option swap within a group (bronze wheels to
   * black wheels) is meant to overwrite the previous write, not revert it first.
   */
  private revertGroupVisibility(option: CustomizationOption): void {
    for (const node of resolveNodes(this.root, option.hidesNodes ?? []).found) {
      this.restoreVisibility(node);
    }
    if (option.operation === "mesh-visibility") {
      for (const node of resolveNodes(this.root, option.targetNodes ?? []).found) {
        this.restoreVisibility(node);
      }
    }
    if (option.operation === "mesh-replacement") {
      for (const mount of resolveNodes(this.root, option.mountNodes ?? []).found) {
        detachFromMount(mount);
      }
    }
  }

  /**
   * Accelerated raycast pick, resolved to a semantic part — the one entry point consumers need for
   * "what did the user click", so nothing outside this controller has to hold its own
   * `THREE.Raycaster` or reach into `root` directly. `pointer` is normalized device coordinates
   * (each axis in [-1, 1]; `pointerToNdc` in `lib/three/picking.ts` converts a client-space event).
   */
  pickAt(pointer: THREE.Vector2, camera: THREE.Camera): PickResult | null {
    return this.picker.pick(pointer, camera, this.root);
  }

  getOption(optionId: string): CustomizationOption | undefined {
    return this.catalog.get(optionId);
  }

  // --- Semantic part identity (SceneRegistry passthrough) ---------------------------------------

  getPart(id: string) {
    return this.registry.get(id);
  }

  hasPart(id: string): boolean {
    return this.registry.has(id);
  }

  listParts() {
    return this.registry.list();
  }

  findPartsByType(type: string) {
    return this.registry.findByType(type);
  }

  findPartsByCapability(capability: Parameters<SceneRegistry["findByCapability"]>[0]) {
    return this.registry.findByCapability(capability);
  }

  /** Resolves a raycast hit's object (and, for a multi-material mesh, the hit material name) to a semantic ID. Used by `VehiclePicker`. */
  resolvePart(object: THREE.Object3D, materialName?: string) {
    return this.registry.resolve(object, materialName);
  }

  // --- Hover / selection --------------------------------------------------------------------------
  //
  // Selection takes visual precedence over hover: hovering an already-selected part is a no-op
  // for its tint (still tracked, so `hoveredPartId` reflects reality), and clearing selection on a
  // still-hovered part restores the hover tint rather than dropping to no highlight at all.

  get hoveredPartId(): string | undefined {
    return this.hoveredId;
  }

  get selectedPartId(): string | undefined {
    return this.selectedId;
  }

  private paintHighlight(id: string, state: HighlightState): boolean {
    const entry = this.registry.get(id);
    if (!entry || !entry.capabilities.includes("highlightable")) return false;
    this.highlighter.apply(entry, state);
    return true;
  }

  private repaintHighlights(): void {
    if (this.selectedId) this.paintHighlight(this.selectedId, "selected");
    if (this.hoveredId && this.hoveredId !== this.selectedId) this.paintHighlight(this.hoveredId, "hover");
  }

  hoverPart(id: string | undefined): void {
    if (this.hoveredId === id) return;
    if (this.hoveredId && this.hoveredId !== this.selectedId) this.highlighter.clear(this.hoveredId);
    this.hoveredId = id;
    this.repaintHighlights();
  }

  selectPart(id: string | undefined): void {
    if (this.selectedId === id) return;
    const previouslySelected = this.selectedId;
    this.selectedId = id;
    // The old selection loses its tint entirely unless it is also the current hover, in which
    // case it drops back to the hover tint rather than going bare.
    if (previouslySelected) {
      this.highlighter.clear(previouslySelected);
      if (previouslySelected === this.hoveredId) this.paintHighlight(previouslySelected, "hover");
    }
    this.repaintHighlights();
  }

  clearSelection(): void {
    this.selectPart(undefined);
  }

  /** The given ids, ordered as the catalog declares them. Ids the catalog cannot resolve keep their
   * relative position, so an unknown id still reaches `applyConfiguration`'s `failed` list. */
  private inCatalogOrder(optionIds: readonly string[]): string[] {
    const rank = new Map([...this.catalog.keys()].map((id, index) => [id, index]));
    return [...optionIds].sort(
      (left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  /**
   * Re-applies the options that the catalog orders *after* `option` within its category.
   *
   * A single click does not replay a configuration, so nothing else would restore the relationship
   * between two groups that write the same material slot. Picking a paint colour after a finish
   * overwrites the finish's metalness and roughness with the colour's own; this puts the finish
   * back, which is what makes "colour then finish" and "finish then colour" end in the same place.
   *
   * Only later groups are replayed, and only material updates: an earlier group has already had its
   * say, and re-running a mesh operation would undo the visibility work `applyOption` just did.
   */
  private async reapplyDependentGroups(option: CustomizationOption): Promise<void> {
    const group = selectionGroupOf(option);
    let seenSelf = false;

    for (const candidate of this.catalog.values()) {
      if (candidate.id === option.id) {
        seenSelf = true;
        continue;
      }
      if (!seenSelf) continue;
      if (candidate.category !== option.category) continue;
      if (candidate.operation !== "material-update") continue;

      const candidateGroup = selectionGroupOf(candidate);
      if (candidateGroup === group) continue;
      if (this.activeByGroup.get(candidateGroup) !== candidate.id) continue;

      this.applyMaterialUpdate(candidate);
    }
  }

  /**
   * Applies a single option. Returns `false` when the option's nodes are not present, which the
   * caller surfaces as an error rather than treating as success — a silent no-op here is exactly
   * the failure mode this integration exists to remove.
   */
  async applyOption(option: CustomizationOption): Promise<boolean> {
    if (!isMultiSelect(option.category)) {
      const group = selectionGroupOf(option);
      const previous = this.activeByGroup.get(group);
      if (previous && previous !== option.id) {
        const outgoing = this.catalog.get(previous);
        if (outgoing) this.revertGroupVisibility(outgoing);
      }
      this.activeByGroup.set(group, option.id);
    }

    const applied = await this.applyOperation(option);
    if (applied && !isMultiSelect(option.category)) await this.reapplyDependentGroups(option);
    return applied;
  }

  private async applyOperation(option: CustomizationOption): Promise<boolean> {
    switch (option.operation) {
      case "material-update":
        return this.applyMaterialUpdate(option);
      case "texture-update":
        return this.applyTextureUpdate(option);
      case "mesh-visibility":
        return this.setVisibility(option, true);
      case "mesh-replacement":
        return this.applyMeshReplacement(option);
    }
  }

  /** Reverses an option. Only meaningful for the accumulating categories (accessory, decal). */
  async removeOption(option: CustomizationOption): Promise<boolean> {
    if (option.operation === "mesh-replacement") {
      const { found } = resolveNodes(this.root, option.mountNodes ?? []);
      for (const mount of found) detachFromMount(mount);
      // Bring back whatever the replacement stood in for. Without this, deselecting leaves neither
      // the replacement nor the original in the scene — a missing wheel rather than a stock one.
      this.restoreDisplaced(option);
      return found.length > 0;
    }
    return this.setVisibility(option, false);
  }

  /** Re-shows the nodes an option hid, used when that option is reversed. */
  private restoreDisplaced(option: CustomizationOption): void {
    const { found } = resolveNodes(this.root, option.hidesNodes ?? []);
    for (const node of found) node.visible = true;
  }

  /**
   * Applies custom paint-studio material params to the catalog paint slot.
   * Targets are resolved from the trusted catalog constants — never from the persisted payload.
   */
  applyPaintStudio(paintStudio: PaintStudioState | undefined): boolean {
    if (!paintStudio || paintStudio.mode !== "custom" || !paintStudio.material) return false;

    // Targets come from this vehicle's own `paint-custom` catalog entry, falling back to the
    // 4Runner-shaped constants for a controller built without one.
    //
    // They used to come from those constants alone, which is why the studio only ever worked on the
    // three vehicles that happen to paint `BODY`/`body.carmain`. The Camry paints `CarPaint`, the
    // AE86 `Body`, the Supra `Paint` — on those, a custom colour resolved no meshes and silently
    // did nothing. The catalog entry is still catalog-owned and server-resolved; nothing about the
    // target names comes from the persisted payload.
    const custom = this.catalog.get(PAINT_CUSTOM_OPTION_ID);
    const nodes = custom?.targetNodes?.length ? custom.targetNodes : [...PAINT_STUDIO_TARGET_NODES];
    const materials = custom?.targetMaterials?.length ? custom.targetMaterials : [...PAINT_STUDIO_TARGET_MATERIALS];

    const meshes = resolveMeshes(this.root, nodes);
    if (meshes.length === 0) return false;
    const config = {
      ...materialConfigFromPaintStudio(paintStudio.material),
      finish: finishForCustomMetalness(paintStudio.material.metalness),
    };
    return this.writer.applyMaterialConfig(meshes, materials, config) > 0;
  }

  private applyMaterialUpdate(option: CustomizationOption): boolean {
    if (!option.materialConfig) return false;
    const meshes = resolveMeshes(this.root, option.targetNodes ?? []);
    if (meshes.length === 0) return false;
    // A `finish` (flake / pearl layer) arrives only on the paint-finish options
    // (`lib/data/paintFinishes.ts`); colours leave it alone, so the two groups compose the same way
    // their surface numbers already do.
    return this.writer.applyMaterialConfig(meshes, option.targetMaterials, option.materialConfig) > 0;
  }

  private async applyTextureUpdate(option: CustomizationOption): Promise<boolean> {
    const textureUrl = option.materialConfig?.textureUrl;
    if (!textureUrl) return false;
    const meshes = resolveMeshes(this.root, option.targetNodes ?? []);
    if (meshes.length === 0) return false;

    const written = await this.writer.applyTexture(meshes, option.targetMaterials, textureUrl);
    if (written === 0) return false;

    if (option.materialConfig) {
      this.writer.applyMaterialConfig(meshes, option.targetMaterials, {
        ...option.materialConfig,
        textureUrl: undefined,
      });
    }

    // Decals are an accumulating category, so `applyConfiguration` hides every decal node before
    // replaying the selected ones. Applying a texture therefore has to make its own nodes visible
    // again, or a saved decal would silently stay hidden after restoration.
    const { found } = resolveNodes(this.root, option.targetNodes ?? []);
    for (const node of found) node.visible = true;

    const { found: displaced } = resolveNodes(this.root, option.hidesNodes ?? []);
    for (const node of displaced) node.visible = false;

    return true;
  }

  /**
   * Visibility toggle for variants baked into the base GLB. `hidesNodes` makes the mutual
   * exclusion between variants explicit in data, so adding a third hood is a catalog edit.
   */
  private setVisibility(option: CustomizationOption, visible: boolean): boolean {
    const { found } = resolveNodes(this.root, option.targetNodes ?? []);
    if (found.length === 0) return false;
    for (const node of found) node.visible = visible;

    if (visible) {
      const { found: hidden } = resolveNodes(this.root, option.hidesNodes ?? []);
      for (const node of hidden) node.visible = false;
    }
    return true;
  }

  private async applyMeshReplacement(option: CustomizationOption): Promise<boolean> {
    if (!option.assetUrl) return false;
    const { found: mounts } = resolveNodes(this.root, option.mountNodes ?? []);
    if (mounts.length === 0) return false;

    const source = await loadAsset(option.assetUrl);

    // Hide the geometry the replacement stands in for before attaching, so the two never coexist.
    const { found: replaced } = resolveNodes(this.root, option.hidesNodes ?? []);
    for (const node of replaced) node.visible = false;

    for (const mount of mounts) {
      attachToMount(mount, instantiateAsset(source), option.id);
    }
    // Newly-mounted geometry has no bounds tree yet; `prepare` only builds one for meshes that
    // don't already have it, so this is cheap for every mesh already covered by the constructor's
    // initial pass.
    this.picker.prepare(this.root);
    return true;
  }

  /**
   * Applies a whole selection map in `CATEGORY_APPLY_ORDER`.
   *
   * Accumulating categories are reset to "off" across the entire catalog first, so restoring a
   * saved configuration produces the same scene regardless of what was on screen beforehand. That
   * idempotence is what makes a browser refresh reproduce the saved build exactly.
   */
  async applyConfiguration(
    selections: SelectionMap,
    paintStudio?: PaintStudioState,
  ): Promise<{ applied: string[]; failed: string[] }> {
    const applied: string[] = [];
    const failed: string[] = [];

    // Highlight tints are themselves clones sitting in `mesh.material` (`PartHighlighter`, for the
    // same shared-material reason `MaterialWriter` clones on write). `writer.restoreOriginals()`
    // below overwrites `mesh.material` unconditionally, which would leak a live tint clone — so
    // hover/selection is cleared first, restoring each mesh to whatever `mesh.material` was before
    // highlighting touched it, and *then* the writer restores from there.
    this.highlighter.clearAll();
    this.hoveredId = undefined;
    this.selectedId = undefined;

    // Return every written material slot to the material the GLB supplied. Without this, a
    // configuration that selects no paint would leave the previous paint on screen — rolling back
    // to an unpainted build, or restoring one, has to undo writes as well as replay them.
    this.writer.restoreOriginals();

    // The visibility counterpart of `restoreOriginals()`. Replaying a saved build has to start from
    // the vehicle as it loaded, or a package fitted before the restore would leave the factory
    // wheels hidden under a configuration that never asked for that.
    for (const [node, visible] of this.originalVisibility) node.visible = visible;
    this.activeByGroup.clear();

    for (const option of this.catalog.values()) {
      // Mesh replacements, accumulating categories, and eagerly-attached runtime geometry all need
      // an explicit reset before replay. This preserves stock running gear when a replacement is
      // removed and prevents generated single-select parts from surviving a deselection.
      if (
        option.operation === "mesh-replacement" ||
        isMultiSelect(option.category) ||
        option.geometrySource === "procedural-runtime"
      ) {
        await this.removeOption(option);
      }
    }

    for (const category of CATEGORY_APPLY_ORDER) {
      // Catalog order, not the order the ids happen to sit in the saved map. Within one category
      // two selection groups can write the same material slot — a paint colour carries its own
      // metalness and roughness, and a paint finish overwrites exactly those — so replaying a
      // configuration in click order would reproduce whichever the user happened to pick last
      // rather than what the catalog defines. Ordering by the catalog makes restoration
      // deterministic: the same selection set always yields the same scene.
      for (const optionId of this.inCatalogOrder(selections[category] ?? [])) {
        const option = this.catalog.get(optionId);
        if (!option) {
          failed.push(optionId);
          continue;
        }
        const ok = await this.applyOption(option);
        (ok ? applied : failed).push(optionId);
      }
    }

    if (paintStudio?.mode === "custom") {
      this.applyPaintStudio(paintStudio);
    }

    return { applied, failed };
  }

  /** Number of material clones currently held — asserted by the leak test. */
  get clonedMaterialCount(): number {
    return this.writer.clonedSlotCount;
  }

  dispose(): void {
    this.highlighter.clearAll();
    this.hoveredId = undefined;
    this.selectedId = undefined;
    this.picker.dispose();
    for (const option of this.catalog.values()) {
      for (const mount of resolveNodes(this.root, option.mountNodes ?? []).found) {
        detachFromMount(mount);
      }
    }
    this.writer.dispose();
    disposeSubtree(this.root);
    this.registry.clear();
    // Holds `Object3D` keys for the whole loaded scene; clearing it with the rest keeps a disposed
    // controller from pinning the graph it just tore down.
    this.originalVisibility.clear();
    this.activeByGroup.clear();
  }
}
