# Deployment Runbook

Operational, step-by-step companion to `docs/INTEGRATION_GUIDE.md` §12 ("Deployment"), which
explains *why* the deployment setup looks the way it does. This document is for actually doing it:
first-time setup, routine deploys, verification, and rollback. Every command below was checked
against the real, installed `wrangler` CLI (`npx wrangler --version` → `4.92.0` at the time of
writing) via `--help` or `--dry-run` — this environment has no Cloudflare account credentials, so
none of the *mutating* commands below have been run for real; that gap is called out explicitly
wherever it applies, the same standing constraint `docs/INTEGRATION_GUIDE.md`'s D1 `database_id`
placeholder and staging-deploy notes already document.

## Two independent deployment targets

| Target | What it serves | How it deploys | Workflow |
|---|---|---|---|
| GitHub Pages | Static site: `dist/client` (app shell, catalog fixtures, images, the vehicle GLB) | Automatic, on push to `main` | `.github/workflows/pages.yml` |
| Cloudflare Worker | `/api/v1/**` only — configuration CRUD, backed by D1 | Manual (production) / automatic per-PR (staging) | `npm run deploy` / `.github/workflows/deploy-staging.yml` |

They are independent by design (`docs/INTEGRATION_GUIDE.md` §5's "Deployment note"): the static
site works standalone against `localConfigurationTransport` (browser `localStorage`) even with no
Worker deployed at all. Deploying the Worker adds server-side persistence and shareable links; it
is never required for the site to function.


## Promote: Pages demo to Worker/D1 production

GitHub Pages alone is the **demo / offline** surface: `localConfigurationTransport` + deep-link share.
**Worker + D1 is the production persistence path.** Promoting does not require Pages code changes;
the client auto-detects `/api/v1` once the Worker is reachable.

1. Finish §2 (production D1 migrate + deploy) and/or §3 (staging).
2. Point the site or a reverse proxy so browser calls to `/api/v1/**` reach the Worker.
3. Open the builder, change an option, and confirm the demo/offline banner is gone and saves report cloud status.
4. Validators are shared: `lib/validation/configuration.ts` is used by both the Worker routes and `localConfigurationTransport`.

---

---

## 1. Prerequisites

- A Cloudflare account with Workers and D1 enabled.
- `wrangler` authenticated against that account: `npx wrangler login` (interactive OAuth), or set
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment for non-interactive use
  (this is what CI uses — see §4). Verify with `npx wrangler whoami`.
- `npm ci` run at the repo root.

---

## 2. One-time setup: production

Run once, when standing up the Worker for the first time. All commands run from the repo root.

**Status in this repo:** steps 1–2 are done — `toyota-showroom` (`2af4c97e-c69a-4882-9c6b-f09f32e39948`)
was created via the Cloudflare Developer Platform MCP connector's `d1_database_create` (a real
Cloudflare account, reached through a connector grant rather than an authenticated local `wrangler`
CLI) and the id is already wired into `wrangler.jsonc`. Steps 3–4 are still open: no migration has
been applied to it yet, and nothing has deployed the Worker — that connector has no migration/deploy
tool, only D1/KV/R2/Workers resource management, so those steps still need real `wrangler`-CLI
credentials. Left below as the general procedure for reproducing this (e.g. a from-scratch clone,
or rotating to a new database).

1. **Create the D1 database:**
   ```
   npx wrangler d1 create toyota-showroom
   ```
   Copy the `database_id` (a UUID) from the output.

2. **Wire it into config.** Replace the placeholder in `wrangler.jsonc`:
   ```jsonc
   "d1_databases": [{
     "binding": "DB",
     "database_name": "toyota-showroom",
     "database_id": "REPLACE_WITH_REAL_D1_DATABASE_ID"  // <- paste the real UUID here
   }]
   ```

3. **Apply migrations to the real, remote database:**
   ```
   npm run db:migrate:remote
   ```
   (`wrangler d1 migrations apply toyota-showroom --remote` — applies everything under
   `db/migrations/`, currently just `0000_worried_tusk.sql`.)

