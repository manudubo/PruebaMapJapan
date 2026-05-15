# Concerns

**Last mapped:** 2026-04-25

## Security

### XSS via unsanitized `innerHTML`
**Severity: HIGH**
**Files:** `frontend/src/pages/tripDetail.ts`, `frontend/src/pages/dashboard.ts`, `frontend/src/modules/map.ts`

User-controlled strings (trip names, activity names, hotel names) from the API are injected via `innerHTML` without sanitization. An attacker who can write to the DB (or MITM the API response) can inject arbitrary HTML/JS.

**Recommendation:** Use `textContent` for text values, or DOMPurify for HTML that must be rendered.

### JWT audience too broad
**Severity: MEDIUM**
**File:** `backend/src/middleware/auth.ts`

JWT audience validation accepts `account`, which is the Keycloak account management client — too broad. Should validate against the specific API client audience.

### `email` field optional but typed required
**Severity: LOW**
**Files:** `backend/src/types/index.ts`, `backend/src/middleware/user.ts`

Keycloak tokens may omit `email` (e.g., if the user authenticated via passkey without an email). The type system treats it as required, which could cause runtime errors.

### CORS misconfiguration
**Severity: MEDIUM**
**File:** `backend/src/middleware/cors.ts`

Returns `Access-Control-Allow-Origin: *` for requests with no `Origin` header while also setting `credentials: true`. This combination is spec-invalid — browsers reject credentialed requests to wildcard origins. May cause silent auth failures.

## Technical Debt

### DB connection created per-request
**Severity: MEDIUM**
**File:** `backend/src/db/index.ts`

`getDb()` creates a new `Pool` or connection object on each call rather than reusing a singleton. Under load this will exhaust connection limits on the Neon free tier.

**Recommendation:** Export a module-level pool singleton; call `getDb()` once at startup.

### Fake D1 placeholder in `wrangler.toml`
**Severity: LOW**
**File:** `backend/wrangler.toml`

Contains a placeholder D1 binding from early scaffolding. The actual DB is Neon (PostgreSQL via node-postgres), not Cloudflare D1. The stale config is confusing and may cause deploy issues.

### `is_generic` field mismatch
**Severity: LOW**
**File:** `backend/src/db/schema.ts` vs `backend/src/validation/schemas.ts`

`is_generic` exists in the DB schema and queries but is absent from the Zod validation schema. API consumers cannot set it through normal CRUD paths.

### Missing `updated_at` on most tables
**Severity: LOW**
**File:** `backend/src/db/schema.ts`

Only 2 of 6 tables have `updated_at`. Makes auditing and cache invalidation harder.

### Missing DELETE endpoint
**Severity: MEDIUM**
**File:** `backend/src/routes/trips.ts`

A `deleteDay` query exists in `backend/src/db/queries/` but no `DELETE /:tripId/destinations/:destId/days/:dayId` route is registered. The frontend may expose UI for this that silently fails.

## Performance

### N+1 ownership checks in `resolveActivity`
**Severity: LOW**
**File:** `backend/src/routes/trips.ts` (or queries)

`resolveActivity` chains 4 sequential ownership-check queries before any mutation. Should be collapsed into a single joined query.

### `getTripById` does 2 queries when 1 suffices
**Severity: LOW**
**File:** `backend/src/db/queries/`

Fetches trip then relations separately. A single JOIN query would halve round-trips.

## Deployment Gaps

### Backend hosting not confirmed
**Severity: HIGH**

The backend has both Cloudflare Workers config (`wrangler.toml`) and Railway config (`keycloak/railway.toml`), but no confirmed production deploy. The frontend's `VITE_API_URL` silently falls back to `http://localhost:8787` when the env var is unset — production builds will silently hit localhost.

**Recommendation:** Confirm and document the production backend URL; make missing `VITE_API_URL` a build error (not a silent fallback).

### Dual deploy architecture creates split
**Severity: MEDIUM**

Frontend deploys to GitHub Pages (static). Backend needs a separate Node/Workers host. Keycloak needs its own host. The three-service architecture has no documented runbook — it's easy to deploy only one part.

## Test Gaps

### No DB integration tests
E2E tests mock the API layer. No tests verify DB queries against a real (or in-memory) Postgres instance. Migration correctness is unverified by automated tests.

### E2E API tests silently skip offline
**File:** `tests/e2e/api.spec.ts`

Tests skip (rather than fail) when the backend is unreachable. CI passes even if the backend is broken, as long as the frontend serves.

### Overly loose assertions
Multiple tests use `expect(typeof x).toBe('boolean')` or `expect(x).toBe(true)` where `x` is always `true` — the assertions never catch regressions.

### Profile page uncovered
**File:** `frontend/src/pages/profile.ts`, `frontend/profile.html`

New page has zero unit or E2E test coverage.

## Fragile Areas

### Keycloak silent SSO on Safari/iOS
**File:** `frontend/public/silent-check-sso.html`

Silent SSO via hidden iframe is blocked by ITP on Safari. Custom handling exists but was recently fixed (v2.1.0 changelog). Regression risk on iOS updates.

### Static itinerary data tightly coupled
**File:** `frontend/src/data/itinerary.ts`

Static data is hardcoded in TypeScript. The trip dates are hardcoded to Feb-Mar 2026. After the trip, the countdown will show a past date and the data becomes stale. No data management layer.

### Service worker caching strategy
**File:** `frontend/public/sw.js`

PWA service worker caches aggressively. Stale cache during app updates requires user to clear storage or hard reload. No cache-busting strategy documented.
