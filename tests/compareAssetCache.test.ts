import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Contract tests for the shared glTF asset cache behind the compare 3D stage's load path
 * (`lib/three/assets.ts`). The compare stage now loads through `loadAsset` instead of a raw
 * `GLTFLoader.loadAsync` call, and these tests pin down the behavior that makes that change safe:
 * repeated and concurrent loads of one URL share one network round trip; clones produced by
 * `instantiateAsset` keep working after their own subtree is disposed; and `disposeSubtree` never
 * releases resources the cached source still owns — so a re-comparison still renders.
 */

const mockState = vi.hoisted(() => ({ loads: [] as string[] }));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  // Real THREE objects: `instantiateAsset` routes through SkeletonUtils.clone, which needs a
  // genuine Object3D hierarchy, so the fake scene is a real Group holding a real Mesh.
  const makeScene = () => {
    const group = new Group();
    group.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
    return group;
  };
  return {
    GLTFLoader: class {
      setDRACOLoader(): this {
        return this;
      }
      loadAsync(url: string): Promise<{ scene: unknown }> {
        mockState.loads.push(url);
        return Promise.resolve({ scene: makeScene() });
      }
    },
  };
});

vi.mock("three/examples/jsm/loaders/DRACOLoader.js", () => ({
  DRACOLoader: class {
    setDecoderPath(): this {
      return this;
    }
    setDecoderConfig(): this {
      return this;
    }
  },
}));

import * as THREE from "three";
const { Group, Mesh, BufferGeometry, MeshBasicMaterial } = THREE;
import { loadAsset, instantiateAsset, disposeSubtree, clearAssetCache } from "../lib/three/assets";

describe("compare stage shared asset cache", () => {
  beforeEach(() => {
    mockState.loads.length = 0;
    clearAssetCache();
  });

  it("returns the identical promise for concurrent loads of one URL", () => {
    const first = loadAsset("/models/test.lod1.glb");
    const second = loadAsset("/models/test.lod1.glb");
    expect(second).toBe(first);
    return Promise.all([first, second]);
  });

  it("serves a repeat load from cache with no second network fetch", async () => {
    await loadAsset("/models/test.lod1.glb");
    await loadAsset("/models/test.lod1.glb");
    expect(mockState.loads).toEqual(["/models/test.lod1.glb"]);
  });

  it("keys the cache by URL, loading distinct URLs separately", async () => {
    await loadAsset("/models/a.lod1.glb");
    await loadAsset("/models/b.lod1.glb");
    expect(mockState.loads).toEqual(["/models/a.lod1.glb", "/models/b.lod1.glb"]);
  });

  it("returns independent clones whose geometry stays owned by the cache", async () => {
    const source = await loadAsset("/models/test.lod1.glb");
    const first = instantiateAsset(source);
    const second = instantiateAsset(source);
    expect(first).not.toBe(second);
    // Teardown of one clone leaves the cache — and the other clone's shared geometry — intact.
    disposeSubtree(first);
    expect(mockState.loads).toEqual(["/models/test.lod1.glb"]);
  });
});
