---
phase: 14-e2e-expansion-new-user-parity
plan: "04"
subsystem: e2e-tests
tags: [playwright, e2e, new-user, trip-creation, geocoder, leaflet]
dependency_graph:
  requires:
    - "14-01 (empty-state-create-btn in dashboard.ts)"
    - "14-03 (kcLoginNewUser() + .auth/new-user.json)"
  provides:
    - "tests/e2e/new-user-trip-creation.spec.ts"
  affects: []
tech_stack:
  added: []
  patterns:
    - "Serial Playwright describe with storageState override"
    - "sessionStorage replay via addInitScript (Playwright bug #31108)"
    - "Token extraction from Authorization header (waitForRequest)"
    - "Nominatim mock via page.route()"
    - "API-based trip create/delete for deterministic test lifecycle"
key_files:
  created:
    - tests/e2e/new-user-trip-creation.spec.ts
  modified: []
decisions:
  - "Used button:has-text() text selectors for dynamically created buttons (Add day, Add hotel, Add activity) — none have IDs in the source"
  - "Fixed Add day step to include modal interaction (#day-modal-overlay + #day-date + #day-save-btn) because openModal() is not a POST — it opens a form"
  - "Nominatim page.route() registered at start of test before any navigation to intercept all geocoder calls"
metrics:
  duration: ~20 min
  completed: "2026-06-08T00:00:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 14 Plan 04: New-User Trip Creation E2E Spec Summary

**One-liner:** Serial Playwright spec covering the full new-user journey from empty dashboard CTA through trip create, destination/hotel/day/activity via Nominatim geocoder, Leaflet map markers + popup, global search, metadata edit, and delete.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1+2 | Scaffold + full test body | c3275fb | tests/e2e/new-user-trip-creation.spec.ts |

## What Was Built

`tests/e2e/new-user-trip-creation.spec.ts` — a serial Playwright spec using `new_user_test` credentials:

- **File-level setup:** `test.describe.configure({ mode: 'serial' })` + `test.use({ storageState: .auth/new-user.json })` + sessionStorage replay via `addInitScript` (Playwright bug #31108)
- **beforeAll:** Unconditional cleanup — deletes all existing trips for `new_user_test` using token from Authorization header
- **afterAll:** Safety net — deletes `capturedTripId` if still set (catches crashed runs)
- **getToken helper:** Captures Bearer token from first `/api/` request Authorization header; never calls `page.evaluate(() => kc.token)` which would throw ReferenceError (keycloak is a module-private ES export)
- **createTrip helper:** API POST via `page.evaluate` (same pattern as `trip-edit-integration.spec.ts`)

**Test NU-01 flow (11 steps):**

1. Register Nominatim mock via `page.route()` before any navigation
2. Assert `#empty-state-create-btn` visible on empty dashboard
3. Re-capture token + create trip via API
4. Navigate to trip-edit; add destination with geocoder (`#dest-geocoder-btn`)
5. Add hotel with geocoder (`#hotel-geocoder-btn`)
6. Add day via modal (`button:has-text("Add day")` → `#day-modal-overlay` → `#day-date` → `#day-save-btn`)
7. Add activity with geocoder (`button:has-text("Add activity")` → `#act-modal-overlay` → `#act-geocoder-btn`)
8. Navigate to `trip.html`; assert `.leaflet-container` visible, `.leaflet-marker-pane .custom-marker` not empty, popup contains activity name
9. Global search on dashboard finds "New User Test Trip" without reload
10. Edit trip metadata via `#trip-name` + `#metadata-save-btn` (PATCH 200)
11. Delete trip via API; set `capturedTripId = null`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Step 6 (Add day): plan used non-existent `#add-day-btn` and skipped the day modal**

- **Found during:** Task 2 implementation, cross-checking `days.ts`
- **Issue:** The plan prescribed `page.click('#add-day-btn')` followed immediately by `waitForResponse(/days POST)`. Two problems: (a) `days.ts:388` creates the button with `textContent = 'Add day'` and no `id` attribute; (b) clicking "Add day" calls `openModal(null)` which opens a day modal form — it does NOT POST. The modal requires filling `#day-date` (required field) and clicking `#day-save-btn` before the POST fires. The prescribed code would time out waiting for a response that never arrives.
- **Fix:** Replaced `page.click('#add-day-btn')` with `page.locator('button:has-text("Add day")').first().click()` + `waitForSelector('#day-modal-overlay:not([hidden])')` + `page.fill('#day-date', '2026-08-01')` + `page.click('#day-save-btn')` + then `waitForResponse`.
- **Files modified:** tests/e2e/new-user-trip-creation.spec.ts
- **Commit:** c3275fb

**2. [Rule 1 - Bug] Removed kc.token from comment to satisfy acceptance criterion**

- **Found during:** Acceptance verification
- **Issue:** The plan's prescribed scaffold included a comment `// IMPORTANT: Do NOT use page.evaluate(() => kc.token).` The acceptance criterion requires `rg "kc\.token"` returns NO match. The comment and criterion contradict each other.
- **Fix:** Reworded the comment to preserve the intent without the forbidden literal.
- **Commit:** c3275fb

## Known Stubs

None — this is a test file; no production data flows.

## Threat Flags

None — spec introduces no new network endpoints, API paths, or schema changes. All threats in the plan's threat model are accepted (local test KC only; gitignored `.auth/` files; deterministic mock).

## Self-Check

- [x] `tests/e2e/new-user-trip-creation.spec.ts` exists at c3275fb
- [x] `npx playwright test --list` exits 0 with 1 test listed
- [x] `npx tsc -p frontend/tsconfig.json --noEmit` exits 0
- [x] `rg "describe.configure.*serial"` matches (top-level, outside describe)
- [x] `rg "new-user\.json"` matches in test.use()
- [x] `rg "new-user-session\.json"` matches
- [x] `rg "addInitScript"` matches in beforeEach + beforeAll + afterAll
- [x] `rg "waitForRequest"` matches in getToken helper
- [x] `rg "kc\.token"` returns NO match
- [x] `rg "grant_type"` returns NO match
- [x] `rg "empty-state-create-btn"` matches in expect assertion
- [x] `rg "nominatim.openstreetmap.org"` matches in page.route()
- [x] `rg "dest-geocoder-btn|hotel-geocoder-btn|act-geocoder-btn"` all match
- [x] `rg "leaflet-container|custom-marker|leaflet-popup-content"` all match
- [x] `rg "New User Test Trip"` matches in search assertion

## Self-Check: PASSED
