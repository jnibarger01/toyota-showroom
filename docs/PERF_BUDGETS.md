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
| Starfield points | 400 | 200 | 80 |
| Frame-time instrumentation | always-on rolling avg on the canvas `dataset` | same | same |
| Idle suspend | tab hidden **or** canvas not intersecting | same | same |

Tier selection: `lib/three/quality.ts` (`selectQualityTier` / `resolveQuality`), driven by
Save-Data, `deviceMemory`, cores, mobile UA / coarse pointer, and DPR. Static pick at canvas setup —
not adaptive.

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
| Sequential, one attempt per id | A queue cannot saturate the connection it is staying out of the way of |

`window.__vehiclePrefetch()` lists warmed ids in DEV.

## Client bundle budgets

`scripts/bundle-budget.mjs` gates gzipped chunk sizes in `dist/client/assets` against
`scripts/bundle-budgets.json`, run in CI after `npm run build`.

```bash
npm run bundle:budget          # check
npm run bundle:budget:update   # re-baseline with 15% headroom, then commit the diff
```

Budgets are keyed on the de-hashed chunk stem. A chunk with **no** budget entry fails just as a
chunk over budget does — an unbudgeted chunk is how a budget file stops covering the thing it was
written for.

Measured in gzip because that is what the connection pays for; raw byte counts move for reasons
that do not change download time. #43 asked for per-route budgets — the build emits one `page`
chunk per route with no manifest mapping them back, and the expensive code (Three.js, the Draco
decoder) is lazily loaded and shared, so attributing it per route would either double-count it or
hide it. Chunk budgets state the same constraint without the arithmetic being a lie, and the
realistic regression — something pulling Three.js into the shared framework chunk — trips them
immediately.

Current headline chunks (gzipped): `VehicleCanvas` ~233 KiB (Three.js), `buildTools` ~166 KiB,
`draco_decoder` ~145 KiB, `framework` ~58 KiB. All three large ones are lazily loaded, so the
landing route does not pay for them.

## Tests

- `tests/quality.test.ts` — tier selection + settings
- `tests/progressiveLoad.test.ts` — phase machine / first-paint hooks
- `tests/canvasIdle.test.ts` — suspend boolean + observer wiring
- `tests/frameStats.test.ts` — rolling frame-time tracker
- `tests/glbContract.test.ts` — still green (unchanged asset contract)
