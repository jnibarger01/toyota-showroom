import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { clone as cloneSkinnedScene } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Optional-asset loading and mesh replacement.
 *
 * The base vehicle GLB is ~28 MB (Draco-compressed, docs/INTEGRATION_GUIDE.md §15), so it is
 * loaded exactly once per session and never reloaded for an option change. VehicleCanvas paints a
 * procedural placeholder first (docs/PERF_BUDGETS.md / §18) while this load runs. Replacement parts
 * are fetched on demand, cached by URL, and cloned per mount point, so selecting the same wheel
 * style twice costs no network and no extra GPU upload.
 */

let sharedLoader: GLTFLoader | null = null;
let sharedDraco: DRACOLoader | null = null;

/**
 * Vendored locally at `public/draco/` (draco_decoder.js, draco_decoder.wasm,
 * draco_wasm_wrapper.js — the exact three files `DRACOLoader` fetches), not Google's CDN. Two
 * independent reasons, either one sufficient on its own: this app's CSP (`app/layout.tsx`, §13)
 * intentionally does not allow `connect-src` to reach third-party hosts, so a CDN path would be
 * silently blocked there; and a CDN dependency is one more thing that can be down, rate-limited,
 * or blocked by a restrictive network for a feature (the optional wheel/tyre glTF replacements)
 * that has nothing to do with needing the public internet. `import.meta.env.BASE_URL` matches
 * every other asset URL this app emits (`lib/api/client.ts`'s `withBasePath`) — required once
 * GitHub Pages serves the whole site under `/toyota-showroom/`.
 */
export const DRACO_DECODER_PATH = `${import.meta.env.BASE_URL}draco/`;

export function getGltfLoader(): GLTFLoader {
  if (sharedLoader) return sharedLoader;
  sharedDraco = new DRACOLoader();
  sharedDraco.setDecoderPath(DRACO_DECODER_PATH);
  sharedDraco.setDecoderConfig({ type: "wasm" });
  sharedLoader = new GLTFLoader();
  sharedLoader.setDRACOLoader(sharedDraco);
  return sharedLoader;
}

/**
 * URL-keyed cache of loaded scenes. Stores the promise rather than the result so two concurrent
 * requests for the same asset share one network round trip instead of racing.
 */
const assetCache = new Map<string, Promise<THREE.Group>>();

/**
 * Geometry, materials, and textures owned by cached source scenes.
 *
 * `SkeletonUtils.clone` shares these with every clone it produces, so disposing a detached clone
 * naively would tear down resources the cache — and every future clone — still depends on.
 * `disposeSubtree` consults this set and skips anything in it.
 */
const cacheOwnedResources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();

function registerCacheOwned(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry) cacheOwnedResources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      cacheOwnedResources.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) cacheOwnedResources.add(value);
      }
    }
  });
}

export function loadAsset(url: string): Promise<THREE.Group> {
  const cached = assetCache.get(url);
  if (cached) return cached;

  const pending = getGltfLoader()
    .loadAsync(url)
    .then((gltf) => {
      registerCacheOwned(gltf.scene);
      return gltf.scene;
    });

  // Do not cache failures: a transient network error should not permanently disable the option.
  pending.catch(() => assetCache.delete(url));
  assetCache.set(url, pending);
  return pending;
}

/**
 * Clones a cached scene for attachment. `SkeletonUtils`' clone is used rather than `Object3D.clone`
 * so skinned parts keep working; geometry and materials stay shared with the cached original by
 * design — a per-instance material change goes through `MaterialWriter`, which clones the single
 * slot it writes rather than duplicating the whole asset.
 */
export function instantiateAsset(source: THREE.Group): THREE.Group {
  return cloneSkinnedScene(source) as THREE.Group;
}

/** Drops cached scenes and releases the resources they own. Call on full scene teardown only. */
export function clearAssetCache(): void {
  for (const resource of cacheOwnedResources) resource.dispose();
  cacheOwnedResources.clear();
  assetCache.clear();
}

/** Test hook: whether a resource is protected from `disposeSubtree`. */
export function isCacheOwned(resource: THREE.BufferGeometry | THREE.Material | THREE.Texture): boolean {
  return cacheOwnedResources.has(resource);
}

/** Marks nodes this integration attached, so teardown can tell them from GLB-supplied geometry. */
const ATTACHED_BY_OPTION = "__attachedByOptionId";

export function markAttached(object: THREE.Object3D, optionId: string): void {
  object.userData[ATTACHED_BY_OPTION] = optionId;
}

export function attachedOptionId(object: THREE.Object3D): string | undefined {
  return object.userData[ATTACHED_BY_OPTION] as string | undefined;
}

/**
 * Attaches `asset` under `mount`, replacing anything this integration previously attached there.
 *
 * Placement comes from the mount node's own transform, which is why the option record names a
 * mount rather than carrying coordinates: re-authoring the vehicle in Blender moves the part
 * without a code or data change. Removing the previous attachment before adding the new one is
 * what prevents duplicate meshes accumulating across repeated selections.
 */
export function attachToMount(mount: THREE.Object3D, asset: THREE.Object3D, optionId: string): void {
  detachFromMount(mount);
  markAttached(asset, optionId);
  asset.position.set(0, 0, 0);
  asset.quaternion.identity();
  asset.scale.set(1, 1, 1);
  mount.add(asset);
}

export function detachFromMount(mount: THREE.Object3D): void {
  // Copy first: removing during iteration mutates the array being walked.
  for (const child of [...mount.children]) {
    if (attachedOptionId(child) === undefined) continue;
    mount.remove(child);
    disposeSubtree(child);
  }
}

/**
 * Releases geometry, materials, and textures for a detached subtree.
 *
 * Resources belonging to a cached source scene are skipped: clones share them, so disposing one
 * clone would blank every other instance and every future one. That makes this safe to call on
 * any detached node, whether it was cloned from the cache or built procedurally.
 */
export function disposeSubtree(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry && !cacheOwnedResources.has(object.geometry)) object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material);
    }
  });

  for (const material of materials) {
    if (cacheOwnedResources.has(material)) continue;
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture && !cacheOwnedResources.has(value)) value.dispose();
    }
    material.dispose();
  }
}
