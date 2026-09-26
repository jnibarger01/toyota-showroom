#!/usr/bin/env node
/**
 * Fetches the catalog's HDRI environment maps from Poly Haven and writes them, downsampled, to
 * `public/hdri/`. Re-runnable; the output is committed, so this only runs when a preset changes.
 *
 * ## Why these files exist at all
 *
 * Environment reflection is the dominant shading cue on car paint — a clearcoat with nothing to
 * reflect reads as flat plastic. Before this, three of the four lighting presets (`HDRI_PRESETS` in
 * `lib/data/paintStudio.ts`) had no environment map, including the default one every viewer lands
 * on, and the fourth pointed at a 128x64 studio capture labelled "1k". So almost everyone saw the
 * vehicle under analytic lights only.
 *
 * ## Why 512x256
 *
 * The map is PMREM-prefiltered (WebGL) or sampled directly (WebGPU) for *reflections*, never shown
 * as the background (the showroom keeps its own palette colour). At that use, 512 wide resolves a
 * clearcoat's sharpest reflection at showroom camera distances; the 1k source is ~4x the bytes for a
 * difference that only shows in a mirror-finish close-up. The default preset downloads on every
 * builder visit, so its size is a real first-load cost.
 *
 * All sources are CC0 (https://polyhaven.com/license) — no attribution is legally required, but the
 * authors are recorded in `SOURCES` and in `docs/HDRI_PROVENANCE.md` anyway.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { HalfFloatType, DataUtils } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

const SOURCES = [
  { id: "studio_small_09", author: "Sergej Majboroda" },
  { id: "photo_studio_loft_hall", author: "Sergej Majboroda" },
  { id: "kloofendal_overcast_puresky", author: "Greg Zaal" },
  { id: "venice_sunset", author: "Greg Zaal" },
];
const TARGET_WIDTH = 512;
const OUT_DIR = new URL("../public/hdri/", import.meta.url).pathname;

/** Box-filters a linear RGB float image down by an integer factor (energy-preserving average). */
function downsample(src, width, height, factor) {
  const w = width / factor;
  const h = height / factor;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const i = ((y * factor + dy) * width + (x * factor + dx)) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
        }
      }
      const n = factor * factor;
      const o = (y * w + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return { data: out, width: w, height: h };
}

/** Float RGB → RGBE (Greg Ward's shared-exponent encoding, as Radiance defines it). */
function toRgbe(r, g, b) {
  const max = Math.max(r, g, b);
  if (max < 1e-32) return [0, 0, 0, 0];
  const exponent = Math.ceil(Math.log2(max));
  const scale = 256 / 2 ** exponent;
  // Guard the rounding edge where max * scale lands exactly on 256.
  const clamp = (value) => Math.min(255, Math.max(0, Math.floor(value * scale)));
  return [clamp(r), clamp(g), clamp(b), exponent + 128];
}

/** Encodes one channel of a scanline with Radiance "new-style" run-length encoding. */
function encodeRunLength(channel) {
  const out = [];
  let i = 0;
  while (i < channel.length) {
    let run = 1;
    while (i + run < channel.length && run < 127 && channel[i + run] === channel[i]) run += 1;
    if (run >= 3) {
      out.push(128 + run, channel[i]);
      i += run;
      continue;
    }
    // Literal span up to the next run of >= 3 (or 128 bytes).
    const start = i;
    while (i < channel.length && i - start < 128) {
      if (i + 2 < channel.length && channel[i] === channel[i + 1] && channel[i] === channel[i + 2]) break;
      i += 1;
    }
    out.push(i - start, ...channel.subarray(start, i));
  }
  return out;
}

function encodeHdr({ data, width, height }) {
  const header = `#?RADIANCE\n# Source: Poly Haven (CC0), downsampled by scripts/fetch-hdri.mjs\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const chunks = [Buffer.from(header, "ascii")];
  const channels = [0, 1, 2, 3].map(() => new Uint8Array(width));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      const rgbe = toRgbe(data[o], data[o + 1], data[o + 2]);
      for (let c = 0; c < 4; c += 1) channels[c][x] = rgbe[c];
    }
    const line = [2, 2, (width >> 8) & 0xff, width & 0xff];
    for (const channel of channels) line.push(...encodeRunLength(channel));
    chunks.push(Buffer.from(line));
  }
  return Buffer.concat(chunks);
}

mkdirSync(OUT_DIR, { recursive: true });
const loader = new HDRLoader();
loader.setDataType(HalfFloatType);

for (const { id, author } of SOURCES) {
  const url = `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const parsed = loader.parse(await response.arrayBuffer());
  const floats = Float32Array.from(parsed.data, (half) => DataUtils.fromHalfFloat(half));
  const factor = parsed.width / TARGET_WIDTH;
  if (!Number.isInteger(factor)) throw new Error(`${id}: ${parsed.width}px is not a multiple of ${TARGET_WIDTH}`);
  const small = downsample(floats, parsed.width, parsed.height, factor);
  const bytes = encodeHdr(small);
  const outPath = `${OUT_DIR}${id}_512.hdr`;
  writeFileSync(outPath, bytes);
  console.log(`${id} (${author}): ${parsed.width}x${parsed.height} -> ${small.width}x${small.height}, ${(bytes.length / 1024).toFixed(0)} KiB`);
}
