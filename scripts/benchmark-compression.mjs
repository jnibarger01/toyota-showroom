#!/usr/bin/env node
/**
 * Benchmarks Meshopt (`EXT_meshopt_compression`) against this repo's current Draco pipeline
 * (`scripts/optimize-models.mjs`), on the real committed assets — not synthetic geometry.
 *
 * Never writes to `public/models/`. Every variant is built in memory (or under `--out`, if given)
 * so this script is safe to run repeatedly without touching what's actually shipped; adopting
 * Meshopt is a separate, deliberate step once the evidence here justifies it (mission Priority 3:
 * "Adopt Meshopt only if the evidence justifies it").
 *
 * Method: read the on-disk (currently Draco-compressed) GLB — decoding it fully back to plain
 * float geometry — then re-encode that *same decoded geometry* two ways: back through this repo's
 * current Draco settings (`draco({ method: "edgebreaker" })`, matching optimize-models.mjs
 * exactly), and through `meshopt()` at both its "medium" and "high" levels. Comparing freshly
 * re-encoded Draco against Meshopt, both from the same decoded source, isolates the codec choice
 * from any incidental difference between the on-disk file and a fresh re-encode.
 *
 * What this script measures directly: encoded byte size, and Node-side decode wall-clock time
 * (`io.read` on each variant). What it does NOT measure, and the resulting doc says so plainly:
 * real browser main-thread decode cost, GPU memory, frame time, or visual equivalence — those need
 * a browser and are out of reach of a benchmarking script (see docs/COMPRESSION_BENCHMARK.md's
 * "What this does not measure" section for how the existing `model_loaded` telemetry
 * (`lib/observability/clientMetrics.ts`) covers the browser-realistic version of the decode number).
 *
 * Usage: node scripts/benchmark-compression.mjs [--json]
 */
import { readFileSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync, constants as zlibConstants } from "node:zlib";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { cloneDocument, dedup, draco, meshopt, prune, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const modelPath = (relativePath) => new URL(`../public/models/${relativePath}`, import.meta.url).pathname;

const MODELS = [
  { path: modelPath("modsnation_7416_assets_assembled.glb"), label: "4Runner body (BODY + wheels + tyres)" },
  { path: modelPath("toyota-ae86-ivofficial.glb"), label: "AE86 (Car + 4 wheels)" },
  { path: modelPath("4runner-2024/ModsNation_7416_tire.glb"), label: "4Runner tire (authored running gear)" },
  { path: modelPath("4runner-2024/ModsNation_7416_wheel_a.glb"), label: "4Runner wheel (authored running gear)" },
];

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
  // Read-back after writing a Meshopt-compressed variant (`timedDecodeMs`) needs a decoder too —
  // MeshoptDecoder is the read-side counterpart `EXTMeshoptCompression` looks for.
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

const KiB = 1024;
const kib = (bytes) => `${(bytes / KiB).toFixed(1)} KiB`;
const pct = (before, after) => `${(((before - after) / before) * 100).toFixed(1)}%`;

/**
 * Round-trips a document through `io.writeBinary` + `io.readBinary`, timing the read half — the
 * fairest same-process proxy available for "decode cost" without a browser — and measures the
 * gzipped size alongside the raw one.
 *
 * The gzip number is not incidental: Draco's arithmetic coding already leaves its buffers close to
 * their entropy limit, so a further gzip pass barely shrinks them, while Meshopt's filters (delta +
 * byte-oriented encoding) are deliberately designed to compress *well* under a generic byte-level
 * compressor — its real-world size advantage, where it has one, shows up post-gzip, not in the raw
 * file. This is not a hypothetical for this app: `lib/three/assets.ts` already documents that a
 * Draco GLB here is "often served with `Content-Encoding: gzip`", so the transfer size that
 * matters is the compressed one.
 */
async function timedDecodeMs(document) {
  const bytes = await io.writeBinary(document);
  const start = performance.now();
  await io.readBinary(bytes);
  const decodeMs = performance.now() - start;
  const gzipBytes = gzipSync(bytes, { level: zlibConstants.Z_BEST_COMPRESSION }).byteLength;
  return { ms: decodeMs, bytes: bytes.byteLength, gzipBytes };
}

async function reencodeDraco(source) {
  const document = cloneDocument(source);
  await document.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
    prune({ keepAttributes: false, keepLeaves: true }),
    draco({ method: "edgebreaker" }),
  );
  return document;
}

