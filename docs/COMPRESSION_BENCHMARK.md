# Geometry compression: Meshopt vs. Draco — benchmark and decision

Mission Priority 3. Evaluates `EXT_meshopt_compression` (via glTF Transform's `meshopt()` /
`meshoptimizer`) against this repo's current Draco pipeline (`scripts/optimize-models.mjs`), on
the real committed vehicle assets. Reproducible with `node scripts/benchmark-compression.mjs`.

## Decision

**Keep Draco. Do not adopt Meshopt for this app's assets, on the evidence below.**

Draco produced a smaller file than Meshopt — at both compression levels, before *and* after gzip
— on every one of the four real assets tested, by a wide margin (Meshopt ran 1.2×–2.6× *larger*
than Draco post-gzip). That is the opposite of "marginal"; it is not close enough to weigh against
Meshopt's usual advantage (faster decode) without direct evidence that the decode difference is
real and matters here — see "What this does not measure" below for why that evidence is out of
reach in this environment. Nothing about the measured outcome argues for switching.

## Method

`reencodeDraco`/`reencodeMeshopt` in the benchmark script take the **same decoded source
geometry** (the on-disk GLB, fully decoded back to plain float attributes) and re-encode it twice:
once through this repo's exact current Draco settings (`draco({ method: "edgebreaker" })`, matching
`optimize-models.mjs`), and once through `meshopt()` at `level: "medium"` and `level: "high"`,
preceded by `weld()` (gltf-transform's own documented recommendation for Meshopt, not applied on
the Draco leg since the current pipeline doesn't use it either). Comparing two *fresh* re-encodes
of the same source — rather than the on-disk file against a fresh Meshopt encode — isolates the
codec choice from any incidental drift between what's on disk and a clean re-encode.

Both a raw byte count and a gzip-compressed byte count (`zlib.gzipSync`, best compression) are
recorded for every variant. The gzip number is not incidental — see the callout below.

### Why gzip matters here specifically

Draco's arithmetic coding already leaves its buffers close to their entropy limit, so a further
gzip pass barely shrinks them further. Meshopt's filters (delta encoding + byte-oriented layout)
are deliberately designed to compress *well* under a generic byte-level compressor — its
size advantage over an uncompressed baseline, where it has one, is usually realized post-gzip, not
in the raw file. This is not a hypothetical for this app: `lib/three/assets.ts` already documents
that a Draco GLB here is commonly served with `Content-Encoding: gzip`. So the fair, decision-
relevant comparison is post-gzip, and the benchmark measures both.

## Results

Real Toyota assets, `public/models/`. `raw`/`gzip` are KiB; `decode` is the Node-side
`io.readBinary` wall-clock time for that variant (see caveat below). Percentages are relative to
the re-encoded Draco row (this repo's actual current output), not the on-disk file.

**4Runner body** (`modsnation_7416_assets_assembled.glb` — `BODY` + 4 placed wheels + 4 tyres)

| Variant | raw | gzip | decode |
|---|---|---|---|
| On-disk (current pipeline, Draco) | 1236.8 KiB | 1099.0 KiB | — |
| Re-encoded Draco (edgebreaker) | 1233.9 KiB | 1095.4 KiB | 127.2 ms |
| Meshopt, level=medium | 4201.3 KiB (**+240%**) | 3273.2 KiB (**+199%**) | 214.6 ms |
| Meshopt, level=high | 3175.9 KiB (**+157%**) | 2362.3 KiB (**+116%**) | 148.5 ms |

**AE86** (`toyota-ae86-ivofficial.glb` — `Car` + 4 wheels)

| Variant | raw | gzip | decode |
|---|---|---|---|
| On-disk (current pipeline, Draco) | 79.3 KiB | 70.4 KiB | — |
| Re-encoded Draco (edgebreaker) | 77.6 KiB | 68.3 KiB | 9.7 ms |
| Meshopt, level=medium | 331.8 KiB (**+328%**) | 209.3 KiB (**+206%**) | 16.6 ms |
| Meshopt, level=high | 282.5 KiB (**+264%**) | 180.0 KiB (**+164%**) | 13.5 ms |

**4Runner tire** (authored running gear, `4runner-2024/ModsNation_7416_tire.glb`)

| Variant | raw | gzip | decode |
|---|---|---|---|
| On-disk (current pipeline, Draco) | 167.1 KiB | 158.0 KiB | — |
| Re-encoded Draco (edgebreaker) | 166.2 KiB | 156.6 KiB | 16.8 ms |
| Meshopt, level=medium | 701.4 KiB (**+322%**) | 557.9 KiB (**+256%**) | 23.3 ms |
| Meshopt, level=high | 486.3 KiB (**+193%**) | 370.3 KiB (**+136%**) | 19.5 ms |

**4Runner wheel** (authored running gear, `4runner-2024/ModsNation_7416_wheel_a.glb`)

| Variant | raw | gzip | decode |
|---|---|---|---|
| On-disk (current pipeline, Draco) | 39.3 KiB | 35.6 KiB | — |
| Re-encoded Draco (edgebreaker) | 38.8 KiB | 35.2 KiB | 4.7 ms |
| Meshopt, level=medium | 131.5 KiB (**+239%**) | 104.6 KiB (**+197%**) | 6.1 ms |
| Meshopt, level=high | 100.3 KiB (**+158%**) | 78.2 KiB (**+122%**) | 6.0 ms |

Consistent across every asset, both quantization levels, and both raw and gzip measurement: Draco
wins on size, decisively. This tracks with a known, general property of the two codecs — Draco's
edgebreaker connectivity coding plus arithmetic coding of attribute residuals compresses closed or
near-closed mesh topology (a vehicle body, a wheel) substantially better than Meshopt's simpler
byte-oriented delta filters; Meshopt's usual selling point is a much cheaper *decode*, not a
smaller file.

## What this does not measure

- **Real browser decode cost.** The `decode` column above is `io.readBinary` inside the same Node
  process that just wrote the buffer — full document/JSON/accessor parsing, not an isolated
  measurement of the Draco or Meshopt decompression step, and not running through
  `DRACOLoader`/`three`'s WASM decoder path or a Meshopt WASM transcoder in an actual browser. It
  is why, in the numbers above, "Meshopt decode" sometimes reads slower than "Draco decode" —
  exactly backwards from Meshopt's well-known real-world advantage, which is a strong signal this
  proxy isn't isolating the thing it needs to. No GPU/browser is available in this environment to
  measure the real number; the closest thing this app already has is `model_loaded` telemetry
  (`lib/observability/clientMetrics.ts`, emitted from `VehicleCanvas.tsx`) — a real, deployed metric
  covering download + decode together, currently only for the shipped Draco path.
- **GPU memory, frame time, draw calls.** Both codecs decode to the same final vertex/index
  buffers on the GPU; the runtime cost of *rendering* the decoded mesh is identical either way, so
  this genuinely isn't expected to move — the size and decode-time findings above are the ones that
  could plausibly justify a switch, and this benchmark answers them directly rather than needing
  the GPU numbers to confirm the negative.
- **Visual equivalence.** Not tested — moot, since the size/decode evidence alone already argues
  against adopting Meshopt here; there was no reason to burn a browser-only visual diff on a codec
  change this benchmark doesn't recommend making.
- **Meshopt + KTX2 combined.** KTX2/Basis Universal texture re-encoding needs the `toktx` (KTX-
  Software) or `basisu` (Binomial) CLI; neither is available in this sandboxed environment via
  `apt` or `npm`, and building either from source is out of scope for a benchmark step. See
  `docs/KTX2_EVALUATION.md` for the full evaluation and why this is a genuine tooling blocker
  rather than a shortcut. Texture bytes are identical across every geometry variant above (none of
  these transforms touch textures), so this gap doesn't affect the geometry-compression conclusion.

## Revisiting this decision

The conclusion above is about *this app's current assets* — automotive body/wheel/tyre geometry,
tens of thousands of triangles, closed-ish topology. It is not a blanket claim that Draco always
beats Meshopt. Re-run `node scripts/benchmark-compression.mjs` if:

- A new vehicle asset with meaningfully different topology (very high triangle count, open/
  disconnected meshes, heavy morph-target or skinned-animation payload) is added — Meshopt handles
  morph targets and animation curves Draco's glTF extension does not touch at all (see
  `scripts/optimize-models.mjs`'s own header on why dead morph targets had to be pruned separately).
- The rendering path moves toward GPU-driven meshlet culling / clustering, where Meshopt's
  ecosystem (its clusterizer, `EXT_mesh_gpu_instancing` interplay) is the more natural fit
  regardless of raw file size.
- A real browser decode-time measurement becomes available (Playwright, real device profiling) and
  contradicts the Node-side proxy above.
