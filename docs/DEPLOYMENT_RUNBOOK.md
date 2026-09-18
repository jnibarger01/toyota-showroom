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

6. **Rate limiter namespaces.** `wrangler.jsonc`'s `ratelimits[].namespace_id` values (`1001`,
   `1003`, `1005`, `1007` in production) are developer-chosen, not Cloudflare-issued — no extra
   provisioning step needed; each is created implicitly on first deploy. Budgets and how to
   raise them are documented in §9.

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
not re-download the ~1.2 MiB GLB, and so a cached build still opens with the network offline. This is
**explicitly the Pages demo path** — it is not a substitute for the production Cloudflare Worker +
D1 stack (#49).

**It is gated on runtime proof, not on a build flag.** `lib/pwa/demoServiceWorker.ts` registers it
only once `getPersistenceMode()` resolves to `"local"` — that is, once the app has confirmed the API
routes are absent. A service worker installed against the Worker deployment could serve stale
configuration responses from cache, which is a much worse failure than the download it saves.

### Precache vs runtime strategies

Strategies: **network-first with a cached-document fallback for navigations** (without this the
browser never obtains an HTML document offline and never reaches anything else in the cache — the
offline claim above was false as written); cache-first for `/assets/*` (content-hashed, `immutable`,
so a hit cannot be wrong); stale-while-revalidate for `/models/*`, `/draco/*`, `/renders/*`,
`/images/*` (large and stable, but `public/_headers` serves them `must-revalidate` because the
optimisation scripts rewrite them in place under unchanged names); network-first for
`/catalog/v1/*.json`. `/api/*` is never intercepted.

The document is stored under one shared key rather than per-URL: every route of this prerendered
export ships the same client shell, so one cached document boots any of them and the router takes
over once the (cache-first) JS loads. Caching per-navigation would only make already-visited routes
work offline.

Cache writes are best-effort. `cache.put` rejects on a full quota or disabled storage, and awaiting
it in a handler's success path meant such a rejection failed the whole request — an optimisation
breaking live requests for online users.

On `install` the worker precaches:

- the critical static shell (`./`, `./index.html`, `./4runner/`);
- the active hero vehicle's models and still (default builder slug `4runner` —
  `modsnation_7416_assets_assembled.glb`, wheel/tire GLBs, hero PNG);
- that vehicle's catalog snapshots under `/catalog/v1/…`;
- the vendored Draco decoder trio under `/draco/`;
- content-hashed `/assets/*` URLs discovered by scraping `index.html` (so the list cannot drift from
  what the build emitted).

Runtime fetch strategies (canonical policy in `lib/pwa/demoSwPolicy.ts`, mirrored in `public/sw.js`):

- **cache-first** for `/assets/*` (content-hashed, `immutable`, so a hit cannot be wrong);
- **stale-while-revalidate** for `/models/*`, `/draco/*`, `/renders/*`, `/images/*` (large and stable,
  but `public/_headers` serves them `must-revalidate` because the optimisation scripts rewrite them
  in place under unchanged names);
- **network-first** for `/catalog/v1/*` (configuration / catalog JSON — live deploy wins online,
  cached copy keeps the demo opening offline);
- **`/api/*` is never intercepted** (configuration APIs stay network-only).

### Kill switch / version bump on deploy

`CACHE_VERSION` in `public/sw.js` is the kill switch. `activate` deletes every cache that is not the
current version, so a bump evicts everything previously stored. The worker also calls
`skipWaiting`/`clients.claim`, so an update takes effect on the next navigation instead of waiting
for every tab to close — a sticky cache on a demo surface is worse than no cache at all.

**Deploys stamp the version automatically.** `npm run build` ends with
`node scripts/stamp-demo-sw.mjs`, which rewrites `dist/client/sw.js`'s `CACHE_VERSION` to
`v-<git-sha>` (from `GITHUB_SHA` in CI, or `git rev-parse --short HEAD` locally). Override with
`DEMO_SW_CACHE_VERSION` when you need a forced eviction without a new commit. The source file keeps
`CACHE_VERSION = "dev"` so a forgotten stamp is obvious in review; do not hand-edit the stamped
value in `dist/`.

`.github/workflows/pages.yml` also runs `npm run sw:stamp` after the static export verify step so a
Pages deploy cannot ship an unstamped worker even if the build script is ever split.

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
  staging traffic would share production's write budgets.

---

## 8. Secrets

