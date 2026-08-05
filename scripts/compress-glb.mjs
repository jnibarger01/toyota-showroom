#!/usr/bin/env node
/**
 * Applies Draco geometry compression to the shipped 4Runner GLB. Re-runnable, but not idempotent
 * (compressing an already-compressed file re-decodes and re-encodes it — harmless, but pointless);
 * run once, against the version already fixed by scripts/fix-donor-geometry.mjs.
 *
 * Measured before writing this: 13 embedded textures total ~0.16 MiB out of a ~38.6 MiB buffer —
 * essentially all of this file's weight is geometry (positions/normals/UVs/indices), not images.
 * That's *why* Draco is the right lever here rather than texture re-encoding, which this GLB has
 * almost nothing to gain from.
 *
 * `public/draco/` already ships the matching *decoder* (Task 22 wired it into
 * `lib/three/assets.ts`) — this is what makes that decoder's first real workout.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { draco } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const GLB_PATH = new URL("../public/models/modsnation_7416_assets_assembled.glb", import.meta.url);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });

const document = await io.read(GLB_PATH.pathname);

// method: 'edgebreaker' — better compression than 'sequential' for connected meshes, which is
// what a vehicle body is; quantization defaults (position 14 bits, normal 10, texcoord 12) are
// gltf-transform's own, chosen for a good size/quality balance rather than overridden blind here.
await document.transform(draco({ method: "edgebreaker" }));

await io.write(GLB_PATH.pathname, document);

console.log(`Draco-compressed with ${KHRDracoMeshCompression.EXTENSION_NAME}.`);
