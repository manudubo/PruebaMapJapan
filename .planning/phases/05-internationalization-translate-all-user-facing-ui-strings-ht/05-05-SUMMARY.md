---
phase: 05-internationalization-translate-all-user-facing-ui-strings-ht
plan: "05"
subsystem: frontend/passkeys
tags: [i18n, profile, passkeys, playwright]
dependency_graph:
  requires: [05-01]
  provides: [translated-profile-ts, updated-uat-passkeys-spec]
  affects: [uat-passkeys.spec.ts]
tech_stack:
  added: []
  patterns: [innerHTML-string-replacement, toLocaleDateString-locale-swap]
key_files:
  created: []
  modified:
    - frontend/src/pages/profile.ts
    - uat-passkeys.spec.ts
decisions:
  - Both files committed atomically to prevent uat-passkeys.spec.ts diverging from profile.ts strings
metrics:
  duration: "3min"
  completed: "2026-05-12"
  tasks: 1
  files: 2
requirements: [I18N-TS, I18N-LOCALE, I18N-PASSKEY]
---

# Phase 05 Plan 05: Translate profile.ts and update UAT spec Summary

**One-liner:** All Spanish UI strings in profile.ts translated to English with en-US locale, and the coupled uat-passkeys.spec.ts assertions updated atomically.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Translate profile.ts and update uat-passkeys.spec.ts | ad2a6fb | frontend/src/pages/profile.ts, uat-passkeys.spec.ts |

## What Was Done

### Task 1: Translate profile.ts and update uat-passkeys.spec.ts

Applied all Spanish-to-English string replacements in `frontend/src/pages/profile.ts`:

- Line 78 empty state: `No tenés passkeys registrados todavía.` → `You don't have any passkeys registered yet.`
- Lines 86-89 locale: `'es-ES'` → `'en-US'`
- Line 96 meta span: `Registrado: ${created}` → `Registered: ${created}`
- Line 99 delete button: `Eliminar` → `Delete`
- Line 113 error state: `No se pudo cargar la lista de passkeys.` → `Could not load passkey list.`
- Line 127 register error: `Error al iniciar el registro de passkey.` → `Error starting passkey registration.`
- Lines 160-165 modal: `¿Eliminar passkey?` / `Esta acción no se puede deshacer.` / `Cancelar` / `Eliminar` → `Delete passkey?` / `This action cannot be undone.` / `Cancel` / `Delete`
- Line 199 in-progress: `Eliminando…` → `Deleting…`
- Line 205 restore: `Eliminar` → `Delete`

Updated `uat-passkeys.spec.ts`:
- Line 108 toContain assertion: `'No tenés passkeys'` → `"You don't have any passkeys"`
- Line 185 waitForFunction textContent check: `'No tenés passkeys'` → `"You don't have any passkeys"`
- Line 189 toContain assertion: `'No tenés passkeys'` → `"You don't have any passkeys"`

## Deviations from Plan

**Additional Spanish assertions found at lines 185/189:** The plan specified checking lines 185/189 for additional Spanish assertions — both contained `'No tenés passkeys'` in a `waitForFunction` and a `toContain` call. These were translated alongside line 108 as part of the same task. Tracked as auto-fix (completeness, not a deviation from intent).

## Verification

- `rg "[áéíóúñ¿¡]" frontend/src/pages/profile.ts uat-passkeys.spec.ts` — zero matches
- `rg "es-ES" frontend/src/pages/profile.ts` — zero matches

## Known Stubs

None.

## Threat Flags

None — string-only edits, no auth or security surface changes.

## Self-Check: PASSED

- frontend/src/pages/profile.ts — modified and committed at ad2a6fb
- uat-passkeys.spec.ts — modified and committed at ad2a6fb
- No Spanish accent characters remain in either file
- Locale changed from es-ES to en-US
