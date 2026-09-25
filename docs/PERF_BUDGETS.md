# Performance budgets — progressive load, LOD, idle canvas

Companion to issue #27. GLB **size** work is already landed (donor cleanup 56.9 → 38.7 MiB, then
Draco 38.7 → ~28.1 MiB — see `docs/INTEGRATION_GUIDE.md` §1 / §15). This document covers what remains
on the **runtime** path: first paint, quality tiers (LOD stand-in), frame-time metrics, and idle
suspend. Adaptive mid-session quality policy belongs to issue #33 and is out of scope here.

## Payload budget (already met — do not chase as #27 work)

| Asset | Target | Current |
|---|---|---|
| Base 4Runner GLB (`public/models/modsnation_7416_assets_assembled.glb`) | Prefer ≤ 25 MiB for Workers Static Assets; otherwise tolerate ~28 MiB on Pages | ~28.1 MiB (Draco) |
| Three.js / VehicleCanvas chunk | Lazy-loaded only on builder routes | See §16 |

Re-compressing the GLB is **not** the next lever for #27.

## Runtime budgets (Pages / mobile)

| Metric | High | Medium | Low |
|---|---|---|---|
| Pixel ratio cap | 2 | 1.5 | 1 |
| Shadow map | 2048, on | 1024, on | off |
| Antialias | on | on | off |
| Authored wheel/tyre glTF swap | yes | yes | skipped (faster settle) |
| Vehicle mesh (`modelDetail`) | full | full | `lodModelUrl` where shipped |
| Starfield points | 400 | 200 | 80 |
| Frame-time instrumentation | always-on rolling avg on the canvas `dataset` | same | same |
| Idle suspend | tab hidden **or** canvas not intersecting | same | same |

Tier selection: `lib/three/quality.ts` (`selectQualityTier` / `resolveQuality`), driven by
Save-Data, `deviceMemory`, cores, mobile UA / coarse pointer, and DPR. Static pick at canvas setup —
not adaptive.

## Model detail and LOD

`scripts/optimize-models.mjs` does two geometry passes beyond Draco on the heavy bodies (Camry,
RAV4 Hybrid, Land Cruiser):

- **Full asset:** meshoptimizer simplification at a 0.05% error bound on every primitive of ≥4k
  triangles *except paint*, plus WebP colour textures (≤2048px). Paint is excluded by exact material
  name (`scripts/model-pipeline-config.json`, tied to the catalog by
  `tests/modelPipelineConfig.test.ts`) because fewer triangles on a smooth panel visibly move the
  clearcoat highlight — confirmed in side-by-side renders before this shipped.
- **LOD1 (`*.lod1.glb`):** everything simplified hard, paint at a tight 0.2% bound, textures
  ≤256px. Loaded instead of the full asset on the `low` tier.

| Model | Before | Full | LOD1 |
|---|---|---|---|
| Land Cruiser 250 | 7.37 MiB / 1.56M tris | 4.31 MiB / 0.71M | 2.18 MiB / 0.35M |
| RAV4 Hybrid | 4.60 MiB / 0.37M | 3.42 MiB / 0.28M | 1.52 MiB / 0.07M |
| Camry | 3.91 MiB / 1.23M | 2.58 MiB / 0.60M | 1.40 MiB / 0.20M |
| 4Runner | 1.21 MiB / 0.33M | unchanged | 0.52 MiB / 0.11M |

`modelDetail` is construction-time (`CONSTRUCTION_TIME_QUALITY_KEYS`): the governor does not swap
meshes mid-session, and pinning a different tier reports "reload to apply" like antialias does.
`tests/glbContract.test.ts` holds every LOD to the full catalog contract and to < 70% of its full
asset's bytes; `tests/e2e/model-integrity.spec.ts` proves the low tier fetches only the LOD.

## Progressive load

1. Renderer + studio environment + rAF loop start immediately.
2. Procedural stand-in (`createProceduralVehicle`) paints as first usable frame while the ~28 MiB
   GLB downloads/decodes (`lib/three/progressiveLoad.ts` phases).
3. Builder chrome hydrates as soon as catalog + configuration bootstrap finishes
   (`configurationStore.hydrate`) so option buttons and Share are usable during the placeholder
   phase — they do **not** wait on full GLB settle.
4. On success the stand-in is disposed and the detailed root is prepared, optionally gets authored
   running gear, then `onReady` fires with a verified `VehicleSceneController` and the catalog is
   narrowed to mesh-satisfied options.
5. On failure the stand-in is promoted to the permanent fallback (same UX as before).

## Idle suspend

