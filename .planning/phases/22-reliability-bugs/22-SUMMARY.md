---
phase: 22-reliability-bugs
subsystem: frontend api client, trip editor, backend user provisioning/OTP/queries
tags: [bugs, reliability, v3.2]
requirements: [BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, BUG-12, BUG-13, BUG-14, BUG-15, BUG-16]
key-files:
  created:
    - frontend/tests/trip-edit-activities.test.ts
    - frontend/tests/geocoder.test.ts
    - backend/src/db/queries/users.test.ts
    - backend/src/db/queries/activities.test.ts
    - backend/src/db/queries/trips.test.ts
    - backend/src/routes/auth-otp-cap.test.ts
  modified:
    - frontend/src/api/client.ts
    - frontend/src/modules/toast.ts
    - frontend/src/pages/trip-edit/activities.ts
    - frontend/src/modules/utils.ts
    - frontend/src/modules/geocoder.ts
    - frontend/src/auth/keycloak.ts
    - backend/src/db/queries/users.ts
    - backend/src/middleware/user.ts
    - backend/src/routes/users.ts
    - backend/src/db/queries/activities.ts
    - backend/src/db/queries/trips.ts
    - backend/src/db/queries/otp.ts
    - backend/src/routes/trips.ts   # reorder catch block + resolve* return types only
    - backend/src/routes/auth.ts    # one cap block in otp-request only
    - backend/src/routes/public.ts
    - SETUP.md
completed: 2026-09-30
---

# Phase 22: Reliability Bugs — Summary

All 16 audit bugs fixed, one focused commit per bug (BUG-03/08 share one
commit because they are the same function; BUG-06/09 share one doc-comment
commit). Each code fix has a test written first and seen failing.

## Per-item result

| ID | Fix | Test |
|----|-----|------|
| BUG-01 | `handleReorder` renumbers `order_index` on the optimistic copy, then adopts the server's `order_index` from the reorder response (skipped if a newer reorder replaced the state); failure still reverts. `reorderActivities()` client now returns `ApiActivity[]`. | `frontend/tests/trip-edit-activities.test.ts` (order survives re-render, full id set sent, server indices adopted, revert on error) |
| BUG-02 | 401 → toast once per page + immediate `login()` redirect (no `setTimeout`), then `throw new ApiError(401,'unauthorized')`. Global `unhandledrejection` handler skips 401 ApiErrors so no double toast. | `client.test.ts` (rejects, toast, immediate redirect, once for concurrent 401s); `toast.test.ts` |
| BUG-03 | `upsertUser`: `INSERT ... ON CONFLICT (keycloak_id) DO NOTHING RETURNING` + re-select on conflict. | `backend/src/db/queries/users.test.ts` (scripted fake); real-SQL check via PGlite (see below) |
| BUG-04 | `getHotel()` returns `ApiHotel \| null`; 404 → `null`, other errors still throw. | `client.test.ts` |
| BUG-05 | `reorderActivities` query loads the day's ids and throws `InvalidActivityOrderError` (no write) unless `ordered_ids` is an exact permutation; route maps it to 400. | `backend/src/db/queries/activities.test.ts`; PGlite |
| BUG-06 | `initKeycloak` JSDoc: tokens live in keycloak-js memory, session restored via SSO cookie / silent check-sso. | doc only |
| BUG-07 | `createElement(tag, className, text)` sets `textContent`; no HTML path exists (only 2 callers, neither needed markup). Markup now requires an explicit sanitize + `innerHTML` at the call site. | `utils.test.ts` |
| BUG-08 | `upsertUser` wired into `ensureUserProvisioned` and `/api/users/me(/trips)` via shared `userClaimsFromJwt`; updates email/name only when a non-empty claim differs (no write on the common path). | `users.test.ts`; PGlite |
| BUG-09 | `getUserInfo()` / `getMe()` JSDoc documents which source to use per use case (JWT for identity + first paint; getMe for app-owned fields and preferred once loaded). | doc only |
| BUG-10 | SETUP.md: `terraform output -raw worker_client_secret`. | doc only |
| BUG-11 | `latInput.value = String(act?.lat ?? '')` (same for lng). | `trip-edit-activities.test.ts` |
| BUG-12 | Removed forbidden `User-Agent` header from Nominatim fetch; comment corrected. | `frontend/tests/geocoder.test.ts` |
| BUG-13 | `resolveDestination`/`resolveDay` got explicit `ResolveError \| {...}` return types so the `'error' in` guard narrows; `as { dest: any; day: any }` removed. | `tsc` (no behaviour change) |
| BUG-14 | `getTripById` is a single `findFirst` (redundant pre-select removed). | `backend/src/db/queries/trips.test.ts`; PGlite |
| BUG-15 | Slug regex is canonical 8-4-4-4-12 UUID, case-insensitive. | `public.test.ts` (36 dashes, no dashes, misplaced dashes, non-hex → 400; upper-case not 400) |
| BUG-16 | `OTP_MAX_PER_HOUR = 5` per user (used + unused codes). `otp-request` returns 429 `{ error: 'otp_rate_limited', retryAfter }` once reached; existing dashboard 429 branch handles `retryAfter`. | `backend/src/routes/auth-otp-cap.test.ts` (pure policy + route with mocked auth/DB); PGlite |

