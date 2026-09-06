#!/usr/bin/env node
/**
 * Optimizes the shipped 4Runner GLB in place. Safe to re-run: an already-optimized file is
 * detected and left untouched, and CI's size budget in `tests/glbContract.test.ts` asserts the
 * committed asset is in its optimized state.
 *
 * That early bail is not a nicety. Draco is lossy, and `io.read` decodes it, so a second pass
 * would requantize geometry that was already quantized — a measured ~0.2% size drift per run and,
 * more importantly, cumulative precision loss on an asset nobody would think to re-inspect. The
 * structural passes below genuinely are idempotent; the encode is not, so the script refuses to
 * re-encode rather than pretending otherwise. Pass `--force` to override (e.g. after changing the
 * encoder settings, where a re-encode is the point).
 *
 * Run with `--report` to print the analysis without writing anything.
 *
 * ## Why these passes, in this order
 *
 * Measured against the asset as first exported (28.0 MiB on disk):
 *
 *   3.33 MiB  Draco-compressed geometry — all 55 primitives, already correct
 *  18.00 MiB  morph targets on the four wheel meshes
 *   6.55 MiB  bufferViews referenced by nothing at all
 *   0.16 MiB  embedded textures
 *
 * The headline is that ~24.5 MiB of a 28 MiB download was data the runtime provably never reads.
 * Textures are a rounding error here, which is why there is no `textureCompress` pass — this file
 * is geometry, and dead geometry at that.
 *
 * `dropDeadMorphTargets` is the big one and the only pass that needs justifying, because deleting
 * morph targets is the sort of thing that silently breaks a rig. It is safe *for this document*
 * and it re-proves that on every run rather than trusting a comment: a target is only removed when
 * its mesh weight is zero AND no animation channel drives `weights` on any node using that mesh.
 * A file that later gains a real blend-shape rig keeps it — the pass just stops finding anything.
 *
 * `dedup` matters more than it looks: the four wheels are byte-identical 35k-triangle meshes that
 * Draco was compressing four separate times. Deduplicating before encoding means one encode, four
 * references.
 *
 * `public/draco/` ships the matching decoder, wired up in `lib/three/assets.ts`.
 */
import { readFileSync, statSync } from "node:fs";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { dedup, draco, prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const GLB_PATH = new URL("../public/models/modsnation_7416_assets_assembled.glb", import.meta.url)
  .pathname;

const REPORT_ONLY = process.argv.includes("--report");
const FORCE = process.argv.includes("--force");
const MiB = 1024 * 1024;
const mib = (bytes) => `${(bytes / MiB).toFixed(2)} MiB`;

/**
 * Removes morph targets that nothing can ever drive.
 *
 * glTF morph targets are only reachable two ways: a non-zero static weight on the mesh, or an
 * animation channel with `path: "weights"` pointing at a node that uses the mesh. A target that
 * has neither contributes nothing to any frame the renderer will ever produce, but its
 * POSITION/NORMAL deltas are full-precision uncompressed buffers — Draco's glTF extension covers
 * base attributes and indices only, never targets, so they survive compression at full size.
 *
 * Returns the number of targets removed so the caller can report it.
 */
function dropDeadMorphTargets(document) {
  const root = document.getRoot();

  // Meshes reachable from an animation channel that drives morph weights. Collected across the
  // whole document first: one animated node is enough to protect its mesh everywhere it is used.
  const animatedMeshes = new Set();
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      if (channel.getTargetPath() !== "weights") continue;
      const mesh = channel.getTargetNode()?.getMesh();
      if (mesh) animatedMeshes.add(mesh);
    }
  }

  let removed = 0;
  for (const mesh of root.listMeshes()) {
    if (animatedMeshes.has(mesh)) continue;

    const weights = mesh.getWeights();
    // A weight array shorter than the target list leaves the remainder defaulting to zero, so
    // index past the end reads as dead rather than as "unknown".
    const isDriven = (index) => (weights[index] ?? 0) !== 0;

    for (const primitive of mesh.listPrimitives()) {
      const targets = primitive.listTargets();
      targets.forEach((target, index) => {
        if (isDriven(index)) return;
        primitive.removeTarget(target);
        target.dispose();
        removed += 1;
      });
    }

    // Once every target is gone the weight array is meaningless; leaving a stale one behind makes
    // the mesh look like it still has blend shapes to any downstream tool that reads it.
    if (mesh.listPrimitives().every((primitive) => primitive.listTargets().length === 0)) {
      mesh.setWeights([]);
    }
  }
  return removed;
}

