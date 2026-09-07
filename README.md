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
material naming contract, endpoint design, and the restoration flow.

## Run

```bash
npm install
npm run dev -- -p 3004
```

Open `http://127.0.0.1:3004/`.

```bash
npm test        # 88 unit tests (vitest)
npm run typecheck
npm run build
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

### Promote to production persistence
See docs/DEPLOYMENT_RUNBOOK.md for the full promote path.
Short version: migrate remote D1, deploy the Worker, verify health, reload the builder so the demo banner clears.

### Staging Worker CI (optional until secrets are set)

`.github/workflows/deploy-staging.yml` deploys the API Worker to Cloudflare staging on every PR
**when** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are configured. If
they are missing, the job **skips successfully** (notice only) so PRs are not red solely for that
reason. See `docs/DEPLOYMENT_RUNBOOK.md` §3 for how to add secrets and the checklist to restore
required staging later.


## Final packaged assets

This package includes the authoritative Blender source, final exported GLB, and approved hero render. See `FINAL_ASSET_MANIFEST.md`.
