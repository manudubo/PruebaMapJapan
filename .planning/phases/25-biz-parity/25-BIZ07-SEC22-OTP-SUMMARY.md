---
phase: 25-biz-parity (+ Phase 26 SEC-22 and SEC-07 follow-up)
items: [BIZ-07, SEC-22, SEC-07-issuance]
base: 752fd6e (Merge backend adversarial QA on shared test harness)
migrations: [0008_date_coherence, 0009_otp_issue_atomic]
completed: 2026-10-03
---

# BIZ-07, SEC-22, atomic OTP issuance — Summary

The three backend items left open after Phases 24–26. All were done test first, on real
Postgres 16 through the shared ARCH-06 harness. The three `it.fails` in
`backend/tests/adversarial` are now normal tests. Each was re-run against the old code
and failed there for the documented reason.

## Commits

| Commit | What |
|---|---|
| `ea1f511` | SEC-22: foreign resources answer 404 on every nested route |
| `6943edd` | BIZ-07: date-coherence triggers (migration 0008) and the 422 `date_conflict` mapping |
| `5e4c537` | BIZ-07 frontend: the day editor shows the API's 422 reason, and "Generate all days" keeps partial successes |
| `6f7990f` | Atomic OTP issuance (migration 0009, `issueOtp`) |
| `53e4a11` | Fix: a same-subject race on first login is no longer reported as an email conflict (the flaky BUG-03 adversarial test) |
| `3239c24` | BIZ-07: per-trip lock changed from a row lock to an advisory lock (the row lock could deadlock with a trip delete) |
| `d8477f8` | Fix: a PATCH whose target is deleted mid-request now answers 404 instead of 500 |

---

## SEC-22: no existence oracle on nested routes

**Change.** `resolveChain` (`db/queries/ownership.ts`) now matches the trip on `(id, user_id)`
together, and `OwnershipError` has no `'forbidden'` outcome. All 16 `403 Forbidden` branches
are gone from `routes/trips.ts`: 14 resolver branches, plus the inline trip-ownership SELECTs in
list/create destinations, which now go through `resolveTrip`.

