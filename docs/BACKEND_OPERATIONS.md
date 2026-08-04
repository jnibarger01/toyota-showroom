# Backend Operations

The showroom has two independent release surfaces:

- **GitHub Pages** serves immutable catalog fixtures generated under `public/catalog/v1`.
- **Cloudflare Workers + D1** serves request-aware configuration writes under `/api/v1/configurations`.

The browser SDK continues to fall back to localStorage when the Worker endpoint is unavailable.

## One-time Cloudflare setup

```bash
npx wrangler login
npx wrangler d1 create toyota-showroom-db
```

Copy the returned database UUID into the GitHub Actions secret `CLOUDFLARE_D1_DATABASE_ID`.
Configure these repository or `production` environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `WRITE_API_KEY` (optional; enables the `X-API-Key` write gate)

The committed `wrangler.jsonc` contains a valid all-zero local placeholder. The deployment workflow
replaces it in the ephemeral runner workspace before migrations and deployment. Do not commit the
real database ID or API key.

## Local verification

```bash
npm ci
npx wrangler d1 migrations apply DB --local
npm run typecheck
npm test -- --run
npm run build
```

Run the Worker-compatible development server with the configured local D1 binding:

```bash
npm run dev
```

The static health fixture checks catalog generation. The dynamic readiness endpoint checks D1:

```bash
curl -i http://localhost:3000/api/v1/health
curl -i http://localhost:3000/api/v1/readiness
```

## Deployment

Merging to `main` triggers `.github/workflows/deploy-worker.yml`. It runs typecheck, tests, and the
production build; applies all D1 migrations; configures the optional write secret; then deploys with
the native vinext Cloudflare adapter.

A manual deployment uses the same order:

```bash
npx wrangler d1 migrations apply DB --remote
npx @vinext/cloudflare@0.0.50 deploy
```

## Rollback

Pages is rolled back by redeploying or reverting the previous Git commit. Worker versions are
independent:

```bash
npx wrangler deployments list
npx wrangler rollback
```

Do not roll application code behind an already-applied destructive migration. Current migrations are
additive only. For a breaking schema change, deploy compatibility code first, then migrate, then
remove old code in a later release.

## Pages/Worker version skew

The catalog and Worker may briefly run different commits. Keep `/catalog/v1` and `/api/v1` backward
compatible within the major version. If writes reject newly introduced option IDs, leave the Worker
on the prior version or disable the write endpoint while the Pages release catches up; the browser
will use its localStorage transport.

## Logs and alerts

Configuration mutations emit one-line JSON with `event`, `requestId`, revision, and schema version.
Cloudflare's `cf-ray` is used as the request ID when available. Never add request bodies, API keys, or
other secrets to log fields.

Recommended production alerts:

- p99 configuration write latency above 250 ms for five minutes
- Worker 5xx rate above 1% for five minutes
- `/api/v1/readiness` returning 503

Application code reserves the `rate_limited` error contract, but globally consistent rate limiting
must be configured with a Cloudflare WAF/Workers rate-limit rule. An in-memory per-isolate limiter is
intentionally not used because it would provide misleading enforcement.

## Backup and recovery

D1 provides managed recovery, but take an export before destructive migration work:

```bash
npx wrangler d1 export toyota-showroom-db --remote --output backups/toyota-showroom-$(date +%F).sql
```

The localStorage transport is a single-browser fallback, not a backup or system of record.
