# Production Lead Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fake lead-form success with a real, server-validated, idempotent D1-backed lead submission path.

**Architecture:** Follow the repository's existing configuration-persistence pattern: typed validation -> repository interface -> in-memory test/dev implementation + D1 production implementation -> App Router API -> client transport. Bind D1 from `instrumentation.ts`; reuse API telemetry/security/error conventions; add a dedicated lead-write rate limiter.

**Tech Stack:** Next.js 16, React 19, vinext, TypeScript 5.9, Drizzle ORM, Cloudflare D1, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-production-lead-capture-design.md`

## Global Constraints

- Never fabricate dealer/Toyota data or claim a submission succeeded without authoritative persistence.
- Never log submitted PII or place it in URLs/analytics.
- Production must not silently fall back to fixture data.
- Preserve the existing configuration/3D architecture and in-flight PR work.
- All behavior changes use red-green TDD.

---

### Task 1: Lead domain validation

**Files:**
- Create: `lib/types/lead.ts`
- Create: `lib/validation/lead.ts`
- Test: `tests/leadValidation.test.ts`

**Interfaces:**
- Produces: `LeadKind`, `Lead`, `CreateLeadInput`, `ValidatedLeadInput`, `validateCreateLead(input: unknown): ValidatedLeadInput`.

- [ ] **Step 1: Write failing validation tests** covering accepted contact/model payloads, normalization, unknown keys, invalid email, blank/oversized fields, unknown kind, oversized idempotency keys, and an invalid vehicle id.
- [ ] **Step 2: Run `npx vitest run tests/leadValidation.test.ts` and confirm failures are caused by missing lead validation.**
- [ ] **Step 3: Implement strict types and `validateCreateLead` with bounded strings and catalog-backed `vehicleId` validation.**
- [ ] **Step 4: Re-run the focused test and confirm green.**
- [ ] **Step 5: Commit `feat: validate lead submissions`.**

### Task 2: Lead persistence boundary

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/0002_leads.sql`
- Create: `lib/server/leadRepository.ts`
- Create: `lib/server/d1LeadRepository.ts`
- Test: `tests/leadRepository.test.ts`

**Interfaces:**
- Consumes: `ValidatedLeadInput`, `Lead`.
- Produces: `LeadRepository.create(input): Promise<{ lead: Lead; created: boolean }>`; `getLeadRepository()`; `setLeadRepository()`.

- [ ] **Step 1: Write failing repository tests** for canonical ids/timestamps, idempotency replay, duplicate-key concurrency semantics, and no persistence of unmodeled PII.
- [ ] **Step 2: Run focused repository tests and confirm red.**
- [ ] **Step 3: Add the `leads` Drizzle table, unique idempotency index, SQL migration, in-memory repository, and D1 repository.**
- [ ] **Step 4: Re-run focused tests and confirm green.**
- [ ] **Step 5: Commit `feat: persist leads with idempotency`.**

### Task 3: Production binding and abuse controls

**Files:**
- Modify: `instrumentation.ts`
- Modify: `lib/server/rateLimit.ts`
- Modify: `wrangler.jsonc`
- Test: `tests/rateLimit.test.ts`

**Interfaces:**
- Produces: `enforceLeadWriteRateLimit(request, limiterOverride?)` and `LEAD_WRITE_LIMITER` binding.

- [ ] **Step 1: Add failing tests** proving lead limiter rejection, no client-controlled IP fallback, and independent lead/config buckets.
- [ ] **Step 2: Run the focused rate-limit tests and confirm red.**
- [ ] **Step 3: Add the limiter and bind `D1LeadRepository` beside `D1ConfigurationRepository` when `env.DB` exists.**
- [ ] **Step 4: Re-run focused tests and confirm green.**
- [ ] **Step 5: Commit `feat: bind and rate limit lead persistence`.**

### Task 4: Lead API

**Files:**
- Create: `app/api/v1/leads/route.ts`
- Test: `tests/leadRoute.test.ts`

**Interfaces:**
- Consumes: `validateCreateLead`, `getLeadRepository`, `enforceLeadWriteRateLimit`, shared telemetry/security headers.
- Produces: `POST /api/v1/leads` with `{ data: Lead }` and status 201/200.

- [ ] **Step 1: Write failing route tests** for malformed JSON, invalid input, oversize body, rate limiting, 201 create, 200 idempotent replay, no-store headers, and repository failure not becoming success.
- [ ] **Step 2: Run the focused route tests and confirm red.**
- [ ] **Step 3: Implement a dynamic App Router POST handler with pre-parse body-size enforcement and shared error/telemetry/security conventions.**
- [ ] **Step 4: Re-run focused tests and confirm green.**
- [ ] **Step 5: Commit `feat: add production lead API`.**

### Task 5: Fail-closed client submission

**Files:**
- Modify: `app/components/ValidatedLeadForm.tsx`
- Create: `lib/api/leadClient.ts`
- Create: `tests/components/ValidatedLeadForm.test.tsx`

**Interfaces:**
- Produces: `submitLead(input, options?)`; `ValidatedLeadForm` defaulting to real API transport.

- [ ] **Step 1: Write failing component/client tests** proving a missing/custom failing transport cannot display success, the default transport sends the expected JSON/idempotency key, server errors are shown accessibly, entered values survive failure, and successful acceptance clears/changes the UI only after response.
- [ ] **Step 2: Run the focused tests and confirm red.**
- [ ] **Step 3: Implement the client transport and form error/success state; never use optional-call success semantics.**
- [ ] **Step 4: Re-run focused tests and confirm green.**
- [ ] **Step 5: Commit `fix: make lead form success authoritative`.**

### Task 6: Full verification

**Files:**
- Modify docs only if verification exposes an inaccurate claim.

- [ ] **Step 1: Run `npm run lint`.**
- [ ] **Step 2: Run `npm run typecheck`.**
- [ ] **Step 3: Run `npm test -- --run`.**
- [ ] **Step 4: Run `npm run build`.**
- [ ] **Step 5: Verify the PR CI result and report exact failures rather than claiming completion if any gate is red.**

## Self-review

This plan intentionally does not implement inventory, service scheduling, auth, finance, trade-in, offers, dealer data, or the rest of the production brief. Those are separate production slices because each has distinct provider/data/security boundaries. This slice closes one existing non-negotiable defect and establishes reusable lead persistence for those later flows.