# KTX2 / Basis Universal texture compression — evaluation

Mission Priority 4. Evaluates KTX2/Basis Universal adoption for the vehicle assets currently
shipped in `public/models/`.

## Decision

**Defer.** Not adopted, for two independent reasons — either alone would be sufficient:

1. **The tooling to actually produce KTX2 textures is not available in this environment**, and
   there is no responsible way to work around that (see below).
2. **Even where the tooling were available, the evidence says it wouldn't matter here** — the
   entire texture payload across every shipped vehicle asset is 167 KiB, smaller than a single
   typical uncompressed mid-resolution PBR texture KTX2 is meant to shrink.

This is a genuine external blocker on this one track (mission Blocker Policy: "a blocker in one
optional track does not stop unrelated tracks") — Priorities 1–3 and 5–7 proceed independently.

## Real texture inventory

Read directly from the committed GLBs (`@gltf-transform/core`'s `NodeIO`, not estimated):

| Asset | Textures | Sizes | Total |
|---|---|---|---|
| 4Runner body (`modsnation_7416_assets_assembled.glb`) | 13 | 1.6 KiB – 87.0 KiB, mostly 256×256–512×512 | **167.1 KiB** |
| AE86 (`toyota-ae86-ivofficial.glb`) | 1 | 4.4 KiB, 256×256 | 4.4 KiB |
| 4Runner tire / wheel (authored running gear) | 0 | — | — |

The single largest texture across the entire catalog is `T_Brakes_Wilwood-4_D`, 87.0 KiB at
1024×1024 — everything else is 256×256 or 512×512 and a few KiB. KTX2/Basis Universal's real-world
wins (the ones the mission's own priority list names — base-color, normal, roughness/metalness,
interior, decal, wheel textures at typical game-asset resolutions of 1K–4K, often several MB each
uncompressed) come from shrinking large PBR texture sets and cutting GPU memory/upload cost for
them. There is no such texture set here to shrink: the entire vehicle's texture budget is smaller
than one moderately-sized texture a KTX2 pass is designed to target. Basis Universal's own
transcode overhead (a WASM transcoder module, plus per-texture transcode cost during load) is a
real cost too, one this catalog would pay in full for close to no size or memory benefit in return.
This is exactly the case the mission's own guidance calls out: *"Do not compress textures merely to
satisfy a checklist... keep original assets where compression materially harms fidelity"* — the
symmetric case applies here: compression buys nothing measurable, so it isn't owed a checklist tick.

## Tooling availability (checked directly, not assumed)

KTX2 encoding needs either the official KTX-Software `toktx` CLI or Binomial's `basisu` CLI — glTF
Transform's own KTX2 pipeline (`ktx-parse`, `@gltf-transform/functions`) parses/writes the
container format but does not ship a Basis Universal *encoder*; that has always been an external
binary dependency for every glTF tool in this ecosystem (gltfpack, gltf-transform, Blender's glTF
exporter all shell out to the same two CLIs).

Checked in this sandbox, none available:

- `which toktx basisu` — neither on `$PATH`.
- `apt-cache search ktx` / `apt-cache search basis` — the only Ubuntu package named `ktx` is
  `ktx` 1.42+dfsg-3, a **QuakeWorld game mod** ("Kombat Teams eXtreme"), unrelated; no
  `libktx-tools`/KTX-Software package, no `basisu` package, in the `noble` (24.04) repositories
  this environment has access to.
- `npm view basisu-encoder` — 404, does not exist as a package.
- A pure-JS/WASM encoder does exist on npm (`ktx2-encoder` / `babylonpress-ktx2-encoder`), but
  adopting a small, largely unaudited third-party WASM encoder as a build-pipeline dependency for a
  texture budget this evaluation has just shown doesn't need compressing is not a trade worth
  making — it would add a real supply-chain surface for a benefit already established to be
  negligible.

Building KTX-Software or `basisu` from source was considered and rejected as disproportionate: it
is a genuine option in an unconstrained environment, but not a reasonable one to reach for inside a
benchmarking/evaluation step for an asset catalog whose texture payload doesn't justify the tooling
in the first place.

## What was deliberately not built

No `KTX2Loader` wiring was added to `lib/three/assets.ts`/`VehicleCanvas.tsx`, and no
`.ktx2` assets were produced. Both would be speculative: there is nothing to load, and wiring a
loader path for a format the app ships zero assets in is exactly the kind of premature abstraction
the mission's own decision rules rule out ("A new abstraction must solve an existing coupling,
correctness, testing, performance, or extensibility problem" — Priority 6). If a future vehicle
ships large PBR texture sets (a real interior, high-res decals, 2K+ paint maps), re-run this
evaluation against that asset's actual texture inventory — the tooling-availability finding above
may no longer be a blocker in a different environment, and the size-payload finding will be a
different, asset-specific number worth checking on its own merits rather than assumed from this one.
