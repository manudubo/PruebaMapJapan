---
phase: 18
plan: 02
subsystem: e2e-fixtures
tags: [passkeys, keycloak, test-isolation, webauthn]
dependency_graph:
  requires: []
  provides: [resetCredentials clears webauthn-register-passwordless required action]
  affects: [tests/e2e/passkeys.spec.ts]
tech_stack:
  added: []
  patterns: [KC Admin client.users.findOne + client.users.update for required-action mutation]
key_files:
  modified:
    - tests/e2e/fixtures/kc-admin.ts
decisions:
  - "Filter only webauthn-register-passwordless; preserve other required actions to avoid breaking unrelated test flows"
metrics:
  duration: "~10 min"
  completed: "2026-07-06T03:39:15Z"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
---

# Phase 18 Plan 02: Passkeys Fixes (resetCredentials) Summary

**One-liner:** `resetCredentials` now filters `webauthn-register-passwordless` from KC requiredActions after deleting credential records, preventing passkey campaign flow from hijacking subsequent tests.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update resetCredentials to clear webauthn-register-passwordless | 08a48e3 | tests/e2e/fixtures/kc-admin.ts |

## What Changed

`resetCredentials` in `tests/e2e/fixtures/kc-admin.ts` gained three lines after the credential-delete loop:

1. `client.users.findOne({ id })` — re-fetches the live user representation
2. Filter expression removes `webauthn-register-passwordless` while preserving any other required actions
3. `client.users.update({ id }, { requiredActions: filteredActions })` — writes the cleaned list back

The `clearRequiredActions` function (which nukes all required actions) is unchanged and remains available separately.

## Verification

- `npm run typecheck --workspace=frontend` — exit 0
- `npm run typecheck --workspace=backend` — exit 0
- All acceptance criteria confirmed via `rg` pattern checks

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] `tests/e2e/fixtures/kc-admin.ts` modified in worktree
- [x] Commit 08a48e3 exists: `fix(18-02): clear webauthn-register-passwordless after credential reset`
- [x] `webauthn-register-passwordless` appears in 2 places (comment + filter predicate)
- [x] `client.users.findOne` and `client.users.update` both appear inside `resetCredentials`
- [x] `filteredActions` declared and used (2 matches)
- [x] typecheck exits 0 (both workspaces)
