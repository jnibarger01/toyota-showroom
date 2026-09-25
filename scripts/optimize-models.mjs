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
import { dedup, draco, prune, simplifyPrimitive, textureCompress, weldPrimitive } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

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
 * The supplied `4runner-limited.gltf` Blender export is deliberately absent: nothing references it,
 * and it now lives under `assets/provenance/4runner/`, outside the deployed `public/` tree.
 */
const MODELS = [
  { path: asset("modsnation_7416_assets_assembled.glb"), label: "4Runner body", lod: true },
  { path: asset("4runner-2024/ModsNation_7416_tire.gltf"), label: "tire" },
  { path: asset("4runner-2024/ModsNation_7416_wheel_a.gltf"), label: "wheel" },
  { path: asset("toyota-ae86-ivofficial.glb"), label: "AE86" },
  { path: asset("4runner-2024/wheel_trd_pro.glb"), label: "4Runner TRD Pro wheel" },
  { path: asset("gr-supra-2024/toyota_gr_supra.glb"), label: "GR Supra", stripTextures: true },
  { path: asset("camry/camry.glb"), label: "Camry", stripTextures: true, simplify: true, lod: true },
  // External-buffer .gltf (docs/RAV4_PROVENANCE.md §3) — writeTargetFor rewrites it to .glb,
  // repackaging the container only; the primitives are already Draco-compressed on read, and the
  // draco() transform below re-applies the same codec on write, not a different one.
  { path: asset("rav4-2024/rav4_2024_limited_decoded.gltf"), label: "RAV4 body" },
  { path: asset("rav4-hybrid-2023/rav4-hybrid.glb"), label: "2023 RAV4 Hybrid", simplify: true, webp: true, lod: true },
  { path: asset("land-cruiser-250-2025/land-cruiser-250.glb"), label: "2025 Land Cruiser 250", simplify: true, webp: true, lod: true },
];

/**
 * ## Detail-preserving simplification (`simplify: true`)
 *
 * Draco only changes how geometry is *encoded*. The three heaviest bodies were heavy because they
 * carry a lot of it — the Land Cruiser 1.56M triangles, the Camry 1.23M — which costs download,
 * decode, and GPU time on every frame. meshoptimizer's simplifier removes triangles under a bounded
 * geometric error, but where it is allowed to matters more than how hard it runs:
 *
 * - **Paint primitives are never simplified.** Large smooth panels are exactly where fewer triangles
 *   change interpolated normals, and so the shape of the clearcoat highlight — the most visible
 *   shading cue on a car. A pass over everything at the same error bound visibly moved the hood and
 *   rear-quarter highlights in side-by-side renders; excluding paint made them identical.
 * - **Small primitives are never simplified** (`SIMPLIFY_MIN_TRIANGLES`). Badges, lettering and grille
 *   inserts are tiny in bytes and are where a bounded-error pass eats legible detail first.
 * - `SIMPLIFY_ERROR` is a fraction of each primitive's own radius, so a seat and a wheel are held to
 *   the same relative tolerance.
 *
 * Everything else (interior, running gear, trim, underbody) is where the triangle budget actually
 * went, and none of it changes node or material names — the catalog contract is untouched, which
 * `tests/glbContract.test.ts` re-verifies against the written binaries.
 *
 * ## WebP textures (`webp: true`)
 *
 * PNG colour/ORM textures are re-encoded as WebP (`EXT_texture_webp`, which `GLTFLoader` decodes
 * natively) and capped at 2048px. Normal maps keep their original lossless format and are only
 * resized: lossy compression on a normal map shows up as faceting in reflections.
 *
 * ## LOD (`lod: true`)
 *
 * Writes a `<name>.lod1.glb` sibling: non-paint primitives simplified hard, paint held to a tight
 * error bound, textures capped at 256px.
 * The `low` quality tier loads it instead of the full asset (`QualitySettings.modelDetail`,
 * `lib/three/quality.ts`). Same node and material names by construction, so every catalog option
 * resolves against either file.
 */
const SIMPLIFY_RATIO = 0.25;
const SIMPLIFY_ERROR = 0.0005;
const SIMPLIFY_MIN_TRIANGLES = 4000;
/** Per-model paint material names — see `scripts/model-pipeline-config.json` for why they are explicit. */
const PIPELINE_CONFIG = JSON.parse(readFileSync(new URL("./model-pipeline-config.json", import.meta.url), "utf8"));

