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

  constructor(root: THREE.Object3D, catalog: readonly CustomizationOption[]) {
    this.root = root;
    this.catalog = new Map(catalog.map((option) => [option.id, option]));
  }

  getOption(optionId: string): CustomizationOption | undefined {
    return this.catalog.get(optionId);
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
  async applyConfiguration(selections: SelectionMap): Promise<{ applied: string[]; failed: string[] }> {
    const applied: string[] = [];
    const failed: string[] = [];

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

    return { applied, failed };
  }

  /** Number of material clones currently held — asserted by the leak test. */
  get clonedMaterialCount(): number {
    return this.writer.clonedSlotCount;
  }

  dispose(): void {
    for (const option of this.catalog.values()) {
      for (const mount of resolveNodes(this.root, option.mountNodes ?? []).found) {
        detachFromMount(mount);
      }
    }
    this.writer.dispose();
    disposeSubtree(this.root);
  }
}
