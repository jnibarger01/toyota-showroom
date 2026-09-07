# Rendering-quality / postprocessing evaluation

Mission Priority 5. Evaluates `pmndrs/postprocessing` and Three.js-native postprocessing
(`EffectComposer` + passes, and the WebGPU-native `PostProcessing` node pipeline) against
`VehicleCanvas.tsx`'s current renderer.

## Decision

**Do not add postprocessing in this pass.** Not because no candidate effect has merit, but because
this mission's own bar for adopting one — *"Every effect must have: measurable cost"* — cannot be
honestly met in this environment (no GPU is attached to this sandbox; see "Why this can't be
measured here"), and two independent architectural facts make "add it now, measure it later" the
wrong order for this codebase specifically. This is evaluated and deferred, not skipped.

## Current baseline is already doing the load-bearing work

The mission's own priority ordering says realism should come primarily from *"correct geometry,
PBR materials, HDRI reflections, lighting, contact shadows, tone mapping"* before any postprocessing
is considered — and `VehicleCanvas.tsx` already has all of it, verified by reading the current
implementation rather than assumed:

- **Tone mapping**: `THREE.ACESFilmicToneMapping`, exposure 1.05 (line ~167).
- **PBR materials**: `MeshPhysicalMaterial` with clearcoat for paint (`MaterialWriter`,
  `lib/three/materials.ts`), matching real automotive clearcoat.
- **HDRI**: `lib/three/hdriEnvironment.ts` — PMREM-based environment lighting for the paint studio.
- **Contact shadows**: a purpose-built radial-gradient ground disc (`createContactShadow`) plus a
  real shadow-mapped directional key light, tuned specifically to avoid the "floating vehicle" and
  "washed-out contact shadow" defects `VehicleCanvas.tsx`'s own comments describe fixing.
- **Antialiasing**: already on — `antialias: quality.antialias` at renderer construction (MSAA on
  WebGL2; WebGPU's `WebGPURenderer` requests it too), quality-tier gated
  (`lib/three/quality.ts` — off at the `low` tier).
- **Adaptive quality**: `QualityGovernor` already downgrades shadow resolution and pixel ratio
  under sustained frame-time pressure — the mechanism a `low`-tier device needs before it needs a
  disable switch for a new effect nobody added yet.

Nothing in the candidate list (SMAA, SSAO, bloom, color grading, vignette, DoF) fixes a defect in
that baseline; each would be additive polish on top of an already-considered, already-tuned scene.

## Why this can't be measured here

Every candidate the mission names is a *"measurable cost, quality-tier behavior... WebGPU/WebGL
behavior documented"* item. This sandboxed environment has no GPU — the same constraint that
already governed the Meshopt/Draco benchmark (`docs/COMPRESSION_BENCHMARK.md`) and the KTX2
evaluation (`docs/KTX2_EVALUATION.md`). For a geometry-compression codec, a Node-side proxy
(decode wall-clock, gzip size) still produced decision-relevant evidence. Frame-time cost has no
comparable proxy: it is fundamentally a property of the GPU's fill-rate and pass-count budget,
which a CPU-only or software-rasterized (`SwiftShader`, what a headless-Chromium Playwright run
falls back to) environment cannot approximate meaningfully — a software rasterizer's per-pass cost
curve for `SSAOPass` vs. `UnrealBloomPass` bears no reliable relationship to how those same two
passes compare on the `low`/`medium`/`high` real GPUs `lib/three/quality.ts`'s tiers are meant to
describe. Implementing an effect and asserting a frame-time budget for it without that measurement
would be exactly the thing the mission's Non-Goals rule out: *"claim performance improvements [or,
by the same standard, acceptable costs] without measurements."*

## The dual-renderer architecture doubles the real cost of getting this wrong

`createRenderer()` (`VehicleCanvas.tsx`) picks `WebGPURenderer` when `navigator.gpu` is available,
falling back to `WebGLRenderer` otherwise — both paths are real, both are exercised in production
today. Three.js ships **two structurally separate, non-interoperable postprocessing systems**,
confirmed by inspecting the installed package rather than assumed:

- `three/examples/jsm/postprocessing/{EffectComposer,SMAAPass,SSAOPass,UnrealBloomPass,...}` — the
  classic pass-based pipeline, built against `THREE.WebGLRenderer`'s render-target API.
- `three/src/renderers/common/PostProcessing.js` (exported from `three/webgpu`) — a distinct,
  node/TSL-based pipeline built for `WebGPURenderer`, with its own composition model (`PassNode`,
  not `Pass`).

A `WebGLRenderer`-targeted `EffectComposer` chain does not run against a `WebGPURenderer`, and vice
versa. Adopting any effect from the mission's list means implementing, testing, and
quality-tier-gating it **twice** — once per renderer — or accepting a visual regression (the effect
silently missing) on whichever path doesn't get the second implementation. `pmndrs/postprocessing`
(the mission's other named option) is itself built against `WebGLRenderer` only, so it does not
close this gap either; adopting it would still leave the WebGPU path with no equivalent, or force
this app off WebGPU-when-available entirely, which is a change to the renderer selection strategy
the mission's own principles explicitly protect ("Preserve the Existing Renderer").

## What would justify revisiting this

- A way to actually measure GPU frame-time cost — a real device/browser profiling pass (this is
  exactly the kind of check the mission's "Runtime" instructions ask for before a UI or visual
  change is declared complete, and it is out of reach here specifically for a GPU-bound cost, not
  for lack of care).
- A concrete visual defect the current baseline doesn't already address (the sections above were
  read from the live implementation, not asserted) — at which point the fix is evaluated on its own
  merits, the same way `docs/COMPRESSION_BENCHMARK.md` and `docs/KTX2_EVALUATION.md` were.
- A decision to implement one pipeline only (WebGL2, accepting no postprocessing on the WebGPU
  path, with that gap documented) — a real, smaller-scoped option not pursued here because it
  still can't clear the "measurable cost" bar without a GPU, and choosing to regress one renderer
  path's parity is a call worth making deliberately, with evidence, not as a side effect of running
  low on this evaluation's time.
