---
phase: 2
slug: trip-builder
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-02
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright ^1.48.0 (E2E) + Vitest (backend unit) |
| **Config file** | `tests/playwright.config.ts` |
| **Quick run command** | `cd tests && npx playwright test --grep "@smoke" --project=chromium` |
| **Full suite command** | `cd tests && npx playwright test` |
| **Estimated runtime** | ~60 seconds (smoke), ~180 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `cd tests && npx playwright test --grep "@smoke" --project=chromium`
- **After every plan wave:** Run `cd tests && npx playwright test --project=chromium`
- **Before `/gsd-verify-work`:** Full suite must be green (`cd tests && npx playwright test`)
- **Max feedback latency:** 60 seconds (smoke)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-migration | — | 0 | TRIP-08 | — | Migration SQL contains only ALTER TABLE, no CREATE TABLE | manual + schema check | `cd backend && npm run db:generate && cat src/db/migrations/0001*.sql` | ❌ W0 | ⬜ pending |
| 2-backend-schema | — | 0 | TRIP-08 | T-V5 | Zod rejects `--marker-N` for color_hex (422) | API unit | `cd backend && npm test` | ✅ exists | ⬜ pending |
| 2-backend-delete-day | — | 0 | TRIP-05 | T-V4 | DELETE day rejects other user's trip (403) | API unit | `cd backend && npm test` | ✅ exists | ⬜ pending |
| 2-backend-delete-hotel | — | 0 | TRIP-04 | T-V4 | DELETE hotel rejects other user's trip (403) | API unit | `cd backend && npm test` | ✅ exists | ⬜ pending |
| 2-client-gaps | — | 0 | TRIP-03..06 | — | N/A | type-check | `cd frontend && npx tsc --noEmit` | ✅ exists | ⬜ pending |
| 2-wave0-stubs | — | 0 | ALL | — | Test stubs compile | E2E stub | `cd tests && npx playwright test --grep "@smoke"` | ❌ W0 | ⬜ pending |
| 2-trip-edit-html | — | 1 | TRIP-01 | T-V2 | Auth guard redirects unauthenticated user | E2E | `playwright test --grep "TRIP-01"` | ❌ W0 | ⬜ pending |
| 2-trip-metadata | — | 1 | TRIP-02, SHARE-01 | T-V5 | PATCH /api/trips/:id receives sanitized fields only | E2E | `playwright test --grep "TRIP-02"` | ❌ W0 | ⬜ pending |
| 2-dest-crud | — | 2 | TRIP-03 | T-V4 | Destination modal sends correct POST/PATCH/DELETE | E2E | `playwright test --grep "TRIP-03"` | ❌ W0 | ⬜ pending |
| 2-geocoder | — | 2 | TRIP-07 | — | Nominatim mocked results appear; Maps URL parses lat/lng | E2E | `playwright test --grep "TRIP-07"` | ❌ W0 | ⬜ pending |
| 2-hotel-crud | — | 2 | TRIP-04 | T-V4 | Hotel modal PUT/DELETE; hotel.url validated as URL | E2E | `playwright test --grep "TRIP-04"` | ❌ W0 | ⬜ pending |
| 2-day-crud | — | 2 | TRIP-05 | T-V5 | Day modal sends resolved hex (not --marker-N); smart merge skips existing | E2E | `playwright test --grep "TRIP-05"` | ❌ W0 | ⬜ pending |
| 2-activity-crud | — | 2 | TRIP-06 | T-V4 | Activity CRUD + reorder POST sends ordered_ids array | E2E | `playwright test --grep "TRIP-06"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/trip-edit.spec.ts` — stubs for TRIP-01 through TRIP-06, SHARE-01 (all tagged `@smoke`)
- [ ] `tests/e2e/geocoder.spec.ts` — stubs for TRIP-07 (Nominatim mock + Google Maps URL parsing)
- [ ] Backend: missing DELETE route for days and DELETE route for hotel — must exist before frontend waves
- [ ] Backend: `activities.time` and `hotels.url` columns migrated — schema valid before any frontend build

*Existing infrastructure:* `tests/playwright.config.ts`, `tests/e2e/api.spec.ts`, `backend` Vitest suite — cover all new tests.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration produces only ALTER TABLE (no CREATE TABLE) | TRIP-08 | Drizzle meta/ absent — generated SQL must be inspected before applying | 1. `cd backend && npm run db:generate` 2. `cat src/db/migrations/0001*.sql` — confirm only `ALTER TABLE activities ADD COLUMN time text` and `ALTER TABLE hotels ADD COLUMN url text` 3. Then `npm run db:migrate` |
| `\d activities` shows `time` column nullable | TRIP-08 | DB schema verification requires psql access | `psql $DATABASE_URL -c "\d activities"` — confirm `time | text | nullable` |
| Nominatim returns results in browser (live API check) | TRIP-07 | Rate-limited public API — cannot hit in automated CI | Open trip-edit page, type "Tokyo" in geocoder, click "Buscar lugar" — confirm results list appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