async function reencodeMeshopt(source, level) {
  const document = cloneDocument(source);
  await document.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
    prune({ keepAttributes: false, keepLeaves: true }),
    // Meshopt compression benefits from a welded, well-ordered mesh in a way Draco's edgebreaker
    // encoder does not depend on to the same degree — `weld()` merges duplicate vertices within
    // tolerance before quantizing, which is standard practice for this codec (gltf-transform's own
    // meshopt() docs recommend it) and is not applied to the Draco leg, matching what
    // optimize-models.mjs actually ships today.
    weld({ tolerance: 0.0001 }),
    meshopt({ encoder: MeshoptEncoder, level }),
  );
  return document;
}

const results = [];

for (const { path: sourcePath, label } of MODELS) {
  let sourceBytes;
  try {
    sourceBytes = statSync(sourcePath).size;
  } catch {
    console.log(`${label}: not found, skipping.`);
    continue;
  }

  const sourceFileBytes = readFileSync(sourcePath);
  const currentIsDraco = sourceFileBytes.includes(Buffer.from("KHR_draco_mesh_compression"));
  const onDiskGzipBytes = gzipSync(sourceFileBytes, { level: zlibConstants.Z_BEST_COMPRESSION }).byteLength;

  const source = await io.read(sourcePath);
  const dracoDoc = await reencodeDraco(source);
  const dracoDecode = await timedDecodeMs(dracoDoc);

  const meshoptMediumDoc = await reencodeMeshopt(source, "medium");
  const meshoptMediumDecode = await timedDecodeMs(meshoptMediumDoc);

  const meshoptHighDoc = await reencodeMeshopt(source, "high");
  const meshoptHighDecode = await timedDecodeMs(meshoptHighDoc);

  const row = {
    label,
    sourcePath: path.relative(process.cwd(), sourcePath),
    onDiskBytes: sourceBytes,
    onDiskGzipBytes,
    onDiskIsDraco: currentIsDraco,
    dracoReencode: dracoDecode,
    meshoptMedium: meshoptMediumDecode,
    meshoptHigh: meshoptHighDecode,
  };
  results.push(row);

  console.log(`\n${label}`);
  console.log(`  on-disk (current pipeline, Draco):  raw ${kib(sourceBytes)}  gzip ${kib(onDiskGzipBytes)}`);
  console.log(
    `  re-encoded Draco  (edgebreaker):    raw ${kib(dracoDecode.bytes)}  gzip ${kib(dracoDecode.gzipBytes)}  decode ${dracoDecode.ms.toFixed(2)}ms`,
  );
  console.log(
    `  Meshopt (level=medium):             raw ${kib(meshoptMediumDecode.bytes)}  gzip ${kib(meshoptMediumDecode.gzipBytes)}  decode ${meshoptMediumDecode.ms.toFixed(2)}ms` +
      `   (raw ${pct(dracoDecode.bytes, meshoptMediumDecode.bytes)}, gzip ${pct(dracoDecode.gzipBytes, meshoptMediumDecode.gzipBytes)} vs re-encoded Draco)`,
  );
  console.log(
    `  Meshopt (level=high):               raw ${kib(meshoptHighDecode.bytes)}  gzip ${kib(meshoptHighDecode.gzipBytes)}  decode ${meshoptHighDecode.ms.toFixed(2)}ms` +
      `   (raw ${pct(dracoDecode.bytes, meshoptHighDecode.bytes)}, gzip ${pct(dracoDecode.gzipBytes, meshoptHighDecode.gzipBytes)} vs re-encoded Draco)`,
  );
}

if (process.argv.includes("--json")) {
  const outDir = mkdtempSync(path.join(tmpdir(), "compression-benchmark-"));
  const outPath = path.join(outDir, "results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nJSON results: ${outPath}`);
}