/**
 * Exact paint material names for a model, as a matcher. Names, not a pattern: exporters call paint
 * anything (`CarPaint`, `body.carmain`, `Tdummy_material_0_085`), and a heuristic that misses one
 * silently simplifies the panels this whole exclusion exists to protect.
 */
function paintMatcherFor(filePath) {
  const key = Object.keys(PIPELINE_CONFIG.paintMaterials).find((relative) => filePath.endsWith(relative));
  if (!key) throw new Error(`No paintMaterials entry in model-pipeline-config.json for ${basename(filePath)}`);
  const names = new Set(PIPELINE_CONFIG.paintMaterials[key]);
  return { test: (name) => names.has(name) };
}
const LOD_RATIO = 0.15;
const LOD_ERROR = 0.02;
/** Paint gets a far tighter bound even in the LOD: faceted panels read as damage, not as low detail. */
const LOD_PAINT_ERROR = 0.002;

/**
 * Pipeline revision recorded in the asset's `extras`. Draco decode + re-encode is lossy, so "already
 * optimized" has to be an explicit marker rather than inferred from structure — simplification and
 * texture re-encoding do not change any count `summarize` reports.
 */
const PIPELINE_MARKER = "showroomPipeline";

function triangleCount(primitive) {
  const indices = primitive.getIndices();
  return (indices ? indices.getCount() : primitive.getAttribute("POSITION").getCount()) / 3;
}

function simplifyDocument(document, { ratio, error, minTriangles, skipMaterial = null, onlyMaterial = null }) {
  const seen = new Set();
  let before = 0;
  let after = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (seen.has(primitive)) continue;
      seen.add(primitive);
      const count = triangleCount(primitive);
      before += count;
      const materialName = primitive.getMaterial()?.getName() ?? "";
      const excluded = (skipMaterial && skipMaterial.test(materialName)) || (onlyMaterial && !onlyMaterial.test(materialName));
      if (count < minTriangles || excluded) {
        after += count;
        continue;
      }
      // Welding first is what lets the simplifier collapse edges at all: exporters duplicate
      // vertices per face, which reads as a mesh made entirely of borders.
      weldPrimitive(primitive);
      simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
      after += triangleCount(primitive);
    }
  }
  return { before, after };
}

function textureTransforms({ maxSize, normalMaxSize }) {
  return [
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [maxSize, maxSize],
      quality: 88,
      slots: /^(?!normalTexture).*$/,
    }),
    textureCompress({ encoder: sharp, resize: [normalMaxSize, normalMaxSize], slots: /^normalTexture$/ }),
  ];
}

function readPipelineMarker(filePath) {
  if (!filePath.endsWith(".glb")) return null;
  const buffer = readFileSync(filePath);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  return gltf.extras?.[PIPELINE_MARKER] ?? null;
}

function lodPathFor(filePath) {
  return filePath.replace(/\.glb$/, ".lod1.glb");
}

const REPORT_ONLY = process.argv.includes("--report");
const FORCE = process.argv.includes("--force");
const MiB = 1024 * 1024;
const mib = (bytes) => `${(bytes / MiB).toFixed(2)} MiB`;

/**
 * Where an optimized asset should be written.
 *
 * Every `.gltf` is rewritten to binary `.glb` at the same basename, regardless of buffer style: a
 * base64 `data:` buffer pays a ~33% encoding tax for nothing, and an external `.bin` sibling costs
 * a second network round trip before the renderer can start decoding geometry — `tests/
 * canvasOrdering.test.ts`'s "ships every runtime model as .glb" enforces that neither shape reaches
 * a `threeDConfig.modelUrl`. The external-buffer sibling of a rewritten asset becomes orphaned by
 * this rewrite; the caller is responsible for removing it once the new `.glb` is verified.
 */
