import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { findNodeByName, resolveMeshes, resolveNodes } from "../lib/three/nodes";

/**
 * GLTFLoader renames `shell.001_CarPaint_0` to `shell001_CarPaint_0` on load (it runs every node
 * name through `PropertyBinding.sanitizeNodeName`). The catalog is authored — and contract-tested —
 * against the raw file names, so resolution has to accept the dotted form against a sanitized scene.
 */
function loadedLikeGltfLoader(rawName: string): { root: THREE.Group; mesh: THREE.Mesh } {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.name = THREE.PropertyBinding.sanitizeNodeName(rawName);
  root.add(mesh);
  return { root, mesh };
}

describe("findNodeByName", () => {
  it("resolves a raw dotted glTF name against the loader-sanitized node", () => {
    const { root, mesh } = loadedLikeGltfLoader("67663_60030_01_shell.001_CarPaint_0");
    expect(mesh.name).toBe("67663_60030_01_shell001_CarPaint_0");
    expect(findNodeByName(root, "67663_60030_01_shell.001_CarPaint_0")).toBe(mesh);
    expect(resolveNodes(root, ["67663_60030_01_shell.001_CarPaint_0"]).missing).toEqual([]);
    expect(resolveMeshes(root, ["67663_60030_01_shell.001_CarPaint_0"])).toEqual([mesh]);
  });

  it("prefers an exact match and still reports genuinely absent names as missing", () => {
    const { root, mesh } = loadedLikeGltfLoader("BODY");
    expect(findNodeByName(root, "BODY")).toBe(mesh);
    expect(findNodeByName(root, "NOT_THERE.001")).toBeUndefined();
    expect(resolveNodes(root, ["NOT_THERE.001"]).missing).toEqual(["NOT_THERE.001"]);
  });
});
