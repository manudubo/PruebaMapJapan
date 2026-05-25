---
phase: 08-demo-trip-seed-a-public-demo-trip-in-the-database-add-view-d
plan: "06"
subsystem: auth
tags: [keycloak, passkeys, webauthn, profile, guard]

requires:
  - phase: 07-passkey-login-wire-browser-passkey-keycloak-flow-as-default
    provides: browser-passkey KC flow and profile page passkey management UI

provides:
  - Last-credential guard in openDeleteConfirm() preventing lockout when only one passkey remains
  - credentialCount module-level variable tracking registered passkey count
  - Guard modal swap: Delete hidden, Register button shown with webauthn-register-passwordless AIA

affects:
  - passkey-delete flow
  - profile page UX
  - KC AIA registration path

tech-stack:
  added: []
  patterns:
    - "Guard path: credentialCount === 1 → swap modal action before user commits"
    - "AIA (Action-Required Interaction) for passkey registration via keycloak.login({ action })"
    - "Button cloning pattern for stripping stale event listeners before each modal open"

key-files:
  created: []
  modified:
    - frontend/src/pages/profile.ts

key-decisions:
  - "D-16: credentialCount at module scope, updated from loadPasskeys() fetch response — no extra API call"
  - "D-17: Guard hides Delete button (setAttribute hidden) rather than disabling it — cleaner UX"
  - "D-18: Guard modal body text: 'You must register another passkey on another device before deleting this one.'"
  - "D-19: Guard button calls keycloak.login({ action: 'webauthn-register-passwordless' }) — same AIA as registerPasskey()"

patterns-established:
  - "Pattern: close() resets modal to neutral state — guard cleanup via [data-passkey-guard] selector"
  - "Pattern: buildDeleteModal() early-return guard prevents double DOM insertion on re-init"

requirements-completed:
  - PASS-06

duration: 12min
completed: 2026-05-25
---

# Phase 08 Plan 06: Last-Credential Guard Summary

**Module-level credentialCount variable wired to KC Account API response, with guard path in openDeleteConfirm() that swaps Delete for a webauthn-register-passwordless AIA button when only one passkey remains**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-25T00:00:00Z
- **Completed:** 2026-05-25T00:12:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `let credentialCount = 0` at module level in profile.ts, updated by loadPasskeys() after credential fetch (D-16)
- Guard path in openDeleteConfirm(): when credentialCount === 1, hides Delete button and inserts guard button with `data-passkey-guard` attribute
- Guard button text "Register another passkey first" triggers webauthn-register-passwordless AIA (D-17, D-18, D-19)
- close() resets guard state: removes [data-passkey-guard] element, restores "This action cannot be undone." body text, unhides Delete button
- buildDeleteModal() early-return guard prevents double-build on re-init

## Task Commits

1. **Task 1: Add credentialCount tracking and last-credential guard to profile.ts** - `fa48cf7` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `frontend/src/pages/profile.ts` - Added credentialCount variable, updated loadPasskeys(), guard path in openDeleteConfirm(), reset in close(), double-build guard in buildDeleteModal()

## Decisions Made
- All four decisions (D-16 through D-19) applied as specified in CONTEXT.md locked decisions — no deviation needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Last-credential guard complete; profile.ts compiles cleanly (typecheck exits 0)
- Ready for plan 08-07 (next plan in phase)
- No blockers

---
*Phase: 08-demo-trip-seed-a-public-demo-trip-in-the-database-add-view-d*
*Completed: 2026-05-25*