4. **Build and deploy the Worker:**
   ```
   npm run deploy
   ```
   This runs `npm run build` then
   `wrangler deploy dist/server/index.js --no-bundle --env "" --config wrangler.jsonc`. The
   `--config wrangler.jsonc` flag is not optional — see §7's "redirected configuration" note below
   for what silently goes wrong without it.

5. **Verify:** `curl https://<your-worker-subdomain>.workers.dev/api/v1/health` should return
   `{"status":"ok", ...}` (`app/api/v1/health/route.ts`).

6. **Rate limiter namespace.** `wrangler.jsonc`'s `ratelimits[0].namespace_id` (`1001`) is a
   developer-chosen value, not Cloudflare-issued — no extra provisioning step needed, it's created
   implicitly on first deploy.

---

## 3. One-time setup: staging

Staging deploys automatically from `.github/workflows/deploy-staging.yml` on every pull request
against `main`, but needs the same real-resource setup once before it can do anything:

**Status in this repo:** step 1 is done — `toyota-showroom-staging`
(`4acd8ec7-26f2-40c0-b2d6-31377f395089`) exists and step 2's id is already wired in. Step 3 (the
GitHub repository secrets) is still open — the Cloudflare connector that created the database has
no access to GitHub, and doesn't expose a token this could paste in even if it did. Until step 3
lands, `deploy-staging.yml` **quarantines** missing secrets as a successful skip (see below), so
PRs stay mergeable.

1. **Create a separate staging D1 database** (never share production's — staging is expected to be
   reset/reseeded freely):
   ```
   npx wrangler d1 create toyota-showroom-staging
   ```

2. **Paste the id** into `wrangler.jsonc`'s `env.staging.d1_databases[0].database_id`.

