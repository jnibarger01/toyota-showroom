# Contributing

## Setup

Node `>=22.13.0` (`package.json`'s `engines`). From the repo root:

```bash
npm ci
npm run dev
```

`npm run dev` runs `predev` first (`tsx scripts/generate-static-api.ts`, which writes the
`.gitignore`d `public/catalog/` static-API mirror `lib/api/client.ts` falls back to on a backend-less
deployment) before starting `vinext dev`.

## Before opening a PR

`.github/workflows/ci.yml`'s `verify` job runs these, in this order, against every PR — run them
locally first, in the same order, so CI isn't the first place a failure shows up:

```bash
npm run lint        # eslint .
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build         # vinext build (also regenerates public/catalog/)
```

If the change touches anything rendered (a page, a component, CSS, the 3D scene, an asset), also
run the Playwright suite — it's a separate CI job (`.github/workflows/e2e.yml`) specifically so a
flaky visual diff never blocks the fast gate above, but it still gates merge:

```bash
npm run build
npm run test:e2e
```

`tests/e2e/build-and-restore.spec.ts` loads the real ~28 MiB base GLB in a real browser; expect the
full E2E run to take about a minute even locally.

## Testing conventions this repo actually follows

- **A new behavior needs a test that would fail without it.** Not aspirational — the convention in
  this codebase is to write the test, temporarily revert the fix (or otherwise reintroduce the bug
  it guards against), confirm the test goes red, then restore the fix and confirm green again.
  `docs/INTEGRATION_GUIDE.md` has several worked examples of this (the donor-geometry fix in §1,
  the Draco-decoder-vendoring fix in §14) if you want to see the pattern before using it.
- **Component tests** (`tests/components/*.test.tsx`, jsdom via Vitest's `environmentMatchGlobs`)
  mock `VehicleCanvas` and any network-touching module (`lib/api/*`) rather than letting a real
  fetch or a real Three.js scene into a unit test — see `tests/components/BuilderApp.test.tsx`'s
  and `tests/components/ExplorePage.test.tsx`'s top-of-file comments for the reasoning and the
  pattern to copy.
- **Real GLB structure is verified with raw parsing, not assumed.** `lib/tooling/glbInspect.ts` +
  `tests/glbContract.test.ts` parse the actual checked-in binary's JSON chunk — no Three.js, no
  DOM — so a typo'd node name or a swapped asset is caught at `npm test` time, not only in a
  browser. Follow this pattern for any change that touches
  `public/models/modsnation_7416_assets_assembled.glb`; see `scripts/fix-donor-geometry.mjs` and
  `scripts/optimize-models.mjs` for examples of editing that file programmatically (via
  `@gltf-transform/*`) with a before/after node-list diff instead of a blind overwrite.
- **Async UI has real race conditions — assume nothing is instant.** `tests/components/
  BuilderApp.test.tsx`'s `renderBuilderReady()` helper exists because grade buttons and the option
  catalog stay disabled/empty until an async scene-attach handshake resolves, a gap *after* the
  page's own heading already renders; a bare `await screen.findByRole("heading", ...)` raced it and
  passed locally while failing in real CI. If a component test interacts with something that
  depends on more than one async source resolving, wait for the last one, not the first.

## Documentation

- `docs/INTEGRATION_GUIDE.md` is the primary technical reference — architecture, the customization
  schema, the GLB node/material naming contract, the backend, security headers, and a running
  "Known gaps" list of everything genuinely unfinished and why. If you fix one of those gaps,
  remove or update its bullet in the same PR — don't leave a resolved gap listed as open.
- `docs/DEPLOYMENT_RUNBOOK.md` is the operational companion for actually deploying (D1/Worker
  setup, routine deploys, rollback).
- `docs/API_REFERENCE.md` documents `/api/v1/**` (OpenAPI-adjacent, hand-written against the real
  route handlers under `app/api/v1/`).
- `docs/DESIGN_TOKENS.md` documents the CSS custom-property design-token system in
  `app/globals.css`'s `:root`.

If a change makes something in these docs inaccurate, update the doc in the same PR. A stale doc
that contradicts the code is worse than no doc.

## Honesty about environmental constraints

This repo has no Cloudflare account credentials and no Blender/`.blend` source file in this
environment. Several documented gaps exist *because* of that (D1 not provisioned, the calipers'
local geometry never visually re-verified up close, GitHub Pages' custom-header support that
doesn't exist at all). If you hit a similar wall, disclose it in the PR description and in the
relevant doc's "Known gaps" section rather than working around it in a way that only looks
finished — a `--dry-run` or a local Miniflare instance (`getPlatformProxy()`,
`docs/INTEGRATION_GUIDE.md` §5) can verify a lot without real credentials; be explicit about what
it can't.

## Branch and commit conventions

No fixed branch-naming scheme is enforced. Commit messages in this repo favor explaining *why* a
change was made over *what* changed (the diff already shows what) — look at recent `git log` output
for the tone to match.
