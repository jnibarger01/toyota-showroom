# API Reference

The source of truth is [`docs/openapi.yaml`](./openapi.yaml), an OpenAPI 3.1 document hand-written
against the real route handlers under `app/api/v1/`. This page is a short pointer, not a
duplicate — request/response shapes, status codes, and error bodies belong in the YAML; if
something here ever disagrees with it, the YAML wins.

## Viewing it

No viewer is bundled in this repo. Paste the file's contents into
[editor.swagger.io](https://editor.swagger.io) for an interactive explorer, or open it directly —
it's plain, commented YAML and reads reasonably well on its own.

## Keeping it accurate

`scripts/validate-openapi.ts` (`tests/openapi.test.ts` runs it as part of `npm test`) checks that
every internal `$ref` resolves, every response has a description, and the documented path list
matches the real route files — it does **not** check that a documented request/response shape
matches the actual TypeScript types or validation logic in `lib/validation/configuration.ts` /
`lib/api/query.ts`, since that would need a schema-generation step this project doesn't have. A
route handler change should update `docs/openapi.yaml` by hand in the same PR
(`CONTRIBUTING.md`'s "update the doc in the same PR" rule).

## What's covered, at a glance

| Route | Auth | Cacheable | Reachable from |
|---|---|---|---|
| `GET /health` | none | no (`no-store`) | Both deployment targets — static |
| `GET /vehicles` | none | yes (300s) | Both — static |
| `GET /vehicles/{slug}` | none | yes (300s) | Both — static |
| `GET /vehicles/{slug}/options` | none | yes (300s) | Both — static |
| `GET /vehicles/{slug}/media` | none | yes (300s) | Both — static |
| `POST /configurations` | none (issues a capability token) | no | Worker only — dynamic |
| `GET /configurations/{id}` | none | no | Worker only — dynamic |
| `PATCH /configurations/{id}` | `X-Owner-Token` | no | Worker only — dynamic |
| `DELETE /configurations/{id}` | `X-Owner-Token` | no | Worker only — dynamic |

"Worker only — dynamic" means GitHub Pages cannot serve these at all
(`docs/INTEGRATION_GUIDE.md` §5's "Deployment note", §12/`docs/DEPLOYMENT_RUNBOOK.md`) — a static
export has no server to run request-time code against. `lib/api/configurations.ts` detects that
absence once and falls back to `localConfigurationTransport` (browser `localStorage`), running the
same validators the server does, so the app still works end-to-end with no Worker deployed.

`POST`/`PATCH`/`DELETE` on `/configurations` are rate-limited: 30 requests/minute, keyed by client
IP (`lib/server/rateLimit.ts`) — see `docs/openapi.yaml`'s `x-rate-limit-definition` and each
operation's `429` response for the exact shape.
