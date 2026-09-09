# Production Lead Capture Design

## Goal

Replace the current UI-only lead success path with a real, server-validated, persisted lead submission flow that fails closed when the backend is unavailable.

## Scope

This slice implements the production foundation for the brief's lead requirements without pretending the broader dealership product is complete. It covers a generic contact/model lead now and establishes types that can be extended later for inventory, financing, trade-in, test-drive, and service lead subtypes.

## Existing architecture to preserve

- Next.js 16 + vinext App Router.
- Cloudflare Worker runtime with D1 bound as `DB` in production.
- Drizzle ORM schemas in `db/schema.ts` and SQL migrations in `db/migrations`.
- Server repositories are interfaces with in-memory implementations for Node/Vitest and D1 implementations bound in `instrumentation.ts`.
- API errors, telemetry, security headers, rate limiting, and `newId()` are shared infrastructure.
- Existing configuration persistence and 3D work are unrelated and must not be rewritten.

## Data model

Add append-only `leads` rows with:

- `id`: server-generated `lead_*` identifier.
- `kind`: typed lead category; initially `contact` and `model` are accepted by the public form/API.
- `name`: normalized customer name.
- `email`: normalized lowercase email.
- `message`: normalized free-text request.
- `vehicleId`: optional catalog vehicle id for model-context inquiries.
- `idempotencyKey`: caller-provided opaque key, unique when present.
- `createdAt`: server timestamp.

Do not store IP addresses, user-agent strings, raw request headers, analytics identifiers, or other unnecessary PII in the lead table.

## Validation

Server-side validation is authoritative. Reject malformed JSON, unknown keys, invalid lead kinds, blank/oversized names/messages, invalid/oversized email addresses, invalid vehicle ids, and oversized idempotency keys. When `vehicleId` is supplied, require it to resolve against the existing verified vehicle catalog.

Client validation is UX only and must not be treated as the security boundary.

## Persistence boundary

Create `LeadRepository` with in-memory and D1 implementations. Route handlers depend on the interface, never directly on Drizzle. D1 is bound from `instrumentation.ts` beside the existing configuration repository.

`create()` returns the canonical stored record. If a request supplies an idempotency key that already exists, return the existing record rather than create a duplicate.

## API

Add `POST /api/v1/leads`:

1. Enforce a dedicated lead-write rate limiter.
2. Enforce a bounded request body.
3. Parse and validate JSON.
4. Persist through `LeadRepository`.
5. Return `201` for a newly accepted lead or `200` for an idempotent replay.
6. Return `Cache-Control: no-store` and shared security headers.
7. Use shared route telemetry and normalized `ApiError` responses.

No successful response may be produced unless persistence returned a stored lead.

## Client behavior

`ValidatedLeadForm` must have a real submission authority. Its default behavior posts to `/api/v1/leads`; callers may inject an alternate submit function for tests or a future subtype-specific adapter.

The form may show success only after a successful server response. Provider/network/API errors keep the form populated and render an accessible error state. The form must never interpret a missing handler or a thrown request as success.

## Abuse / privacy controls

- Dedicated Cloudflare rate-limit binding for lead writes.
- Request-body size cap before JSON parsing.
- No PII in telemetry labels or error messages.
- No email/name/message in URLs or analytics.
- No logging of submitted lead bodies.

## Verification

Use test-first changes. Add unit tests for validation/repository semantics, route tests for invalid/valid/idempotent submissions and persistence failure, and component tests proving success appears only after accepted persistence and that failure remains visible and retryable.

Run lint, typecheck, unit tests, and production build through the existing PR CI. This slice is not complete until those checks are green.