3. **Add repository secrets** (GitHub repo → Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — a token with Workers Scripts:Edit, D1:Edit, and Workers Routes:Edit
     permissions (or Account → Cloudflare Workers, D1 templates in the Cloudflare dashboard's token
     creation UI).
   - `CLOUDFLARE_ACCOUNT_ID` — found on any Cloudflare dashboard page's right sidebar.

   **Quarantine (current default):** until both secrets are set, `deploy-staging.yml`'s
   "Check Cloudflare credentials" step emits a `::notice::` and sets `skip=true`. All migrate /
   deploy steps are gated on that output, so the job **exits successfully** and open PRs are not
   UNSTABLE solely because secrets are missing. This is intentional — secrets are unavailable to
   set in this environment — not a silent success pretending staging deployed. When the secrets
   *are* present, migrate + deploy still fail hard on real errors (`continue-on-error` is not used).

4. **Verify:** open any pull request against `main`.
   - Secrets unset: "Deploy Staging Worker" is **green** with a notice that staging was skipped.
   - Secrets set: the check is green with real migration/deploy log output (or red on a real
     wrangler/D1 failure).

Nothing else needs manual staging deploys after this — every PR gets its own fresh deploy to the
same `toyota-showroom-staging` Worker automatically.

### Checklist: restore required (non-skipping) staging later

When Cloudflare credentials are available and staging should become a real gate again:

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository Actions secrets (§3 step 3).
2. Confirm a PR run migrates + deploys (no skip notice); hit the smoke below.
3. Optionally make "Deploy Staging Worker" a required status check on `main` (branch protection).
4. Optionally tighten the workflow comment / this section to drop the "optional until configured"
   quarantine language once staging is permanently wired.


### One-command staging smoke (when configured)

After secrets are set and a staging deploy has run, smoke the Worker with health + one write
(replace the host with your staging Worker URL):

```bash
BASE=https://toyota-showroom-staging.<your-subdomain>.workers.dev
curl -sfS "$BASE/api/v1/health" && echo && \
curl -sfS -X POST "$BASE/api/v1/configurations" \
  -H 'content-type: application/json' \
  -d '{"vehicleId":"4runner","modelYear":2024,"gradeId":"trd-pro"}'
```

Expect health `status: "ok"` and a `201` with a `configurationId`. Same checks as §5, compacted.

---

## Demo service worker (Pages only)

`public/sw.js` caches the static shell and the vehicle assets so repeat visits to the Pages demo do
not re-download the ~1.2 MiB GLB, and so a cached build still opens with the network offline.

**It is gated on runtime proof, not on a build flag.** `lib/pwa/demoServiceWorker.ts` registers it
only once `getPersistenceMode()` resolves to `"local"` — that is, once the app has confirmed the API
routes are absent. A service worker installed against the Worker deployment could serve stale
configuration responses from cache, which is a much worse failure than the download it saves.

Strategies: cache-first for `/assets/*` (content-hashed, `immutable`, so a hit cannot be wrong);
stale-while-revalidate for `/models/*`, `/draco/*`, `/renders/*`, `/images/*` (large and stable, but
`public/_headers` serves them `must-revalidate` because the optimisation scripts rewrite them in
place under unchanged names); network-first for `/catalog/v1/*.json`. `/api/*` is never intercepted.

### Kill switch

Bump `CACHE_VERSION` in `public/sw.js`. `activate` deletes every cache that is not the current
version, so a bump evicts everything previously stored. The worker also calls
`skipWaiting`/`clients.claim`, so an update takes effect on the next navigation instead of waiting
for every tab to close — a sticky cache on a demo surface is worse than no cache at all.

To remove it entirely for a browser: promoting that origin to the Worker path is enough. On the next
load the mode resolves to `"worker"` and the registration is torn down automatically, with no
"clear your site data" instruction needed.

## 4. Routine deploys

**Static site:** nothing to run — push (or merge) to `main` and `.github/workflows/pages.yml`
handles the rest.

**Production Worker:** manual, on demand:
```
npm run deploy
```
There is deliberately no CI-driven production Worker deploy (`docs/INTEGRATION_GUIDE.md` §12) —
this is a real, standing gap, not an oversight; add one (mirroring `deploy-staging.yml`, minus the
per-PR trigger, e.g. on push to `main` with a manual-approval gate) if continuous production deploys
become desirable.

**Staging Worker:** nothing to run — every PR against `main` gets a fresh deploy automatically.

---

## 5. Post-deploy verification

1. **Health check:** `curl https://<worker>.workers.dev/api/v1/health` — `status: "ok"`,
   `vehicleCount` matches `lib/data/vehicles/index.ts`'s `VEHICLES.length` (4 as of this writing).
2. **A real write round-trip** (confirms the D1 binding, not just that the Worker booted):
   ```
   curl -X POST https://<worker>.workers.dev/api/v1/configurations \
     -H 'content-type: application/json' \
     -d '{"vehicleId":"4runner","modelYear":2024,"gradeId":"trd-pro"}'
   ```
   Expect a `201` with a `configurationId`; a `500` here with `health` still green usually means
   the D1 binding is missing or points at the wrong database (see §7, "wrong D1 binding" below).
3. **Recent deployments:** `npx wrangler deployments list --name toyota-showroom` (or
   `toyota-showroom-staging`) shows the new deploy at the top, with its version ID for §6's
   rollback.
4. **Logs, if something looks wrong:** `npx wrangler tail toyota-showroom` streams live request
   logs.

---

## 6. Rollback

Cloudflare Workers keep prior versions; rolling back does not require a revert-and-redeploy cycle:

1. `npx wrangler deployments list --name toyota-showroom` — find the version ID to roll back to.
2. `npx wrangler rollback <version-id> --name toyota-showroom -m "rolling back <reason>"`.

D1 has no equivalent one-command rollback — a migration is a forward-only SQL file
(`db/migrations/*.sql`). Reverting a bad migration means either a new migration that undoes the
change, or `wrangler d1 execute toyota-showroom --remote --command "..."` run by hand for a genuine
emergency. There is no destructive rollback command in this runbook by design — a compensating
migration is always the safer, reviewable path.

Static site rollback: revert the offending commit on `main` and let `pages.yml` redeploy, or
re-run a prior successful "Deploy Toyota Showroom" workflow run from the Actions tab.

---

## 7. Known gotchas

- **The redirected-configuration trap.** `@cloudflare/vite-plugin` auto-generates
  `dist/client/wrangler.json` during `npm run build`, and bare `wrangler deploy` prefers that
  redirected config by default — which does **not** re-resolve `--env staging`'s bindings, so
  `--env staging` against it silently deploys with *production's* D1 binding under the staging
  Worker's name. Always pass `--config wrangler.jsonc` explicitly (both `npm run deploy` and
  `npm run deploy:staging` already do). Verified via
  `wrangler deploy dist/server/index.js --no-bundle --env staging --dry-run`, with and without
  `--config wrangler.jsonc`, comparing which D1 database name each reports.
