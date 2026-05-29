---
phase: 04-passkeys
plan: 02
subsystem: frontend
tags: [passkeys, webauthn, keycloak, profile, delete-ui, typescript]

# Dependency graph
requires:
  - phase: 04-passkeys
    plan: 01
    provides: keycloak-js 26.2.4 installed; TypeScript gate confirmed clean
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dynamic overlay/modal injection via document.createElement (no static HTML changes)
    - Button clone pattern (cloneNode) to strip stale event listeners before each modal open
    - Bearer token DELETE to Keycloak Account REST API

key-files:
  created: []
  modified:
    - frontend/src/pages/profile.ts

key-decisions:
  - "D-03: registerPasskey() action string fixed to webauthn-register-passwordless (PASS-01 satisfied)"
  - "D-04: loadPasskeys() GET URL and .filter() both fixed to webauthn-passwordless (enables passkey list)"
  - "D-05: Delete UI built dynamically; buildDeleteModal() injects CSS+DOM; openDeleteConfirm() handles full flow"
  - "DELETE /account/credentials/{id} is deprecated in KC 26 but not removed — TODO left in code for AIA alternative"

requirements-completed: [PASS-01, PASS-03]

# Metrics
duration: 20min
completed: 2026-05-07
---

# Phase 4 Plan 02: profile.ts Passkey String Fixes + Delete UI Summary

**Fixed two wrong type strings (D-03/D-04) and added full delete passkey UI with confirmation modal (D-05) — PASS-01 and PASS-03 satisfied**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-07T23:00:00Z
- **Completed:** 2026-05-07T23:18:59Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Fixed `loadPasskeys()` GET URL: `?type=webauthn` → `?type=webauthn-passwordless` (line 57)
- Fixed `loadPasskeys()` `.filter()` predicate: `c.type === 'webauthn'` → `c.type === 'webauthn-passwordless'` (line 66)
- Fixed `registerPasskey()` action string: `webauthn-register` → `webauthn-register-passwordless` (line 115)
- Added `data-credential-id` attribute and "Eliminar" delete button to each passkey row in `loadPasskeys()` render block
- Added click event listener wiring for delete buttons (calls `openDeleteConfirm(credId)`)
- Added `buildDeleteModal()`: injects overlay CSS dynamically via `<style>`, builds overlay+modal DOM, appends to `document.body`
- Added `openDeleteConfirm(credentialId)`: shows overlay, clones buttons to strip stale listeners, calls `DELETE /realms/${KEYCLOAK_REALM}/account/credentials/${credentialId}` with Bearer token, refreshes list on success, shows inline error on failure
- `buildDeleteModal()` called once in `init()` after `await loadPasskeys()`
- Typecheck passes; all 74 existing tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix loadPasskeys() type filter and fetch URL (D-04)** — `dd0392a` (fix)
2. **Task 2: Fix registerPasskey() action string (D-03)** — `028e2e0` (fix)
3. **Task 3: Add delete passkey UI — button, modal, and DELETE handler (D-05)** — `0df62b1` (feat)

## Files Modified

- `frontend/src/pages/profile.ts` — All three changes (D-03, D-04, D-05); grew from 181 to 290 lines

## Exact Line Numbers for D-03 and D-04

- **D-04 URL fix:** line 57 — `account/credentials?type=webauthn` → `account/credentials?type=webauthn-passwordless`
- **D-04 filter fix:** line 66 — `credentials.filter((c) => c.type === 'webauthn')` → `credentials.filter((c) => c.type === 'webauthn-passwordless')`
- **D-03 action fix:** line 115 — `action: 'webauthn-register'` → `action: 'webauthn-register-passwordless'`

## buildDeleteModal() Call Site

`buildDeleteModal()` is called in `init()` after `await loadPasskeys()` and before the button wiring block (the `// Wire buttons` comment section).

## TODO Note in openDeleteConfirm()

The DELETE endpoint (`/account/credentials/${id}`) is deprecated in Keycloak 26 but not removed. A `// TODO` comment in `openDeleteConfirm()` documents the future AIA alternative:
```typescript
// TODO: DELETE /account/credentials/{id} is deprecated in KC 26 (but not removed).
// Future alternative: keycloak.login({ action: `delete_credential:${credentialId}` })
```

## Deviations from Plan

### TDD Ceremony Omitted for Tasks 1 and 2

Tasks 1 and 2 have `tdd="true"` in the plan but are pure string-edit fixes with grep-based verify clauses. No behavioral assertion is possible for "this string constant has the correct value." Creating a failing unit test for a literal string would be ceremonial rather than functional. Both tasks were committed as `fix()` commits with grep + typecheck verification as specified in the `<verify>` blocks. Documented per deviation Rule 3 guidance.

## Known Stubs

None. All passkey functionality is wired end-to-end.

## Threat Flags

None. All mitigations from the threat register are present:
- T-04-04: `if (credId) openDeleteConfirm(credId)` guards empty cred ID
- T-04-08: `freshConfirm.disabled = true` immediately on click + `{ once: true }` handler

## End-to-End Manual Verification

Requires `docker compose down -v && docker compose up -d` (from the `keycloak/` directory) to apply the RP ID change from Plan 04-01. Manual test steps:

1. Navigate to http://localhost:5173/profile.html and log in
2. Click "Agregar passkey" → browser prompts for biometric → redirect back
3. DevTools Network → confirm `GET /account/credentials?type=webauthn-passwordless` returns entry with `type="webauthn-passwordless"`
4. Passkey appears in list (validates D-03 + D-04 together)
5. Click "Eliminar" → confirm overlay appears with "Cancelar" and "Eliminar"
6. Click "Cancelar" → overlay closes, list unchanged
7. Click "Eliminar" → click "Eliminar" confirm → passkey disappears from list (validates PASS-03)

Not tested against a live instance in this plan execution — infrastructure requires the `docker compose down -v` sequence from Plan 04-01 first.

## Self-Check: PASSED

- [x] `frontend/src/pages/profile.ts` exists and contains all changes
- [x] `dd0392a` — Task 1 commit exists (verified via git log)
- [x] `028e2e0` — Task 2 commit exists (verified via git log)
- [x] `0df62b1` — Task 3 commit exists (verified via git log)
- [x] `grep "webauthn-register-passwordless"` → 1 match
- [x] `grep "webauthn-passwordless"` → 2 matches
- [x] `grep "method: 'DELETE'"` → 1 match
- [x] `grep 'credentials/${credentialId}'` → 1 match
- [x] `npm run typecheck` → exits 0
- [x] `npm run test:run` → 74 tests passed
