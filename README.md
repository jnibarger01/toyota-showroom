# 4Runner WebGPU Builder — Build 7416 Assembled Asset

This project integrates the uploaded `modsnation_7416_assets_assembled.glb` as the primary vehicle asset.

## Stack

- Next.js / React
- vinext
- Three.js WebGPU renderer with WebGL2 fallback
- GSAP
- Tailwind CSS
- Lucide icons
- Drizzle ORM / Cloudflare D1 schema

## Integrated model

- File: `public/models/modsnation_7416_assets_assembled.glb`
- Size: approximately 1.2 MiB (down from 28 MiB; see `scripts/optimize-models.mjs`)
- 69 geometry objects
- Approximately 497,000 rendered triangles
- Includes body, placed wheels/tires, front and rear brakes, grille, headlights, taillights, exhaust, logo, and materials
- Vehicle paint material: `body.carmain`

The runtime does not add duplicate replacement wheels. Paint, camera, lift, and procedural accessory controls remain available.

## Additional packaged model

- File: `public/models/toyota-ae86-ivofficial.glb`
- Source: Toyota AE86 by IvOfficial (`ZEFWmOPSgh.glb`)

The AE86 is wired to a real catalog vehicle (`lib/data/vehicles/ae86.ts`, slug `ae86`) with a paint
customization catalog (`lib/data/options/ae86.ts`). The asset is a minimal FBX2glTF export — one
shared material across the body and all four wheels, no separate glass/chrome/trim materials — so its
catalog is deliberately paint-only for now; see that options file's header comment for the full node
inventory and why wheels/trim/accessories aren't offered yet. Tacoma and Camry remain catalog entries
without GLB assets until their source models are supplied and their node contracts are validated.

## Customization integration

Customization options, the Three.js scene, and configuration persistence are wired through a single
contract: a React control calls `configurationStore.selectOption(option)`, which updates state,
mutates the scene via `VehicleSceneController`, and persists the selection by option id.

