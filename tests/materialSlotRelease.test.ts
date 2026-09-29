import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { MaterialWriter } from "../lib/three/materials";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { verifyNodeContract } from "../lib/three/nodes";
import type { CustomizationOption } from "../lib/types/customization";

/**
 * Coverage for the *swap* path specifically: `VehicleSceneController.applyMeshReplacement`, which
 * attaches over whatever the mount already held. `tests/review-fixes.test.ts` covers the removals
 * (`revertGroupVisibility`, `removeOption`) and the `attachToMount` return contract; this file
 * drives repeated package swaps through the controller so the writer's bookkeeping is pinned
 * against the path a builder session actually takes — pick a wheel package, pick another, another.
 *
 * The asset load is stubbed: a real fetch has no bearing on slot bookkeeping, and the stand-in is
 * cloned per mount by the real `instantiateAsset`, the same way a GLB scene is.
 */
vi.mock("../lib/three/assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/three/assets")>();
  const buildSwapAsset = (): THREE.Group => {
    const asset = new THREE.Group();
    asset.name = "SWAP_ASSET";
    // A tyre mesh carrying the named slot every sidewall finish writes, which is what puts a
    // `MaterialWriter` slot inside the subtree `detachFromMount` later disposes.
    const tire = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      Object.assign(new THREE.MeshStandardMaterial(), { name: "tire.sidewall" }),
    );
    tire.name = "SWAP_TIRE";
    asset.add(tire);
    return asset;
  };
  return { ...actual, loadAsset: async () => buildSwapAsset() };
});

const MOUNT = "MOUNT_WHEEL_FRONT_LEFT";

function packageOption(id: string, assetUrl: string): CustomizationOption {
  return {
    id,
    category: "wheels",
    selectionGroup: "wheels",
    label: id,
    operation: "mesh-replacement",
    assetUrl,
    mountNodes: [MOUNT],
    hidesNodes: [],
    compatibleVehicleIds: ["4runner"],
  };
}

function sidewallOption(): CustomizationOption {
  return {
    id: "tire-sidewall-swap-test",
    category: "wheels",
    selectionGroup: "tire-sidewall",
    label: "Sidewall",
    operation: "material-update",
    targetNodes: ["SWAP_TIRE"],
    targetMaterials: ["tire.sidewall"],
    materialConfig: { color: "#f2f2ee" },
    compatibleVehicleIds: ["4runner"],
  };
}

describe("material slots across repeated wheel-package swaps", () => {
  it("keeps the writer's slot count flat instead of growing with every swap", async () => {
    const fixture = createVehicleFixture();
    const packageA = packageOption("wheels-package-swap-a", "/models/wheels/swap-a.glb");
    const packageB = packageOption("wheels-package-swap-b", "/models/wheels/swap-b.glb");
    const sidewall = sidewallOption();
    const { satisfied } = verifyNodeContract(fixture.root, [...fourRunnerOptions, sidewall]);
    const controller = new VehicleSceneController(fixture.root, [...satisfied, packageA, packageB]);

    // Fit a package, then finish its sidewalls: one write, one cloned slot.
    expect(await controller.applyOption(packageA)).toBe(true);
    await controller.applyOption(sidewall);
    expect(controller.clonedMaterialCount).toBe(1);
    expect(fixture.root.getObjectByName("SWAP_TIRE")).toBeDefined();

    // Swap to the other package. Its own tyre has not been written yet, so the count must fall
    // back to zero rather than hold the slot written on the tyre the swap just detached.
    expect(await controller.applyOption(packageB)).toBe(true);
    expect(controller.clonedMaterialCount).toBe(0);
    expect(mountAssets(fixture.root)).toHaveLength(1);

    // Finish the newly fitted sidewalls, then swap again — the count returns to one, not two.
    await controller.applyOption(sidewall);
    expect(controller.clonedMaterialCount).toBe(1);
    expect(await controller.applyOption(packageA)).toBe(true);
    expect(controller.clonedMaterialCount).toBe(0);
    expect(mountAssets(fixture.root)).toHaveLength(1);
  });
});

describe("MaterialWriter.releaseSubtrees", () => {
  it("drops only the slots written on meshes inside the given roots", () => {
    const writer = new MaterialWriter();
    const kept = tyreMesh("KEPT_TIRE");
    const detachedRoot = new THREE.Group();
    const dropped = tyreMesh("DROPPED_TIRE");
    detachedRoot.add(dropped);

    writer.updateMaterials([kept, dropped], undefined, (material) => {
      (material as THREE.MeshStandardMaterial).color.set("#ffffff");
    });
    expect(writer.clonedSlotCount).toBe(2);

    // The detached mesh's slot goes; the mesh still in the scene keeps its write.
    expect(writer.releaseSubtrees([detachedRoot])).toBe(1);
    expect(writer.clonedSlotCount).toBe(1);
    expect((kept.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("ffffff");

    // Nothing to release is not an error, and reports nothing dropped.
    expect(writer.releaseSubtrees([])).toBe(0);
    expect(writer.releaseSubtrees([new THREE.Group()])).toBe(0);
  });
});

function tyreMesh(name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    Object.assign(new THREE.MeshStandardMaterial(), { name: "tire.sidewall" }),
  );
  mesh.name = name;
  return mesh;
}

function mountAssets(root: THREE.Object3D): THREE.Object3D[] {
  return root.getObjectByName(MOUNT)!.children.filter((child) => child.name === "SWAP_ASSET");
}