function writeTargetFor(filePath) {
  if (!filePath.endsWith(".gltf")) return filePath;
  return filePath.replace(/\.gltf$/, ".glb");
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
function stripMaterialTextures(document) {
  for (const material of document.getRoot().listMaterials()) {
    material
      .setBaseColorTexture(null)
      .setEmissiveTexture(null)
      .setNormalTexture(null)
      .setOcclusionTexture(null)
      .setMetallicRoughnessTexture(null);

    const clearcoat = material.getExtension("KHR_materials_clearcoat");
    if (clearcoat) {
      clearcoat
        .setClearcoatTexture(null)
        .setClearcoatRoughnessTexture(null)
        .setClearcoatNormalTexture(null);
    }
  }
}

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

await MeshoptSimplifier.ready;

let totalBefore = 0;
let totalAfter = 0;

const lodJobs = [];

for (const { path: sourcePath, label, stripTextures = false, simplify = false, webp = false, lod = false } of MODELS) {
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

  if (lod) lodJobs.push({ path: targetPath, label });

  const wantedMarker = { revision: 2, simplify, webp };
  const marker = readPipelineMarker(sourcePath);
  const markerCurrent = JSON.stringify(marker) === JSON.stringify(wantedMarker);

  const bytesBefore = statSync(sourcePath).size;
  const wasDracoEncoded = isAlreadyDracoEncoded(sourcePath);
  const document = await io.read(sourcePath);
  const before = summarize(document);

  const removedTargets = dropDeadMorphTargets(document);
  if (stripTextures) stripMaterialTextures(document);
  // Only on a file that has not already been through this revision: a second simplify pass would
  // compound error, the same reason the Draco re-encode refuses to run twice.
  const simplified = simplify && !markerCurrent
    ? simplifyDocument(document, { ratio: SIMPLIFY_RATIO, error: SIMPLIFY_ERROR, minTriangles: SIMPLIFY_MIN_TRIANGLES, skipMaterial: paintMatcherFor(sourcePath) })
    : null;
  if (webp && !markerCurrent) await document.transform(...textureTransforms({ maxSize: 2048, normalMaxSize: 1024 }));

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
    if (simplified) console.log(`  triangles: ${simplified.before} -> ${simplified.after}`);
    totalBefore += bytesBefore;
    continue;
  }

  if (!FORCE && !rewritesContainer && wasDracoEncoded && structurallyUnchanged && (markerCurrent || (!simplify && !webp))) {
    console.log(`${label}: already optimized (${mib(bytesBefore)}).`);
    totalBefore += bytesBefore;
    totalAfter += bytesBefore;
    continue;
  }

  if (simplify || webp) {
    const root = document.getRoot();
    root.setExtras({ ...root.getExtras(), [PIPELINE_MARKER]: wantedMarker });
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
      `${removedTargets} dead morph targets` +
      (simplified ? `, ${simplified.before} -> ${simplified.after} triangles` : "") +
      ")",
  );
}

// LODs are derived from the *written* full asset, so they always follow the latest optimized
// geometry and never compound a lossy pass onto a stale source.
if (!REPORT_ONLY) {
  for (const { path: fullPath, label } of lodJobs) {
    const lodPath = lodPathFor(fullPath);
    if (existsSync(lodPath) && !FORCE && statSync(lodPath).mtimeMs >= statSync(fullPath).mtimeMs) {
      console.log(`${label} LOD1: up to date (${mib(statSync(lodPath).size)}).`);
      continue;
    }
    const document = await io.read(fullPath);
    const paintMatcher = paintMatcherFor(fullPath);
    const rest = simplifyDocument(document, { ratio: LOD_RATIO, error: LOD_ERROR, minTriangles: 0, skipMaterial: paintMatcher });
    const paint = simplifyDocument(document, { ratio: 0.5, error: LOD_PAINT_ERROR, minTriangles: 0, onlyMaterial: paintMatcher });
    const before = rest.before;
    const after = rest.after - (paint.before - paint.after);
    await document.transform(
      ...textureTransforms({ maxSize: 256, normalMaxSize: 256 }),
      prune({ keepAttributes: false, keepLeaves: true }),
      draco({ method: "edgebreaker" }),
    );
    await io.write(lodPath, document);
    assertWellFormedGlb(lodPath);
    console.log(`${label} LOD1: ${basename(lodPath)} ${mib(statSync(lodPath).size)}, ${before} -> ${after} triangles`);
  }
}

if (!REPORT_ONLY && totalBefore > 0) {
  console.log(
    `\nTotal runtime model payload: ${mib(totalBefore)} -> ${mib(totalAfter)} ` +
      `(${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}% smaller)`,
  );
}
