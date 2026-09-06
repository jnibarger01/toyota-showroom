#!/usr/bin/env node
/**
 * Optimizes every 3D model this app downloads at runtime, in place.
 *
 * Safe to re-run: an already-optimized file is detected and left untouched. That early bail is not
 * a nicety. Draco is lossy, and `io.read` decodes it, so a second pass would requantize geometry
 * that was already quantized — a measured ~0.2% size drift per run and, more importantly,
 * cumulative precision loss on assets nobody would think to re-inspect. The structural passes are
 * genuinely idempotent; the encode is not, so the script refuses to re-encode rather than
 * pretending otherwise. Pass `--force` to override (e.g. after changing encoder settings).
 *
 * Flags: `--report` prints the analysis without writing. `--force` re-encodes regardless.
 *
 * ## What was wrong, and why these passes
 *
 * Every asset here shipped with the same defect, because they came out of the same export
 * pipeline: morph targets that nothing can drive. Draco's glTF extension compresses base
 * attributes and indices only — never morph targets — so those full-precision position/normal
 * deltas survived compression untouched and dominated the download.
 *
 *   4Runner body   28.10 MiB   18.0 MiB of it dead morph targets, 6.5 MiB unreferenced
 *   tire            9.20 MiB   35k triangles carrying 5 morph targets
 *   wheel           1.50 MiB   14k triangles carrying 6 morph targets
 *
 * The tire and wheel compounded it by being `.gltf` with a base64 `data:` buffer, which inflates
 * binary payload by ~33%. They are rewritten as binary `.glb`; `writeTargetFor` encodes that
 * mapping, and `lib/data/vehicles/4runner.ts` points at the new paths.
 *
 * `dropDeadMorphTargets` is the pass that needs justifying, because deleting morph targets is the
 * sort of thing that silently breaks a rig. It re-proves safety on every run rather than trusting
 * a comment: a target is removed only when its mesh weight is zero AND no animation channel drives
 * `weights` on any node using that mesh. A file that later gains a real blend-shape rig keeps it.
 *
 * `dedup` matters more than it looks on the body: the four wheels are byte-identical 35k-triangle
 * meshes that Draco was compressing four separate times.
 *
 * `public/draco/` ships the matching decoder, wired up in `lib/three/assets.ts`.
 */