- **The Worker does not serve the static site.** `npm run deploy`/`deploy:staging` deploy
  `dist/server/index.js` only, `--no-bundle`, with no assets binding — `wrangler.jsonc` deliberately
  declares no `assets` block. The base vehicle GLB (~1.2 MiB after
  `docs/INTEGRATION_GUIDE.md` §15's Draco compression) exceeds Workers Static Assets' 25 MiB
  single-file cap, so an assets-inclusive deploy fails outright (`wrangler deploy --dry-run` against
  a config with an assets directory reproduces "Asset too large" for real). Until the GLB drops
  under that cap, GitHub Pages remains the only static-site target — this is why `public/_headers`
  (§17) has no live effect anywhere yet.
- **`database_id` placeholders (historical — resolved in this repo, still a real trap elsewhere).**
  A repo that hasn't run §2/§3 yet ships `REPLACE_WITH_REAL_D1_DATABASE_ID` /
  `REPLACE_WITH_REAL_STAGING_D1_DATABASE_ID` literally in `wrangler.jsonc`.
  `wrangler deploy --dry-run` doesn't catch this (confirmed: it compiles and lists bindings against
  the placeholder string without ever validating it against Cloudflare's API) — the actual failure
  only surfaces on a real, authenticated `deploy` or `d1 migrations apply --remote`. Cloudflare's own
  D1 lookup error is the expected shape (something to the effect of "couldn't find a D1 database"
  naming the bad id), not confirmed verbatim here; either way, that string still present in
  `wrangler.jsonc` at deploy time is the signal §2/§3 hasn't run yet. This repo's own ids are real as
  of the databases created in §2/§3's "Status" notes — the applies-migrations-and-deploys steps
  after id-wiring are the part still open, tracked there and in `docs/INTEGRATION_GUIDE.md`'s Known
  Gaps list, not this placeholder.
  **A sharper version of this trap for anyone cloning or forking this repo under a *different*
  Cloudflare account than the one that created these ids:** the committed `database_id`s are no
  longer the obviously-fake `REPLACE_WITH_REAL_*` strings — they're real UUIDs, so nothing about
  them *looks* wrong, and the placeholder-detection reasoning above doesn't apply. But they name
  databases in someone else's account. `wrangler deploy --dry-run` still won't catch this (same
  reason: no API validation), and a real, authenticated deploy/migrate against them will fail with
  a permissions/not-found error that has nothing to do with the ids being malformed — it'll look
  like an auth problem, not a config problem. If you don't recognize the ids in `wrangler.jsonc` as
  ones you created, that's the tell: run §2/§3 for real under your own account and replace both
  committed ids with your own before attempting a deploy or migration, don't assume they're
  reusable just because they parse as valid UUIDs.
- **Wrong D1 binding after a deploy** (health check green, writes 500): almost always means
  `--config wrangler.jsonc` was omitted and the previous gotcha's redirected config was used
  instead. Redeploy with the explicit flag.
- **Rate limiter namespace collisions.** `ratelimits[].namespace_id` is account-scoped, not
  Worker-scoped — production (`1001`) and staging (`1002`) must stay on different ids, or every PR's
  staging traffic would share production's 30-writes/minute budget.

---

## 8. Secrets

None of this app's current routes need a Worker secret (`wrangler secret put <key>`) — D1 and the
rate limiter are both bindings, not credentials read at runtime. This section exists as a pointer
for when one is needed: `npx wrangler secret put <NAME> --name toyota-showroom` prompts for the
value and stores it encrypted, available in the Worker as `env.<NAME>`. Never commit a secret value
to `wrangler.jsonc` — bindings (D1 ids, rate-limiter namespace ids) are not secrets and are fine to
commit (`docs/INTEGRATION_GUIDE.md`'s own note on this); anything that actually authenticates to a
third party would not be.