`lib/three/canvasIdle.ts` combines Page Visibility and `IntersectionObserver`. While suspended the
rAF loop stops; leaving idle restarts it. Canvas `data-idle="1"` reflects the gate.

## Instrumentation

`lib/three/frameStats.ts` records a rolling window of frame deltas on the WebGPU/WebGL path used by
`VehicleCanvas`. Latest summary is written to `canvas.dataset.frameStats`; in DEV,
`window.__vehicleFrameStats()` returns the snapshot. `snapshot()` keeps a running sum rather than
re-adding the ring buffer, because the render loop calls it every frame while publishing only every
30th.

### GPU timing

`lib/three/gpuTimer.ts` adds the GPU-side counterpart, behind capability detection: three's
`trackTimestamp`/`resolveTimestampsAsync` on WebGPU, `EXT_disjoint_timer_query_webgl2` on the
classic WebGL2 renderer, and `null` where neither exists — both are optional features and neither is
universal. Published as `canvas.dataset.gpuFrameMs`, read via `RenderController.getGpuFrameMs()`.

Read it **against** `avgFrameMs`, not instead of it. `avgFrameMs` is the wall-clock gap between rAF
callbacks, so it cannot distinguish a CPU-bound frame from a GPU-bound one — and every knob the
quality ladder controls is GPU cost. A large CPU/GPU gap means stepping the tier down will degrade
the image without recovering frame time.

It is deliberately **not** wired into `QualityGovernor`'s stepping decision. That policy was tuned
against the CPU signal, and this repo has no GPU available to measure against (the same constraint
`docs/POSTPROCESSING_EVALUATION.md` documents). Changing the policy needs real-device data first.

## Idle prefetch

`lib/three/prefetch.ts` warms assets a viewer is likely to reach for next, started from
`VehicleCanvas` once progressive load reports `ready`.

Scope is narrow on purpose: **HDRIs only**. Grade switches load nothing (every grade of a vehicle
shares one GLB) and paint options are material parameters, not downloads. The only builder
selection that triggers a cold fetch is an HDRI preset carrying an `hdrUrl` — today `hdri-sunset` —
where a multi-hundred-KB `.hdr` is fetched, parsed and PMREM-filtered while the viewer waits on an
option already presented to them. #53's title says "grade / paint assets"; for this catalog there
are none, and prefetching resident assets would be motion without effect.

Budget, enforced by construction rather than by a number:

| Guard | Why |
|---|---|
| Starts only after `ready` | Bandwidth before first paint delays the vehicle itself |
| `requestIdleCallback` (4s timeout) | Yields to rendering and interaction; the timeout stops a never-idle page from never prefetching |
| Stops while `data-idle="1"` | A backgrounded tab must not spend someone's data |
| Off on the `low` tier and under Save-Data | Both are explicit constraint signals `quality.ts` already respects |
| Medium caps at one warm (`prefetchBudgetForTier`) | Skip on low, *reduce* on medium — not a full queue on a mid-tier device |
| Sequential, one attempt per id | A queue cannot saturate the connection it is staying out of the way of |

`window.__vehiclePrefetch()` lists warmed ids in DEV.

The tier is read through a predicate on every item, not snapshotted at construction: a governor
downgrade after the scheduler is built must stop queued fetches, or the policy protects the wrong
devices. `start()` is also the resume path — the scheduler stops rather than spins while suspended.
Resume is wired through `RenderController`'s `onIdleChange` (visibility *and* intersection), not only
`visibilitychange`; listening only to tab visibility left a scrolled-away canvas unable to restart
prefetch when it came back on screen.

HDRI URLs are resolved through `lib/shared/basePath.ts`. Catalog `hdrUrl`s are root-relative and the
Pages deployment is served from a sub-path, so an unresolved request hits the domain root and 404s —
which silently disabled both this prefetch and the WebGPU IBL path on that deployment.

## XR (immersive AR)

`lib/three/xrSession.ts` owns `immersive-ar` session lifecycle only. The builder always exposes the
AR control: when `navigator.xr.isSessionSupported("immersive-ar")` is false (desktop browsers, iOS
Safari today, insecure contexts) the control stays disabled and `lib/three/xrCapability.ts` supplies
the unsupported-device message. Enter and exit both come from that one control so phone browsers that
keep page chrome visible while presenting can leave AR without hunting for a system button.

The load-bearing detail is frame pacing. `RenderController` normally drives its own
`requestAnimationFrame` chain, which **cannot** pace an XR device: those frames come from the
headset or phone compositor via `renderer.setAnimationLoop`, which also supplies the `XRFrame` and
the correct per-eye projection. `setXrPresenting` cancels the rAF chain on entry and restores it on
exit; running both would render every frame twice.

