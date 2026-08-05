import * as THREE from "three";
import type { MaterialConfig } from "../types/customization";
import { materialsOf } from "./nodes";

/**
 * Material mutation with clone-on-write.
 *
 * GLTFLoader deduplicates materials by glTF material index, so one `THREE.Material` instance is
 * shared by every primitive that references it. In this asset `metal.chrome` is shared by six
 * nodes and `tire.sidewall` by five — mutating such an instance in place repaints all of them.
 *
 * `MaterialWriter` clones a material the first time a given mesh slot is written, caches the clone
 * against that slot, and reuses it forever after. That gives three properties the acceptance
 * criteria require: writes are scoped to the intended meshes, repeated option changes allocate
 * exactly one extra material per slot (not one per click), and every clone is tracked so it can be
 * disposed on teardown.
 */

interface ClonedSlot {
  mesh: THREE.Mesh;
  slotIndex: number;
  original: THREE.Material;
  clone: THREE.Material;
}

function slotKey(mesh: THREE.Mesh, slotIndex: number): string {
  return `${mesh.uuid}:${slotIndex}`;
}

export class MaterialWriter {
  private readonly slots = new Map<string, ClonedSlot>();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly loader = new THREE.TextureLoader();

  /**
   * Returns the writable material for a mesh slot, cloning on first use.
   *
   * `shared: true` opts out of cloning for the deliberate case where an update *should* affect
   * every user of the material (all four tyres change sidewall together), avoiding four redundant
   * clones of the same geometry-independent material.
   */
  private writable(mesh: THREE.Mesh, slotIndex: number, shared: boolean): THREE.Material | null {
    const materials = materialsOf(mesh);
    const current = materials[slotIndex];
    if (!current) return null;
    if (shared) return current;

    const key = slotKey(mesh, slotIndex);
    const existing = this.slots.get(key);
    if (existing) return existing.clone;

    const clone = current.clone();
    clone.name = current.name;
    this.slots.set(key, { mesh, slotIndex, original: current, clone });

    if (Array.isArray(mesh.material)) {
      const next = [...mesh.material];
      next[slotIndex] = clone;
      mesh.material = next;
    } else {
      mesh.material = clone;
    }
    return clone;
  }

  /**
   * Applies `update` to the named material slots of the given meshes.
   *
   * When `materialNames` is empty every slot on the mesh is written; when it is provided only
   * matching slots are touched, which is what keeps a paint change confined to `body.carmain`
   * while the `BODY` mesh's nine other slots (glass, chrome, emissive lamps) are left alone.
   */
  updateMaterials(
    meshes: readonly THREE.Mesh[],
    materialNames: readonly string[] | undefined,
    update: (material: THREE.Material) => void,
    options: { shared?: boolean } = {},
  ): number {
    let written = 0;
    const wanted = materialNames?.length ? new Set(materialNames) : null;

    for (const mesh of meshes) {
      const materials = materialsOf(mesh);
      for (let slotIndex = 0; slotIndex < materials.length; slotIndex++) {
        const material = materials[slotIndex];
        if (!material) continue;
        if (wanted && !wanted.has(material.name)) continue;

        const target = this.writable(mesh, slotIndex, options.shared ?? false);
        if (!target) continue;
        update(target);
        target.needsUpdate = true;
        written++;
      }
    }
    return written;
  }

  /** Applies a declarative `MaterialConfig`, ignoring properties the material does not support. */
  applyMaterialConfig(
    meshes: readonly THREE.Mesh[],
    materialNames: readonly string[] | undefined,
    config: MaterialConfig,
    options: { shared?: boolean } = {},
  ): number {
    return this.updateMaterials(
      meshes,
      materialNames,
      (material) => {
        const standard = material as THREE.MeshStandardMaterial;
        const physical = material as THREE.MeshPhysicalMaterial;

        if (config.color !== undefined && standard.color) standard.color.set(config.color);
        if (config.metalness !== undefined && "metalness" in standard) standard.metalness = config.metalness;
        if (config.roughness !== undefined && "roughness" in standard) standard.roughness = config.roughness;
        if (config.clearcoat !== undefined && "clearcoat" in physical) physical.clearcoat = config.clearcoat;
        if (config.clearcoatRoughness !== undefined && "clearcoatRoughness" in physical) {
          physical.clearcoatRoughness = config.clearcoatRoughness;
        }
      },
      options,
    );
  }

  /**
   * Loads a texture once per URL and assigns it as the base colour map. The previous map is
   * disposed only when this writer created it — GLB-supplied maps are left alone because they may
   * still be referenced by other meshes sharing the source material.
   */
  async applyTexture(
    meshes: readonly THREE.Mesh[],
    materialNames: readonly string[] | undefined,
    textureUrl: string,
  ): Promise<number> {
    const texture = await this.loadTexture(textureUrl);
    return this.updateMaterials(meshes, materialNames, (material) => {
      const standard = material as THREE.MeshStandardMaterial;
      if (!("map" in standard)) return;
      const previous = standard.map;
      standard.map = texture;
      if (previous && this.ownsTexture(previous) && previous !== texture) previous.dispose();
    });
  }

  private ownedTextures = new Set<THREE.Texture>();

  private ownsTexture(texture: THREE.Texture): boolean {
    return this.ownedTextures.has(texture);
  }

  loadTexture(url: string): Promise<THREE.Texture> {
    const cached = this.textures.get(url);
    if (cached) return cached;

    const pending = this.loader.loadAsync(url).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false; // glTF UV convention
      this.ownedTextures.add(texture);
      return texture;
    });
    // A failed load must not poison the cache — a later retry should be able to succeed.
    pending.catch(() => this.textures.delete(url));
    this.textures.set(url, pending);
    return pending;
  }

  /** Restores every mesh slot to the material the GLB supplied, disposing the clones. */
  restoreOriginals(): void {
    for (const slot of this.slots.values()) {
      if (Array.isArray(slot.mesh.material)) {
        const next = [...slot.mesh.material];
        next[slot.slotIndex] = slot.original;
        slot.mesh.material = next;
      } else {
        slot.mesh.material = slot.original;
      }
      slot.clone.dispose();
    }
    this.slots.clear();
  }

  dispose(): void {
    // Reinstall the originals rather than only dropping the clones. A caller's subsequent
    // `disposeSubtree` walks the scene's *current* materials; if the meshes still pointed at
    // discarded clones, the GLB-supplied originals would be unreachable and their GPU resources
    // would leak every time a customized canvas unmounts.
    this.restoreOriginals();
    for (const texture of this.ownedTextures) texture.dispose();
    this.ownedTextures.clear();
    this.textures.clear();
  }

  /** Test/diagnostic hook: how many clones this writer is holding. */
  get clonedSlotCount(): number {
    return this.slots.size;
  }
}