import { readFileSync, statSync, unlinkSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { dedup, draco, prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const modelPath = (relativePath) => new URL(`../public/models/${relativePath}`, import.meta.url).pathname;

/**
 * Resolves a listed asset to whatever is actually on disk.
 *
 * The tire and wheel are listed by their original `.gltf` names because that is what a fresh
 * export produces and what this script is meant to catch. Once a run has rewritten them to `.glb`
 * the `.gltf` is gone, so resolve forward to the committed binary rather than reporting the asset
 * as missing — otherwise the script silently stops covering the files it already fixed.
 */
const asset = (relativePath) => {
  const source = modelPath(relativePath);
  if (existsSync(source) || !relativePath.endsWith(".gltf")) return source;
  const rewritten = modelPath(relativePath.replace(/\.gltf$/, ".glb"));
  return existsSync(rewritten) ? rewritten : source;
};

/**
 * Every model fetched by the running app, in `lib/data/vehicles/*.ts`'s `threeDConfig`.
 *
 * `public/models/4runner-limited.gltf` is deliberately absent: nothing references it (grep for the
 * filename across `lib/` and `app/` returns nothing), so optimizing it would spend build time on a
 * file no browser requests. It is left for a separate decision about deleting it outright.
 */
const MODELS = [
  { path: asset("modsnation_7416_assets_assembled.glb"), label: "4Runner body" },
  { path: asset("4runner-2024/ModsNation_7416_tire.gltf"), label: "tire" },
  { path: asset("4runner-2024/ModsNation_7416_wheel_a.gltf"), label: "wheel" },
  { path: asset("toyota-ae86-ivofficial.glb"), label: "AE86" },
];

const REPORT_ONLY = process.argv.includes("--report");
const FORCE = process.argv.includes("--force");
const MiB = 1024 * 1024;
const mib = (bytes) => `${(bytes / MiB).toFixed(2)} MiB`;

/**
 * Where an optimized asset should be written.
 *
 * A `.gltf` whose buffer is a base64 `data:` URI is paying a ~33% encoding tax for nothing, so it
 * is rewritten as binary `.glb` at the same basename. A `.gltf` with *external* buffer files is
 * left as `.gltf` — rewriting it would orphan its `.bin` siblings, and the encoding tax it is
 * paying is zero.
 */
function writeTargetFor(filePath) {
  if (!filePath.endsWith(".gltf")) return filePath;
  const gltf = JSON.parse(readFileSync(filePath, "utf8"));
  const embedsBase64 = (gltf.buffers ?? []).some((buffer) => buffer.uri?.startsWith("data:"));
  return embedsBase64 ? filePath.replace(/\.gltf$/, ".glb") : filePath;
}

/**
 * Removes morph targets that nothing can ever drive.
 *
 * glTF morph targets are reachable only two ways: a non-zero static weight on the mesh, or an
 * animation channel with `path: "weights"` pointing at a node that uses the mesh. A target with
 * neither contributes nothing to any frame the renderer will ever produce.
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
    // A weight array shorter than the target list leaves the remainder defaulting to zero, so an
    // index past the end reads as dead rather than as "unknown".
    const isDriven = (index) => (weights[index] ?? 0) !== 0;

    for (const primitive of mesh.listPrimitives()) {
      primitive.listTargets().forEach((target, index) => {
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

/** Counts what a document is carrying, for the before/after report and the no-op check. */
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

/**
 * Whether the file already declares Draco compression, read from the raw JSON before `io.read`
 * transparently decodes it away. This is the "have I already run?" signal.
 */
function isAlreadyDracoEncoded(filePath) {
  const name = KHRDracoMeshCompression.EXTENSION_NAME;
  if (filePath.endsWith(".gltf")) {
    return (JSON.parse(readFileSync(filePath, "utf8")).extensionsUsed ?? []).includes(name);
  }
  const buffer = readFileSync(filePath);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  return (gltf.extensionsUsed ?? []).includes(name);
}

/** Fails loudly on a GLB whose header disagrees with its own length — a browser-side decode error. */
function assertWellFormedGlb(filePath) {
  if (!filePath.endsWith(".glb")) return;
  const written = readFileSync(filePath);
  if (written.readUInt32LE(8) !== written.length) {
    throw new Error(
      `Wrote a malformed GLB: header length ${written.readUInt32LE(8)} != file length ${written.length}`,
    );
  }
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

let totalBefore = 0;
let totalAfter = 0;

for (const { path: sourcePath, label } of MODELS) {
  if (!existsSync(sourcePath)) {
    console.log(`${label}: ${basename(sourcePath)} not found, skipping.`);
    continue;
  }

  const targetPath = writeTargetFor(sourcePath);
  const rewritesContainer = targetPath !== sourcePath;

  // A previous run already rewrote .gltf -> .glb, so the source is a leftover. Nothing to do.
  if (rewritesContainer && existsSync(targetPath) && !FORCE) {
    console.log(`${label}: already rewritten to ${basename(targetPath)}, skipping.`);
    continue;
  }

  const bytesBefore = statSync(sourcePath).size;
  const wasDracoEncoded = isAlreadyDracoEncoded(sourcePath);
  const document = await io.read(sourcePath);
  const before = summarize(document);

  const removedTargets = dropDeadMorphTargets(document);

  await document.transform(
    // Merges byte-identical meshes into shared references so the Draco pass encodes that geometry
    // once. Restricted to accessors and meshes on purpose: an unrestricted `dedup()` also merges
    // materials, and the body GLB carries eleven Blender-style duplicates (`plastik.all.001`..)
    // that differ only by name. Material *names* are a shipped contract —
    // `CustomizationOption.targetMaterials` addresses them directly and
    // `tests/glbContract.test.ts` fails the build when one disappears — so collapsing them breaks
    // real catalog options (`trim-grille-chrome` targets `plastik.all.003`). Materials are a few
    // hundred bytes of JSON; the entire size problem here is geometry.
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
    // Drops what is now unreachable: the orphaned bufferViews the exporter left behind, plus
    // whatever `dropDeadMorphTargets` and `dedup` detached.
    //
    // `keepLeaves: true` is load-bearing, not a default left in place. Node *names* are a runtime
    // contract — `lib/three/nodes.ts` resolves every customization option by name, and
    // `tests/glbContract.test.ts` asserts the whole catalog still resolves. Pruning empty leaf
    // nodes deletes exactly the kind of node that exists to be an option's mount point.
    prune({ keepAttributes: false, keepLeaves: true }),
    // 'edgebreaker' compresses connected meshes (a vehicle body) better than 'sequential'.
    // Quantization defaults (position 14 bits, normal 10, texcoord 12) are gltf-transform's own.
    draco({ method: "edgebreaker" }),
  );

  const after = summarize(document);
  const structurallyUnchanged =
    removedTargets === 0 && JSON.stringify(before) === JSON.stringify(after);

  if (REPORT_ONLY) {
    console.log(`${label}: ${basename(sourcePath)} (${mib(bytesBefore)})`);
    console.log(`  before ${JSON.stringify(before)}`);
    console.log(`  after  ${JSON.stringify(after)}`);
    console.log(`  dead morph targets: ${removedTargets}`);
    totalBefore += bytesBefore;
    continue;
  }

  if (!FORCE && !rewritesContainer && wasDracoEncoded && structurallyUnchanged) {
    console.log(`${label}: already optimized (${mib(bytesBefore)}).`);
    totalBefore += bytesBefore;
    totalAfter += bytesBefore;
    continue;
  }

  await io.write(targetPath, document);
  assertWellFormedGlb(targetPath);

  // Only now that the replacement is written and structurally verified is the original removed.
  if (rewritesContainer) unlinkSync(sourcePath);

  const bytesAfter = statSync(targetPath).size;
  totalBefore += bytesBefore;
  totalAfter += bytesAfter;

  const rename = rewritesContainer ? ` -> ${basename(targetPath)}` : "";
  console.log(
    `${label}: ${basename(sourcePath)}${rename}  ${mib(bytesBefore)} -> ${mib(bytesAfter)} ` +
      `(${(((bytesBefore - bytesAfter) / bytesBefore) * 100).toFixed(1)}% smaller, ` +
      `${removedTargets} dead morph targets)`,
  );
}

if (!REPORT_ONLY && totalBefore > 0) {
  console.log(
    `\nTotal runtime model payload: ${mib(totalBefore)} -> ${mib(totalAfter)} ` +
      `(${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}% smaller)`,
  );
}