## Test results (at final commit)

- Frontend: `tsc --noEmit` clean; Vitest 12 files / 115 tests pass (was 10 / 101). `vite build` OK.
- Backend: `tsc --noEmit` clean; Vitest 10 files / 63 tests pass (was 6 / 34). `wrangler deploy --dry-run` OK.
- Backend tests still log pre-existing `ECONNREFUSED 127.0.0.1:5432` noise from the public-route
  tests that hit the mock DB URL (ARCH-06); exit code is 0.

### Real-database verification (not committed)

The unit suite has no real DB (ARCH-06, Phase 24), and starting the sandbox's
Postgres 16 cluster was blocked by the agent sandbox. Instead, BUG-03/05/08/14/16
SQL was verified ad hoc against an in-process Postgres (PGlite, installed with
`npm install --no-save`, migrations 0000–0003 applied) using the real query
functions: 3 concurrent `upsertUser` calls → all fulfil, same id, one `created`;
plain `createUser` on an existing id throws (the old bug); email/name refresh;
partial reorder rejected with no write; `getTripById` owner/non-owner/missing;
OTP window counts burned codes and excludes >1h codes. This is a single
connection, so true multi-connection concurrency was not exercised; the
`ON CONFLICT` semantics are what make it safe there.

## Decisions / deviations

- **BUG-02 redirect timing:** redirect now starts immediately (roadmap: "no
  setTimeout-only redirect"), so the toast is only visible until navigation.
  Callers that catch the ApiError may briefly show their own error text before
  the page navigates away.
- **BUG-08 name ownership:** Keycloak is now the source of truth for `name`
  and `email`. `PATCH /api/users/me` can still set `name`, but the next
  authenticated request will reset it to the token's name if they differ. No
  frontend code calls `updateMe()` today; if app-side renaming is ever added,
  this needs a decision.
- **BUG-07:** chose to remove the HTML path entirely rather than add an
  opt-in flag — no caller needs it.
- **Minimal diffs in `trips.ts`/`auth.ts`** (parallel Phase 24/26 work): no
  `dbMiddleware`, date validation, CORS/JWT, or OTP atomicity (SEC-07) changes.
  `GET /api/users/me` still has no `DATABASE_URL` guard / try-catch (M-01/M-09).

## Deferred / follow-ups

- Route-level tests for the BUG-05 400 mapping and BUG-03 on `/api/users/me`
  need either the ARCH-06 real test DB or heavier mocking; covered at the
  query layer for now.
- `createUser` is now unused by app code (kept as a generic query helper).