`OrbitControls` is disabled for the duration — the device owns the pose, and orbit input writing to
the same camera fights head tracking, which reads as motion sickness rather than as a camera bug.
The cinematic tour already takes the controls the same way.

Idle suspension does not apply while presenting: an `IntersectionObserver` on the page canvas says
nothing about what the headset is showing.

### Compositing over the camera

An XR session showing the *room* rather than the showroom needs three things, all of which the first
implementation missed:

1. `alpha: true` on the renderer. A construction-time argument, like `antialias` — with `alpha: false`
   the framebuffer has no transparency for passthrough to show through. Costs nothing outside XR,
   since `EnvironmentController` still paints an opaque `scene.background`.
2. `EnvironmentController.setPassthrough(true)` — clears background and fog, hides floor, grid,
   starfield and rocks. The light rig stays: it is what makes the vehicle read as a physical object
   in the room rather than a flat cutout. Re-asserted from `applyPalette` and after an HDRI apply, so
   a preset change mid-session cannot put the showroom back in front of the camera.
3. Stopping everything that writes the camera — `cancelTour()`, `setAutoRotate(false)`, then
   `setControlsEnabled(false)`. Disabling controls alone only refuses new input; a running GSAP tour
   or auto-rotate still moves the virtual origin while the device supplies the real pose, which is
   motion sickness rather than a camera bug.

`local-floor` is requested **optionally**, not required: `isSessionSupported("immersive-ar")` does
not account for reference-space features, so requiring it made the entry control fail on tap for
devices that passed the support check.

**Not verified on hardware / no device e2e in CI.** The session lifecycle is unit-tested against a
stubbed `navigator.xr` (ordering of the renderer handover, declined permission, device-initiated
exit, unmount during the permission prompt). Builder chrome coverage pins enter/exit wiring and
unsupported messaging via a mocked `VehicleCanvas` — Playwright CI has no WebXR runtime, so a
device-only e2e would be flaky and is intentionally omitted. Whether AR *looks* correct on a phone
is not something any test here can claim. No hit-testing or placement UI: `local-floor` puts the
vehicle on the viewer's real floor, which is enough to walk around it. Configured paint, wheels, and
accessories are the same `VehicleSceneController` scene the desktop path already paints — XR does
not fork materials.

## Client bundle budgets

`scripts/bundle-budget.mjs` gates client JS after `npm run build` (wired in `.github/workflows/ci.yml`).
Two complementary checks (#43):

1. **Route entry JS** — gzipped sum of `modulepreload` + sync `<script>` assets on the critical
   routes `/` (home), `/explore`, and `/4runner` (builder). Cold-visit cost only; lazy
   `VehicleCanvas` / Draco are not in the HTML preload set. Budgets live in
   `scripts/route-bundle-budgets.json`.
2. **Chunk sizes** — every hashed file under `dist/client/assets/*.js`, keyed on the de-hashed
   stem, against `scripts/bundle-budgets.json`. Catches shared-chunk bloat and any new unbudgeted
   chunk after a rename or split.

```bash
npm run bundle:budget          # check routes + chunks
npm run bundle:budget:update   # re-baseline both with 15% headroom, then commit the diff
```

A route or chunk over budget, or a chunk/route with **no** budget entry, fails with a readable
`FAIL` report — the same acceptance as “a PR that adds >budget JS to a critical route fails CI”.
Measured in gzip because that is what the connection pays for.

| Route | What it gates | Notes |
|---|---|---|
| `/` | Home / default builder shell entry JS | Same `BuilderApp` surface as `/[slug]` |
| `/explore` | Explore catalog entry JS | Must stay far below builder (no `buildTools`) |
| `/4runner` | Canonical builder entry JS | Matches Lighthouse preview target; still excludes lazy 3D |

Headline chunks (gzipped, lazy): `VehicleCanvas` ~235 KiB (Three.js), `buildTools` ~166 KiB,
`draco_decoder` ~145 KiB, `framework` ~58 KiB. Route entry budgets cover the non-lazy set only;
chunk budgets cover the lazy set so Three.js cannot silently move into the shared framework chunk.

## Tests

- `tests/quality.test.ts` — tier selection + settings
- `tests/progressiveLoad.test.ts` — phase machine / first-paint hooks
- `tests/canvasIdle.test.ts` — suspend boolean + observer wiring
- `tests/frameStats.test.ts` — rolling frame-time tracker
- `tests/glbContract.test.ts` — still green (unchanged asset contract)