/** Counts what a document is carrying, for the before/after report. */
function summarize(document) {
  const root = document.getRoot();
  let targets = 0;
  let primitives = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitives += 1;
      targets += primitive.listTargets().length;
    }
  }
  return {
    meshes: root.listMeshes().length,
    primitives,
    targets,
    accessors: root.listAccessors().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
  };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

/**
 * Whether the file on disk already declares Draco compression, read from the raw JSON chunk before
 * `io.read` transparently decodes it away. This is the "have I already run?" signal.
 */
function isAlreadyDracoEncoded(filePath) {
  const buffer = readFileSync(filePath);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  return (gltf.extensionsUsed ?? []).includes(KHRDracoMeshCompression.EXTENSION_NAME);
}

const bytesBefore = statSync(GLB_PATH).size;
const wasDracoEncoded = isAlreadyDracoEncoded(GLB_PATH);
const document = await io.read(GLB_PATH);
const before = summarize(document);

const removedTargets = dropDeadMorphTargets(document);

await document.transform(
  // Merges the four byte-identical wheel meshes into shared references, so the Draco pass below
  // encodes that geometry once instead of four times.
  //
  // Restricted to accessors and meshes on purpose. An unrestricted `dedup()` also merges
  // materials, and this GLB carries eleven Blender-style duplicates (`plastik.all.001`..`.004`,
  // `metal.chrome.002`..`.004`, and so on) that differ only by name. Material *names* are a
  // shipped contract — `CustomizationOption.targetMaterials` addresses them directly and
  // `tests/glbContract.test.ts` fails the build when one disappears — so collapsing them breaks
  // real catalog options (`trim-grille-chrome` targets `plastik.all.003`). The trade is trivially
  // worth it: materials are a few hundred bytes of JSON, while the entire size problem here is
  // geometry.
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
  // Drops everything now unreachable: the orphaned bufferViews the exporter left behind, plus
  // whatever `dropDeadMorphTargets` and `dedup` just detached.
  //
  // `keepLeaves: true` is load-bearing, not a default left in place. Node *names* in this GLB are
  // a runtime contract — `lib/three/nodes.ts` resolves every customization option by name, and
  // `tests/glbContract.test.ts` asserts the whole catalog still resolves against the checked-in
  // file. Pruning empty leaf nodes deletes exactly the kind of node that exists to be a mount
  // point for an option, so the size win there is not worth a silently broken catalog.
  prune({ keepAttributes: false, keepLeaves: true }),
  // method: 'edgebreaker' — better compression than 'sequential' for connected meshes, which is
  // what a vehicle body is; quantization defaults (position 14 bits, normal 10, texcoord 12) are
  // gltf-transform's own, chosen for a good size/quality balance rather than overridden blind.
  draco({ method: "edgebreaker" }),
);

const after = summarize(document);

/**
 * Nothing structural changed and the file was already Draco-encoded, so the only thing writing
 * would accomplish is a lossy re-encode of already-compressed geometry. Bail before `io.write`.
 */
const structurallyUnchanged =
  removedTargets === 0 && JSON.stringify(before) === JSON.stringify(after);

if (!REPORT_ONLY && !FORCE && wasDracoEncoded && structurallyUnchanged) {
  console.log(`Already optimized (${mib(bytesBefore)}); nothing to do. Pass --force to re-encode.`);
  process.exit(0);
}

if (REPORT_ONLY) {
  console.log(`${GLB_PATH}\n  on disk: ${mib(bytesBefore)}`);
  console.log(`  before: ${JSON.stringify(before)}`);
  console.log(`  after:  ${JSON.stringify(after)}`);
  console.log(`  dead morph targets found: ${removedTargets}`);
  process.exit(0);
}

await io.write(GLB_PATH, document);
const bytesAfter = statSync(GLB_PATH).size;

console.log(`Optimized with ${KHRDracoMeshCompression.EXTENSION_NAME}.`);
console.log(`  dead morph targets removed: ${removedTargets}`);
console.log(`  primitives ${before.primitives} -> ${after.primitives}, accessors ${before.accessors} -> ${after.accessors}`);
console.log(
  `  ${mib(bytesBefore)} -> ${mib(bytesAfter)} ` +
    `(${(((bytesBefore - bytesAfter) / bytesBefore) * 100).toFixed(1)}% smaller)`,
);

// A GLB whose header disagrees with its own length is the failure mode that turns a successful
// build into a runtime decode error in the browser, so verify it here rather than in review.
const written = readFileSync(GLB_PATH);
if (written.readUInt32LE(8) !== written.length) {
  throw new Error(`Wrote a malformed GLB: header length ${written.readUInt32LE(8)} != file length ${written.length}`);
}
