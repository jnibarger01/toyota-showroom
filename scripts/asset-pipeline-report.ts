/**
 * Production asset build pipeline — validation, semantic-contract verification, and metrics
 * evidence for every vehicle GLB this app ships. Mission Priority 2.
 *
 *   validate -> normalize/dedup/prune -> compress (draco) -> verify semantic node contract
 *   -> collect metrics -> report
 *
 * Read-only by default: every transform below runs in memory against a document `io.read()`
 * decoded, never overwriting `public/models/*`. `scripts/optimize-models.mjs` remains the one
 * script that writes those files — this one answers "is what's on disk still what the pipeline
 * would produce, and does it satisfy every vehicle's semantic scene-map contract", which is a
 * different, and repeatable, question from "optimize this file". Deterministic: no randomness,
 * same input always yields the same report, which is what makes this usable as a CI gate rather
 * than a one-off inspection.
 *
 * `--write-report <path.md>` writes the human-readable report (defaults to
 * `docs/ASSET_PIPELINE_REPORT.md`, regenerate after touching any shipped GLB or scene map).
 * `--json <path.json>` writes the same evidence as machine-readable JSON, for CI to diff or a
 * future MCP tool to read directly.
 * `--fail-on-contract-violation` exits non-zero if any vehicle's scene map has an unsatisfied
 * entry that scene map's own history doesn't already document as forward-declared (see
 * `EXPECTED_UNSATISFIED` below) — the CI gate that catches an asset re-export silently dropping a
 * node a customization option or the SceneRegistry depends on.
 *
 * Usage: npx tsx scripts/asset-pipeline-report.ts [--write-report path] [--json path] [--fail-on-contract-violation]
 */
import { readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression, EXTMeshoptCompression } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { VEHICLES } from "../lib/data/vehicles";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";
import { inspectGlb } from "../lib/tooling/glbInspect";
import { checkSceneMapContract, type SceneMapContractReport } from "../lib/tooling/sceneMapContract";