D1 and the rate limiter are bindings, not credentials. Optional CRM lead handoff (#23) reads Worker
secrets at runtime:

- `CRM_WEBHOOK_URL` — HTTPS endpoint that receives the agnostic `lead.created` JSON payload
  (vehicle, selections, share URL, owner-token metadata). When unset, CRM delivery is skipped and
  local lead persistence alone decides success.
- `CRM_WEBHOOK_SECRET` — optional bearer token sent as `Authorization: Bearer …`. Never embedded in
  the webhook JSON body and never available to the browser bundle.

```bash
npx wrangler secret put CRM_WEBHOOK_URL --name toyota-showroom
npx wrangler secret put CRM_WEBHOOK_SECRET --name toyota-showroom
```

`npx wrangler secret put <NAME> --name toyota-showroom` prompts for the value and stores it
encrypted, available in the Worker as `env.<NAME>`. Never commit a secret value to `wrangler.jsonc`
— bindings (D1 ids, rate-limiter namespace ids) are not secrets and are fine to commit
(`docs/INTEGRATION_GUIDE.md`'s own note on this); anything that authenticates to a third party
must stay in secrets.


---

## 9. Abuse controls (rate limits + optional bot friction)

Worker/D1 is the production persistence path. Public write endpoints ship with abuse defaults so a
scripted burst from one client cannot fill D1 unboundedly. Knobs live in two places that **must
stay aligned**:

| Knob | Where | Default (prod + staging) | What it meters |
|---|---|---|---|
| `CONFIG_CREATE_LIMITER` | `wrangler.jsonc` → `ratelimits` / `RATE_LIMIT_BUDGETS.configCreate` | **10 / 60s** | `POST /api/v1/configurations` per `cf-connecting-ip` |
| `CONFIG_WRITE_LIMITER` | `wrangler.jsonc` → `ratelimits` / `RATE_LIMIT_BUDGETS.configWrite` | **20 / 60s** | `PATCH`/`DELETE` per IP **and** independently per owner-token hash |
| `LEAD_WRITE_LIMITER` | `wrangler.jsonc` → `ratelimits` / `RATE_LIMIT_BUDGETS.leadWrite` | **5 / 60s** | `POST /api/v1/leads` per IP |
| `CATALOG_READ_LIMITER` | `wrangler.jsonc` → `ratelimits` / `RATE_LIMIT_BUDGETS.catalogRead` | **300 / 60s** | Catalog `GET`s per IP |
| Period | `ratelimits[].simple.period` / `RATE_LIMIT_PERIOD_SECONDS` | **60** | Sliding window length (also the `Retry-After` hint) |

Namespace ids (account-scoped, not Worker-scoped):

| Binding | Production `namespace_id` | Staging `namespace_id` |
|---|---|---|
| `CONFIG_CREATE_LIMITER` | `1007` | `1008` |
| `CONFIG_WRITE_LIMITER` | `1001` | `1002` |
| `LEAD_WRITE_LIMITER` | `1005` | `1006` |
| `CATALOG_READ_LIMITER` | `1003` | `1004` |

### Raising a limit

1. Edit `wrangler.jsonc` `ratelimits[].simple.limit` (and the matching staging entry).
2. Edit the matching constant in `lib/server/rateLimit.ts` → `RATE_LIMIT_BUDGETS` (structured 429
   bodies and unit tests read these constants).
3. Redeploy the Worker (`npm run deploy` / staging workflow). Rate-limit bindings take effect on
   the next deploy; no D1 migration is involved.
4. Update `docs/API_REFERENCE.md` / `docs/openapi.yaml`'s `x-rate-limit-definition` if the public
   contract number changed.

Do **not** raise create above write without a reason — create is the D1-fill vector. Prefer raising
`CONFIG_WRITE_LIMITER` when interactive builders on shared NATs are legitimately blocked.

### Structured 429 shape

Every rate-limited response is:

```json
{
  "error": {
    "code": "rate_limited",
    "status": 429,
    "message": "…",
    "details": {
      "retryAfterSeconds": 60,
      "periodSeconds": 60,
      "scope": "create" ,
      "limit": 10
    }
  }
}
```

`scope` is one of `create` | `ip` | `owner_token` | `lead` | `catalog`. The `Retry-After` response
header mirrors `details.retryAfterSeconds`.

### Optional Turnstile bot friction (create only)

Disabled by default. When enabled, `POST /api/v1/configurations` requires a Turnstile token in the
`cf-turnstile-response` header (`lib/server/botFriction.ts`). Missing token → `422 invalid_body`;
failed verify → `403 forbidden`.

```bash
# Required to enable (presence of the secret turns friction on):
npx wrangler secret put TURNSTILE_SECRET_KEY --name toyota-showroom

# Optional: force off without deleting the secret (value "0" / "false"):
npx wrangler secret put TURNSTILE_ENABLED --name toyota-showroom

# Optional public site key for a future client widget (safe as a var, not a secret):
# Add under wrangler.jsonc "vars": { "TURNSTILE_SITE_KEY": "0x…" } then redeploy.
```

Staging: pass `--env staging` / `--name toyota-showroom-staging` the same way as CRM secrets in §8.
Create a Turnstile widget in the Cloudflare dashboard (siteverify uses the widget's secret key).
Until the browser ships a widget, enable this only for API clients that can complete the challenge
out of band — the server path is real; the client UI is intentionally not required for acceptance.

### Quick verification

```bash
# Burst creates from one IP should 429 after the create budget (Worker must be deployed):
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<worker>/api/v1/configurations \
    -H "content-type: application/json" \
    -d '{"vehicleId":"4runner","gradeId":"sr5","modelYear":2024,"selections":{}}'
done
# Expect a mix of 201/422 (validation) then 429 with Retry-After: 60.
```