See **[`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md)** for the schema, the GLB node and
material naming contract, endpoint design, and the restoration flow — §19 covers semantic scene
identity, BVH-accelerated part picking, and the agent-authorable scene API layered on top of it
(`docs/AGENT_API.md`), plus the evidence behind the asset pipeline and compression choices
(`docs/ASSET_PIPELINE_REPORT.md`, `docs/COMPRESSION_BENCHMARK.md`, `docs/KTX2_EVALUATION.md`,
`docs/POSTPROCESSING_EVALUATION.md`).

## Run

```bash
npm install
npm run dev -- -p 3004
```

Open `http://127.0.0.1:3004/`.

```bash
npm test        # unit tests (vitest)
npm run typecheck
npm run build
npm run test:e2e   # Playwright against dist/client under /toyota-showroom/
npm run test:e2e:update-visual  # refresh Linux Chromium visual baselines (see CONTRIBUTING.md)
npm run test:a11y  # axe-core serious/critical gate (explore/compare/builder/garage)
npm run test:perf  # Lighthouse + entry gzip budget on builder route
```

## Persistence: Worker/D1 (production) vs Pages (demo / offline)

| Surface | Role | Durability | Share |
|---|---|---|---|
| **Cloudflare Worker + D1** | **Production** persistence | Server-side, cross-browser | Configuration id links + deep links |
| **GitHub Pages + `localConfigurationTransport`** | Demo / offline fallback | This browser localStorage only | **Deep links** (`?c=…`) — not cloud ids |

Configuration writes need a request-aware runtime (the Cloudflare Worker). Under the static GitHub
Pages export those routes do not exist, so the client detects their absence once, shows a clear
**demo / offline** banner, and persists in the browser instead — running **the same validators** as
the Worker (`lib/validation/configuration.ts`). Share on Pages always prefers deep links so a build
can travel without D1.

### Share / save funnel telemetry

Client funnel events reuse `lib/observability/clientMetrics.ts` (same buffer + `sendBeacon` /
console sink as renderer metrics). Stable names (no PII in payloads):

| Event | When | Labels (fixed cardinality) |
|---|---|---|
| `build_started` | Builder session hydrates (once) | `source`: `fresh` \| `resume` \| `deep_link` |
| `option_changed` | Catalog option toggled | `category` (e.g. `paint`) |
| `share_copied` | Share link handed to clipboard/prompt | `link_kind`, `method` |
| `deep_link_restored` | `?c=…` restored a build (once) | — |
| `save_succeeded` / `save_failed` | Configuration persist flush | `surface` / `reason` |
| `persistence_mode` | Mode latches (once) | `mode`: `worker` \| `local` |

**How to read them**

- **Local / no collector:** open DevTools → Console. On tab hide / `pagehide`, look for
  `[metrics]` JSON (`flushMetrics`). Filter for the names above. Unit tests assert names and
  payload shape in `tests/funnelTelemetry.test.ts`.
- **Staging / production:** set `VITE_METRICS_URL` at build time to your collector (Vercel
  Analytics ingest, Cloudflare Worker log endpoint, or any HTTPS JSON receiver). Batches POST via
  `navigator.sendBeacon` as `{ metrics, at }`. Without that env var the sink stays console — honest
  default when no backend is wired.
- Helpers live in `lib/observability/funnelTelemetry.ts`; do not import vendor SDKs into the
  BuilderApp chunk for this funnel.

### Social preview (Open Graph)

Shared builder links should unfurl as a vehicle card, not a blank app tab:

| Surface | Share URL | Unfurl content |
|---|---|---|
| **GitHub Pages** | `/[slug]/?c=…` | Static vehicle OG (title + hero still) baked into HTML |
| **Cloudflare Worker** | `/api/v1/share-card?slug=&c=` (copied by Share when Worker mode is detected) | Grade + paint + wheels from the deep-link payload; browsers 302 to the builder |

See `docs/INTEGRATION_GUIDE.md` §4 "Open Graph + social preview" and `lib/showroom/openGraph.ts`.

### Promote to production persistence
See docs/DEPLOYMENT_RUNBOOK.md for the full promote path.
Short version: migrate remote D1, deploy the Worker, verify health, reload the builder so the demo banner clears.

### Staging Worker CI (optional until secrets are set)

`.github/workflows/deploy-staging.yml` deploys the API Worker to Cloudflare staging on every PR
**when** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are configured. If
they are missing, the job **skips successfully** (notice only) so PRs are not red solely for that
reason. See `docs/DEPLOYMENT_RUNBOOK.md` §3 for how to add secrets and the checklist to restore
required staging later.



## Accessibility gate (axe-core)

CI (`.github/workflows/e2e.yml`) runs Playwright axe-core scans on explore, compare, builder
chrome, and garage against the same production preview as the visual suite
(`scripts/preview-server.mjs` under `/toyota-showroom/`). The gate fails on **serious** and
**critical** impacts only; minor/moderate findings are printed for information.

Known exceptions live in `tests/e2e/a11y.spec.ts` as `A11Y_ALLOWLIST` — each entry needs a
rationale (today: exclude `.vehicle-canvas`, because axe cannot judge 3D pixels). Prefer fixing
the DOM over extending the list.

```bash
npm run build
npx playwright install chromium   # once
npm run test:a11y                 # axe only
# or: npm run test:e2e            # full Playwright suite including a11y
```

## Lighthouse budget (builder route)

CI (`.github/workflows/e2e.yml`) runs one desktop Lighthouse performance pass against the
**production preview** at `http://127.0.0.1:4173/toyota-showroom/4runner/` (same
`scripts/preview-server.mjs` base path as GitHub Pages), plus a gzip size check on the
initial (modulepreload / non-lazy) JS and CSS referenced by that route's HTML.
A huge unused **sync** script in the initial set fails the entry JS gzip budget with a
readable PASS/FAIL table; a multi-second main-thread block in the shell fails TBT.
Lazy 3D (`VehicleCanvas` / `.glb` / draco) is blocked during the Lighthouse run so metrics
reflect the builder shell — full WebGPU under headless CI is not a stable signal — and is
also excluded from the entry JS gzip sum. Chunk-level gzip gates remain in
`npm run bundle:budget` (#43) — route entry JS for `/`, `/explore`, `/4runner` plus per-chunk gzip gates; see `docs/PERF_BUDGETS.md`.

```bash
npm run build
npx playwright install chromium   # once — Lighthouse reuses Playwright Chromium
npm run test:perf
```

Budgets live in `lighthouse-budget.json` (edit there if a genuine, documented regression
needs more headroom):

| Check | Budget | Notes |
| ----- | ------ | ----- |
| Entry JS gzip | ≤ 450 KB | Sum of builder `modulepreload` (+ sync) JS; **no** lazy `VehicleCanvas` |
| Entry CSS gzip | ≤ 40 KB | Initial stylesheets |
| LCP | ≤ 5000 ms | Desktop preset; builder shell (3D/GLB blocked in the Lighthouse run) |
| TBT | ≤ 800 ms | Fails multi-second shell main-thread blocks; headroom for CI noise |

`test:perf` starts `scripts/preview-server.mjs` if nothing is already listening on 4173,
writes `lighthouse-report.json` (gitignored), and prints PASS/FAIL rows. Override the
browser with `CHROME_PATH` if you do not have Playwright Chromium.

## Final packaged assets

This package includes the authoritative Blender source, final exported GLB, and approved hero render. See `FINAL_ASSET_MANIFEST.md`.

### Read-only production smoke check

Run `SMOKE_BASE_URL=https://your-deployment.example/ npm run smoke:production` after a release.
The harness performs bounded GET-only checks against health and the paginated vehicle catalog,
validates their response contracts and baseline security headers, rejects credential-bearing or
insecure remote URLs, and emits one JSON result suitable for CI evidence.