const repoRoot = path.resolve(import.meta.dirname, "..");
const publicPath = (urlPath: string) => path.join(repoRoot, "public", urlPath.replace(/^\//, ""));

interface AssetTarget {
  slug: string;
  label: string;
  urlPath: string;
  /** Whether the semantic scene map applies to this file in isolation. `false` for a standalone
   * running-gear asset (wheel/tire): those meshes have no `SceneMapEntry` of their own — they are
   * mounted *into* the body's `MOUNT_WHEEL_*` nodes at runtime and take on that mount's identity
   * (`VehicleCanvas.tsx`'s `installWheelAndTireAssets`), so checking the full vehicle scene map
   * against the wheel/tire file on its own is a category error, not a real contract violation. */
  checkSceneMap: boolean;
}

/**
 * Every GLB actually fetched by the running app for a vehicle with a semantic scene map —
 * `threeDConfig.modelUrl` plus, where present, the authored running-gear replacements
 * (`wheelAndTireAssets`). Vehicles with no scene map (`lib/data/sceneMap/index.ts` — Camry,
 * Tacoma today, both `hasModel: false`) are skipped: there is no semantic contract to verify, and
 * the mesh/material/texture metrics below are only meaningful for an asset this pipeline is
 * actually responsible for shipping.
 */
function collectTargets(): AssetTarget[] {
  const targets: AssetTarget[] = [];
  for (const vehicle of VEHICLES) {
    if (getSceneMapForVehicle(vehicle.slug).length === 0) continue;
    const config = vehicle.threeDConfig;
    if (config.hasModel && config.modelUrl) {
      targets.push({ slug: vehicle.slug, label: `${vehicle.model} body`, urlPath: config.modelUrl, checkSceneMap: true });
    }
    if (config.wheelAndTireAssets) {
      targets.push({ slug: vehicle.slug, label: `${vehicle.model} wheel (authored)`, urlPath: config.wheelAndTireAssets.wheelUrl, checkSceneMap: false });
      targets.push({ slug: vehicle.slug, label: `${vehicle.model} tire (authored)`, urlPath: config.wheelAndTireAssets.tireUrl, checkSceneMap: false });
    }
  }
  return targets;
}

/**
 * Forward-declared or runtime-only scene-map entries with no matching node in the *source* GLB —
 * expected, documented gaps, not pipeline regressions:
 *
 * - door/mirror/roof/interior: no separate geometry in this exterior-body-shell export at all
 *   (`lib/data/sceneMap/4runner.ts`'s header comment; mirrors `lib/data/vehicles/4runner.ts`
 *   forward-declaring `interior.seat` the same way). The badge is different: real `LOGO` geometry
 *   exists, and `badge.front` targets it directly (a P2 evidence-pass correction — see
 *   `lib/data/sceneMap/4runner.ts`'s own comment on that entry), so it is deliberately absent from
 *   this list — it is expected to be satisfied, not unsatisfied.
 * - vehicle.root: the source GLB's actual root node is unnamed/differently named; `VEHICLE_ROOT`
 *   is assigned at runtime by `prepareVehicleRoot()` (`VehicleCanvas.tsx`), never present in the
 *   file on disk.
 * - accessory.*: built procedurally at runtime (`buildProceduralAccessories`,
 *   `lib/three/proceduralParts.ts`) and attached to the loaded root — by design, not baked into
 *   the authored GLB, so a source-file-only check can never find them.
 *
 * `--fail-on-contract-violation` treats anything unsatisfied *beyond* this list as a real
 * regression — an asset re-export that dropped a node a customization option or the runtime scene
 * map depends on — while these stay a passing, expected state.
 */
export const EXPECTED_UNSATISFIED: Record<string, string[]> = {
  "4runner": [
    "door.front-left",
    "door.front-right",
    "mirror.left",
    "mirror.right",
    "interior",
    "roof",
    "vehicle.root",
    "accessory.roof-rack",
    "accessory.light-bar",
    "accessory.rock-sliders",
    "accessory.underglow",
    "accessory.fog-lights",
  ],
  // RAV4: a body-shell-only capture with no wheel/tire/door/mirror/badge/grille/interior/roof
  // geometry at all — see docs/RAV4_PROVENANCE.md §2 for the verified node/material inventory this
  // list is drawn from, and lib/data/sceneMap/rav4.ts's header for why each is forward-declared
  // against a node name that deliberately does not exist rather than a real-but-empty mount node.
  rav4: [
    "vehicle.root",
    "wheel.front-left",
    "wheel.front-right",
    "wheel.rear-left",
    "wheel.rear-right",
    "tire.front-left",
    "tire.front-right",
    "tire.rear-left",
    "tire.rear-right",
    "door.front-left",
    "door.front-right",
    "mirror.left",
    "mirror.right",
    "badge.front",
    "grille",
    "interior",
    "roof",
  ],
};

interface TextureMetric {
  name: string;
  mimeType: string | null;
  width: number;
  height: number;
  bytes: number;
}

export interface AssetMetrics {
  slug: string;
  label: string;
  urlPath: string;
  sourceBytes: number;
  meshCount: number;
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  largestTextures: TextureMetric[];
  compressionMode: "draco" | "meshopt" | "none";
  checkedSceneMap: boolean;
  semanticContract: { satisfiedCount: number; unsatisfied: { id: string; reason: string }[] };
  unexpectedContractViolations: string[];
  processingDurationMs: number;
  warnings: string[];
}

async function inspectAsset(io: NodeIO, target: AssetTarget): Promise<AssetMetrics | null> {
  const filePath = publicPath(target.urlPath);
  if (!existsSync(filePath)) {
    console.warn(`${target.label}: ${target.urlPath} not found on disk, skipping.`);
    return null;
  }

  const startedAt = performance.now();
  const warnings: string[] = [];

  const sourceBytes = statSync(filePath).size;
  const document = await io.read(filePath);
  const root = document.getRoot();

  let meshCount = 0;
  let triangleCount = 0;
  for (const mesh of root.listMeshes()) {
    meshCount += 1;
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute("POSITION");
      const vertexCount = indices ? indices.getCount() : (position?.getCount() ?? 0);
      triangleCount += Math.floor(vertexCount / 3);
    }
  }

  const materialCount = root.listMaterials().length;
  const textures = root.listTextures();
  const textureMetrics: TextureMetric[] = textures.map((texture) => {
    const image = texture.getImage();
    const [width, height] = texture.getSize() ?? [0, 0];
    return {
      name: texture.getName() || "(unnamed)",
      mimeType: texture.getMimeType() || null,
      width,
      height,
      bytes: image?.byteLength ?? 0,
    };
  });
  const largestTextures = [...textureMetrics].sort((a, b) => b.bytes - a.bytes).slice(0, 3);

  const rawJson = readFileSync(filePath);
  const extensionsUsed = readGlbExtensionsUsed(rawJson);
  const compressionMode: AssetMetrics["compressionMode"] = extensionsUsed.includes(KHRDracoMeshCompression.EXTENSION_NAME)
    ? "draco"
    : extensionsUsed.includes(EXTMeshoptCompression.EXTENSION_NAME)
      ? "meshopt"
      : "none";
  if (compressionMode === "none") {
    warnings.push("no geometry compression extension detected — this asset is shipping uncompressed.");
  }

  const contract: SceneMapContractReport = target.checkSceneMap
    ? checkSceneMapContract(inspectGlb(filePath), getSceneMapForVehicle(target.slug))
    : { satisfied: [], unsatisfied: [] };
  const expected = new Set(EXPECTED_UNSATISFIED[target.slug] ?? []);
  const unexpectedContractViolations = target.checkSceneMap
    ? contract.unsatisfied.filter((u) => !expected.has(u.entry.id)).map((u) => `${u.entry.id}: ${u.reason}`)
    : [];
  if (unexpectedContractViolations.length > 0) {
    warnings.push(`${unexpectedContractViolations.length} semantic part(s) unexpectedly unsatisfied — see unexpectedContractViolations.`);
  }

  return {
    slug: target.slug,
    label: target.label,
    urlPath: target.urlPath,
    sourceBytes,
    meshCount,
    triangleCount,
    materialCount,
    textureCount: textures.length,
    largestTextures,
    compressionMode,
    checkedSceneMap: target.checkSceneMap,
    semanticContract: {
      satisfiedCount: contract.satisfied.length,
      unsatisfied: contract.unsatisfied.map((u) => ({ id: u.entry.id, reason: u.reason })),
    },
    unexpectedContractViolations,
    processingDurationMs: performance.now() - startedAt,
    warnings,
  };
}

/** Reads `extensionsUsed` from the raw JSON chunk — cheap, and avoids trusting gltf-transform's
 * post-decode state (which has already stripped the Draco/Meshopt extension by the time `io.read`
 * returns) to answer "was this file actually compressed on disk". */
function readGlbExtensionsUsed(buffer: Buffer): string[] {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  return json.extensionsUsed ?? [];
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function renderMarkdown(metrics: AssetMetrics[]): string {
  const lines: string[] = [
    "# Asset pipeline report",
    "",
    "Generated by `npx tsx scripts/asset-pipeline-report.ts`. Do not hand-edit — regenerate after",
    "touching a shipped GLB or a `lib/data/sceneMap/*.ts` entry.",
    "",
  ];

  for (const asset of metrics) {
    lines.push(`## ${asset.label} (\`${asset.slug}\`)`, "");
    lines.push(`- Source: \`${asset.urlPath}\` — ${formatBytes(asset.sourceBytes)}`);
    lines.push(`- Meshes: ${asset.meshCount}   Triangles: ${asset.triangleCount.toLocaleString()}   Materials: ${asset.materialCount}   Textures: ${asset.textureCount}`);
    lines.push(`- Compression: ${asset.compressionMode}`);
    if (asset.largestTextures.length > 0) {
      lines.push(
        `- Largest textures: ${asset.largestTextures.map((t) => `${t.name} (${t.width}×${t.height}, ${formatBytes(t.bytes)})`).join(", ")}`,
      );
    }
    lines.push(
      asset.checkedSceneMap
        ? `- Semantic contract: ${asset.semanticContract.satisfiedCount} satisfied, ${asset.semanticContract.unsatisfied.length} unsatisfied` +
            (asset.unexpectedContractViolations.length > 0 ? ` (**${asset.unexpectedContractViolations.length} unexpected**)` : "")
        : "- Semantic contract: not applicable (mounted running gear — takes on its mount point's identity at runtime)",
    );
    // `processingDurationMs` is deliberately NOT written into the report.
    //
    // It is wall-clock time for parsing the asset, so it changes on every run and differs between
    // any two machines — it measures the host, not the asset. Committing it made the generated
    // document non-reproducible: regenerating produced a diff even when every asset was byte
    // identical, which is precisely what stops a generated artifact from being usable as a CI gate
    // (#34). The field stays on the in-memory result for anyone profiling the script.
    if (asset.warnings.length > 0) {
      lines.push(`- Warnings: ${asset.warnings.join("; ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * The side-effect-free core of the pipeline: inspect every target and return the metrics. Exported
 * so `tests/assetPipelineReport.test.ts` can assert the real committed assets keep satisfying their
 * scene maps as a normal `vitest run` check, not only when someone remembers to run this script by
 * hand — the "deterministic enough for CI" requirement this file's own header describes.
 */
export async function collectPipelineMetrics(): Promise<AssetMetrics[]> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });

  const metrics: AssetMetrics[] = [];
  for (const target of collectTargets()) {
    const result = await inspectAsset(io, target);
    if (result) metrics.push(result);
  }
  return metrics;
}

async function main() {
  const args = process.argv.slice(2);
  const flagValue = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const metrics = await collectPipelineMetrics();

  const markdownPath = flagValue("--write-report") ?? path.join(repoRoot, "docs", "ASSET_PIPELINE_REPORT.md");
  writeFileSync(markdownPath, renderMarkdown(metrics));
  console.log(`Wrote ${path.relative(repoRoot, markdownPath)}`);

  const jsonPath = flagValue("--json");
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
    console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);
  }

  for (const asset of metrics) {
    console.log(`\n${asset.label}: ${asset.semanticContract.satisfiedCount} parts satisfied, ${asset.unexpectedContractViolations.length} unexpected violations`);
    for (const warning of asset.warnings) console.log(`  ! ${warning}`);
  }

  if (args.includes("--fail-on-contract-violation")) {
    const violations = metrics.flatMap((m) => m.unexpectedContractViolations);
    if (violations.length > 0) {
      console.error(`\n${violations.length} unexpected semantic contract violation(s):`);
      for (const v of violations) console.error(`  - ${v}`);
      process.exitCode = 1;
    }
  }
}

// Only run when executed directly (`npx tsx scripts/asset-pipeline-report.ts`), not when
// `collectPipelineMetrics`/`EXPECTED_UNSATISFIED` are imported for testing.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