**Behaviour changes**
- A foreign trip, destination, day, activity or hotel answers **404**. The body is identical to
  the body for an id that does not exist ("Trip not found" / "Destination not found" / "Day not
  found" / "Activity not found").
- 401 for unauthenticated requests is unchanged; `authMiddleware` decides it before any lookup.
- Public slug routes are unaffected, because they do not use the resolvers (`public.test.ts`
  still passes).

**Tests**
- ARCH-03 matrix (`routes/trips.test.ts`): on all 16 nested endpoints, a foreign request returns
  404 with a body equal to the response for a missing trip, and the DB is unchanged. The same
  holds for a foreign trip combined with non-existent child ids. The concurrent owner/intruder
  test now expects 404.
- `ownership.test.ts`: every resolver returns `not_found` for a foreign trip, with real or bogus
  child ids.
- Adversarial `idor.test.ts`: the former `it.fails` is now a normal test. For each of the 19
  attack routes, the foreign request and a "ghost" request (same route, ids that do not exist)
  return byte-identical bodies and the same `content-length`. Bob's trip combined with Alice's
  child ids answers like missing child ids. Every route still returns 401 without a token.

---

## BIZ-07: cross-level date coherence

**Rules.** All rules are null-safe: a missing date on either side never constrains anything.
- Every non-null destination date lies within the trip's non-null bounds.
- A day's date lies within its destination's non-null bounds.
- Two **fully dated** destinations of one trip may not overlap: `a.start < b.end AND b.start <
  a.end` counts as an overlap. Touching ranges (end = next start) are allowed. A single-day
  destination on a boundary day is also allowed.
- `start <= end` also holds for a PATCH that sends only one date. That date is compared with
  the stored other one, which closes the gap Phase 25 flagged.

**Decision: shrinking a parent is rejected.** A trip or destination date change that would
leave a child outside answers **422** with a message that names the child, for example:
`The trip dates (2026-03-01 to 2026-03-07) would leave destination "Osaka" (2026-03-06 to
2026-03-09) outside the trip. Change or remove that destination first.` or `… would leave 3
days outside the range (2026-03-01 … 2026-03-05). Move or delete those days first.` Nothing is
cascaded or clamped. Clearing the parent's dates (null) is always allowed.

**Where it is enforced.** The rules are enforced by `BEFORE INSERT/UPDATE` triggers in migration
0008, not by route pre-checks. Production uses the Neon **HTTP** driver, which has no
interactive transactions, so a route cannot hold a lock between its check and its write. Each
trigger runs inside the writing statement and locks before it reads:
- A day write takes `FOR SHARE` on its destination row. A destination UPDATE already holds that
  row, so the two serialize.
- A destination write takes `pg_advisory_xact_lock(7002, trip_id)`. A trip date UPDATE takes the
  same lock. This serializes sibling destinations of one trip and trip date edits.
- After a lock wait, the next query in the plpgsql function gets a fresh READ COMMITTED snapshot
  and sees what the other transaction committed.
- The per-trip lock was first a row lock on the trip. That deadlocked against a trip DELETE
  (40P01 → 500), which a race test reproduced (`3239c24`).

The triggers raise SQLSTATE `DC001` with a user-facing message and `COLUMN` set to the offending
field. `middleware/errors.ts` maps this to **422**
`{ success:false, code:'date_conflict', error, issues:[{ path, message }] }`. This is the same
shape as validation errors, so the existing `saveErrorMessage` in the editor forms shows it. The
`path` is the column the PATCH changed when exactly one date changed. Otherwise it is the bound
that is out of range. Days always use `date`.

The triggers fire only when a date column (or the parent key) is written. As a result:
- Legacy incoherent rows stay renamable and reorderable. Changing `order_index` or `city_name`
  does not re-check dates.
- The migration validates no existing data and never fails on it (tested).
- Direct SQL and `seed.ts` are covered too. The seed runs clean, because its demo itinerary is
  coherent.

**Frontend (minimal).**
- The day modal shows the API's 422 text instead of "Check your connection".
- "Generate all days" uses `allSettled`. Days the server created are kept and rendered. The
  error reads "Could not generate N of M days." followed by the API reason (422) or "Please try
  again." (network). Before, one rejection discarded the days that had already been created, and
  a retry duplicated them.
- The destination and trip forms already used `saveErrorMessage`.

**Tests**
- `routes/trips-date-coherence.test.ts`, 61 tests:
  - Inclusive bounds; one day before or after; partial-date destinations and trips; leap day and
    year boundary.
  - PATCH that moves a day; PATCH that sends only `end_date` or only `start_date`, for both
    destination and trip; shrinking to fit vs orphaning; clearing dates; delete then shrink.
  - Overlap matrix: touching at start or end, single day on a boundary, undated, start-only,
    overlapping end or start, identical, nested, enclosing, single day inside, another trip or
    another user, PATCH into a sibling, self re-send, dating an undated destination.
  - Legacy rows: rename, reorder, then a date write is checked.
  - Error body: exact keys, no SQL leak, quotes and unicode in the city name.
  - Concurrency:
    - 20 identical creates → exactly 1 succeeds.
    - 30 mixed creates → no overlap.
    - Forced interleavings with side transactions in every direction: an uncommitted sibling
      destination, an uncommitted day vs a shrink, an uncommitted shrink vs a day, an uncommitted
      destination vs a trip shrink, an uncommitted trip shrink vs a destination create.
    - A rolled-back conflicting write does not block.
    - A trip row lock does not block a destination date edit (deadlock guard).
    - Trip delete races destination edits.
    - PATCH of a destination, day or activity whose trip is deleted mid-request → 404.
    - Repeated shrink vs day-create rounds always end with no rule violated, checked by a SQL
      invariant query.
- `db/migrations.test.ts`: 0008 applies over incoherent legacy data, keeps every row, still
  allows non-date updates, enforces the rules on direct SQL, and creates all three triggers.
- Adversarial:
  - `input-fuzz`: the BIZ-07 `it.fails` is now a normal test that asserts `date_conflict`, the
    issue path and message, and that nothing was written. New cases: non-leap Feb 29,
    9999-12-31 and 0001-01-01 days return 422 and never 500; a single-date PATCH is rejected.
  - `concurrency`: 100 parallel day creates interleaved with destination shrinks and extends;
    4 users × 25 identical-range creates (exactly 1 per trip); a trip shrink racing 20
    destination creates. All end with the invariant query empty.
- Frontend (`trip-edit-days.test.ts`): partial success keeps the created days and shows
  "2 of 5" plus the API reason; all rejected shows the 422 reason with the button re-enabled; a
  network error gives the generic text; the day modal shows the 422 reason for a 422 and the
  connection text for a network error. These 4 tests fail on the old code.

**Not covered (follow-ups)**
- A day in an **undated** destination is not checked against the trip's range. The rules are
  strictly parent → child.
- Hotel check-in/out vs destination dates is not part of BIZ-07 and is not enforced.
- Same-day duplicate days are still allowed, as before.

---

## Atomic OTP request (SEC-07 follow-up)

**Change.**
- Migration 0009 adds `otp_issue(user_id, code_hash, ttl_s, max_per_window, window_s)`. It takes
  `pg_advisory_xact_lock(7001, user_id)`, reads `clock_timestamp()`, and then, in order, checks
  for a pending code (unused and unexpired), checks the hourly cap (every code created in the
  window: used, burned or expired), and INSERTs. It returns `(status, otp_id, retry_after)`.
- `issueOtp()` calls it as **one statement**, so this also holds on the Neon HTTP driver. Only
  the same user ever waits.
- `routes/auth.ts` order is unchanged:
  1. SEC-08 transport gate.
  2. DATA-01 best-effort cleanup.
  3. Generate the code and hash it.
  4. `issueOtp`: answers `429 { error: 'otp_pending' | 'otp_rate_limited', retryAfter }`.
  5. Send the email. On failure the code is burned (`markOtpUsed`) and the request answers 500.
- The cap arithmetic moved from TS to SQL. `otpHourlyCapRetryAfter`, `getOtpCreatedAtsSince` and
  the now-unused `insertOtp` were removed. `getLatestUnexpiredOtp` stays (used by verify).

**Behaviour changes**
- `created_at`, `expires_at` and both `retryAfter` values come from the DB clock. Before, the
  pending check and the cap used the Worker clock and `expires_at` was computed in JS.
- `retryAfter` for `otp_pending` is now at least 1.
- A new SQL function exists in the schema (no table change; `drizzle-kit generate` reports no
  drift).

**Tests**
- `db/queries/otp-issue.test.ts`, 18 tests on real Postgres:
  - TTL and hash stored.
  - Pending → retryAfter close to the remaining time.
  - Expired or used codes are not pending.
  - 4 codes in the window → issued; 5 → rate-limited with retryAfter close to 600 s.
  - Used and expired codes count toward the cap; codes older than 1 h do not.
  - Window edge → retryAfter 1.
  - Pending is reported before the cap.
  - Per-user isolation.
  - Burn after a failed send → can retry.
  - Unknown user → FK error, nothing inserted.
  - 50 parallel for one user → 1 code; 100 parallel across 10 users → 1 code each.
  - Burst-and-burn rounds issue `[1, 1, 0, 0]` codes, so never more than 5 per hour.
  - Racing the stale-code cleanup.
  - Forced with side transactions: a held lock for user A blocks only A; a code committed by
    another transaction is seen after the lock.
- Route mocks (`auth-otp-cap`, `auth-otp-verify` in-memory store, `otp-email`) now stub
  `issueOtp`. The HTTP contract is kept: 429 shapes, no email on refusal, the HMAC (never the raw
  code) is passed, cleanup failure does not block.
- Adversarial `otp.test.ts`:
  - The SEC-07 issuance `it.fails` is now a normal test: 20 forced-parallel requests → one 201,
    19 `otp_pending`, one row, one email.
  - New: 100 parallel requests for one user → one code and one email.
  - New: 5 users × 20 interleaved requests → exactly one code each.
  - New: 8 rounds of 15 parallel requests plus burn → exactly 5 codes and 5 emails, then
    `otp_rate_limited`.
  - New: 20 correct verifies interleaved with 20 requests → no 500, at most 1 verified, at most 1
    new code, at most 1 live code.
  - New: a mail outage during a burst → every issued code is burned, and the next burst issues
    exactly one.
  - 5 of these fail on the old code.

---

## Extra fixes found by the new tests

- **Flaky BUG-03 adversarial test** (`53e4a11`). 25 simultaneous first requests of a new user
  sometimes got **409 "Email already belongs to another account"**. The DATA-02 email index is
  not the `ON CONFLICT (keycloak_id)` arbiter, so a request that passed the pre-check just before
  a sibling inserted the row then violated the email index. `upsertUser` now looks the subject
  up again before raising `EmailConflictError`. Tested with a deterministic stubbed-insert test
  and a 20 × 10 stress test. Different subjects racing for one email are still a conflict.
- **PATCH target deleted mid-request → 500** (`d8477f8`). `updateDestination`, `updateDay` and
  `updateActivity` threw on 0 rows. They now return `undefined`, and the routes answer 404, as
  `updateTrip` already did.

## Results (final commit)

| Check | Result |
|---|---|
| `npm run typecheck` backend + `tsc -p tests/adversarial` + frontend | clean |
| `npm test --workspace=backend` (real PG 16.13), 3 consecutive runs | 41 files / 1482 tests, all pass ×3 |
| `npm run test:run --workspace=frontend` (default TZ and `America/Argentina/Buenos_Aires`) | 33 files / 762 tests, both pass |
| `npm run build --workspace=frontend` | OK |
| `wrangler deploy --dry-run` | OK (`ENVIRONMENT`, `DB_DRIVER` vars) |
| `drizzle-kit generate` | no schema drift |
| `drizzle-kit migrate` + `seed.ts` on a fresh DB | OK (30 days seeded under the triggers) |

The adversarial `concurrency.test.ts` was also run 6 more times on its own after the BUG-03 fix,
and passed every time.

## Notes for consolidation

- Deploying requires `drizzle-kit migrate` (0008, 0009) **before** the new Worker. The new
  `otp-request` calls `otp_issue()`, which does not exist until 0009 has run.
- Advisory lock namespaces in use: 7001 (OTP, per user) and 7002 (BIZ-07, per trip).
- The QA report (`.planning/qa/QA-BACKEND-REPORT.md`) still lists these three as open `it.fails`.
  It and the ROADMAP/REQUIREMENTS checkboxes were left for the consolidator, as instructed.
