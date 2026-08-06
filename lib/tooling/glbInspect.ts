import { readFileSync } from "node:fs";

/**
 * Minimal, dependency-free GLB structural inspector.
 *
 * Parses only the binary container's JSON chunk — no geometry decode, no Draco, no three.js scene
 * graph — so it runs in plain Node (CI, `vitest`, one-off scripts) without a DOM or WebGL context.
 * This is deliberately narrower than `GLTFLoader`: it answers exactly the question the customization
 * catalog cares about — "does this node name exist, and which material names does it carry" — which
 * is also what `docs/INTEGRATION_GUIDE.md` §3's development dump utility is built on.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"

interface GltfMaterial {
  name?: string;
}

interface GltfMeshPrimitive {
  material?: number;
}

interface GltfMesh {
  name?: string;
  primitives: GltfMeshPrimitive[];
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
}

interface GltfDocument {
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: GltfMaterial[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
}

export interface GlbInspection {
  /** Every named node in the document (mesh-bearing or transform-only). */
  nodeNames: Set<string>;
  /** Node name → the set of material names its mesh (if any) carries across all primitives. */
  materialsByNode: Map<string, Set<string>>;
}

function readGlbJsonChunk(buffer: Buffer): GltfDocument {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error("Not a valid .glb file (bad magic number).");
  }
  let offset = 12; // skip the 12-byte header (magic, version, length)
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    if (chunkType === CHUNK_TYPE_JSON) {
      const jsonBytes = buffer.subarray(offset + 8, offset + 8 + chunkLength);
      return JSON.parse(jsonBytes.toString("utf8")) as GltfDocument;
    }
    // Chunks are 4-byte aligned; advance past this chunk's header + padded body.
    offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  throw new Error("No JSON chunk found in .glb file.");
}

/** Parses a `.glb` file at `filePath` into the node/material name maps the catalog checks against. */
export function inspectGlb(filePath: string): GlbInspection {
  const document = readGlbJsonChunk(readFileSync(filePath));
  const nodeNames = new Set<string>();
  const materialsByNode = new Map<string, Set<string>>();

  for (const node of document.nodes ?? []) {
    if (!node.name) continue;
    nodeNames.add(node.name);

    if (node.mesh === undefined) continue;
    const mesh = document.meshes?.[node.mesh];
    if (!mesh) continue;

    const materialNames = new Set<string>();
    for (const primitive of mesh.primitives) {
      if (primitive.material === undefined) continue;
      const name = document.materials?.[primitive.material]?.name;
      if (name) materialNames.add(name);
    }
    if (materialNames.size > 0) materialsByNode.set(node.name, materialNames);
  }

  return { nodeNames, materialsByNode };
}
