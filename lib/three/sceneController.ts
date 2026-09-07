import * as THREE from "three";
import {
  CATEGORY_APPLY_ORDER,
  isMultiSelect,
  type CustomizationOption,
  type SelectionMap,
} from "../types/customization";
import { MaterialWriter } from "./materials";
import { resolveMeshes, resolveNodes } from "./nodes";
import { attachToMount, detachFromMount, disposeSubtree, instantiateAsset, loadAsset } from "./assets";
import type { PaintStudioState } from "../types/paintStudio";
import {
  materialConfigFromPaintStudio,
  PAINT_STUDIO_TARGET_MATERIALS,
  PAINT_STUDIO_TARGET_NODES,
} from "../data/paintStudio";
import { buildSceneRegistry, SceneRegistry, type SceneMapReport } from "./sceneRegistry";
import { PartHighlighter, type HighlightState } from "./highlight";
import type { SceneMapEntry } from "../types/sceneMap";

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
  readonly sceneMapReport: SceneMapReport;
  private hoveredId: string | undefined;
  private selectedId: string | undefined;

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

  /**
   * Applies a single option. Returns `false` when the option's nodes are not present, which the
   * caller surfaces as an error rather than treating as success — a silent no-op here is exactly
   * the failure mode this integration exists to remove.
   */
  async applyOption(option: CustomizationOption): Promise<boolean> {
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
    const meshes = resolveMeshes(this.root, [...PAINT_STUDIO_TARGET_NODES]);
    if (meshes.length === 0) return false;
    const config = materialConfigFromPaintStudio(paintStudio.material);
    return this.writer.applyMaterialConfig(meshes, [...PAINT_STUDIO_TARGET_MATERIALS], config) > 0;
  }

  private applyMaterialUpdate(option: CustomizationOption): boolean {
    if (!option.materialConfig) return false;
    const meshes = resolveMeshes(this.root, option.targetNodes ?? []);
    if (meshes.length === 0) return false;
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

    for (const option of this.catalog.values()) {
      if (isMultiSelect(option.category)) await this.removeOption(option);
    }

    for (const category of CATEGORY_APPLY_ORDER) {
      for (const optionId of selections[category] ?? []) {
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
    for (const option of this.catalog.values()) {
      for (const mount of resolveNodes(this.root, option.mountNodes ?? []).found) {
        detachFromMount(mount);
      }
    }
    this.writer.dispose();
    disposeSubtree(this.root);
    this.registry.clear();
  }
}
