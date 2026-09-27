import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import type { ExteriorSpin } from "../../lib/types/spin";

export interface ValidatedSpinFrame {
  url: string;
  sha256: string;
  width: number;
  height: number;
}

export interface SpinAssetValidation {
  ok: boolean;
  errors: string[];
  frames: ValidatedSpinFrame[];
}

const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 40;

function publicPath(publicDir: string, url: string): string {
  if (!url.startsWith("/")) throw new Error(`frame URL must be root-relative: ${url}`);
  const root = resolve(publicDir);
  const path = resolve(root, `.${url}`);
  if (path !== root && !path.startsWith(root + sep)) throw new Error(`frame escapes public directory: ${url}`);
  return path;
}
function meanAbsoluteDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 1;
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    sum += Math.abs(a[index]! - b[index]!);
  }
  return sum / (a.length * 255);
}

function cosineOfMotion(previous: Uint8Array, current: Uint8Array, next: Uint8Array): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let index = 0; index < current.length; index += 1) {
    const a = current[index]! - previous[index]!;
    const b = next[index]! - current[index]!;
    dot += a * b;
    aa += a * a;
    bb += b * b;
  }
  if (aa === 0 || bb === 0) return 1;
  return dot / Math.sqrt(aa * bb);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}
export function sequenceQaErrors(samples: readonly Uint8Array[]): string[] {
  if (samples.length !== 24) return [`expected 24 frame samples, got ${samples.length}`];
  const errors: string[] = [];
  const differences = samples.map((sample, index) =>
    meanAbsoluteDifference(sample, samples[(index + 1) % samples.length]!),
  );
  const baseline = median(differences);

  differences.forEach((difference, index) => {
    if (difference > Math.max(0.12, baseline * 3.5)) {
      errors.push(
        `frame ${String(index).padStart(2, "0")}→${String((index + 1) % 24).padStart(2, "0")} has a severe continuity jump (${difference.toFixed(3)})`,
      );
    }
  });

  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    const next = samples[index + 1]!;
    const before = meanAbsoluteDifference(previous, current);
    const after = meanAbsoluteDifference(current, next);
    const cosine = cosineOfMotion(previous, current, next);
    if (before > 0.025 && after > 0.025 && cosine < -0.97) {
      errors.push(`frame ${String(index).padStart(2, "0")} has a likely direction reversal (cosine ${cosine.toFixed(3)})`);
    }
  }

  return errors;
}
export async function validateSpinAssets(
  spin: ExteriorSpin,
  publicDir: string,
): Promise<SpinAssetValidation> {
  const errors: string[] = [];
  const frames: ValidatedSpinFrame[] = [];
  const samples: Uint8Array[] = [];
  const seenHashes = new Set<string>();
  let expectedWidth: number | undefined;
  let expectedHeight: number | undefined;

  if (spin.frames.length !== 24) errors.push(`${spin.id}: expected 24 frames, got ${spin.frames.length}`);

  for (let index = 0; index < spin.frames.length; index += 1) {
    const frame = spin.frames[index]!;
    try {
      const bytes = await readFile(publicPath(publicDir, frame.url));
      const metadata = await sharp(bytes).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width < 512 || height < 512) errors.push(`${spin.id}/${index}: image is only ${width}×${height}`);
      if (width !== spin.width || height !== spin.height) {
        errors.push(`${spin.id}/${index}: expected ${spin.width}×${spin.height}, got ${width}×${height}`);
      }
      expectedWidth ??= width;
      expectedHeight ??= height;
      if (width !== expectedWidth || height !== expectedHeight) errors.push(`${spin.id}/${index}: dimensions differ from frame 00`);
      if (spin.source.kind === "photo" && (metadata.exif || metadata.xmp)) {
        errors.push(`${spin.id}/${index}: photo contains EXIF/XMP metadata; strip it before publication`);
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (seenHashes.has(sha256)) errors.push(`${spin.id}/${index}: duplicate frame content`);
      seenHashes.add(sha256);
      frames.push({ url: frame.url, sha256, width, height });

      const sample = await sharp(bytes)
        .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: "fill" })
        .greyscale()
        .raw()
        .toBuffer();
      samples.push(new Uint8Array(sample));
    } catch (error) {
      errors.push(`${spin.id}/${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (samples.length === 24) {
    errors.push(...sequenceQaErrors(samples).map((message) => `${spin.id}: ${message}`));
  }

  return { ok: errors.length === 0, errors, frames };
}