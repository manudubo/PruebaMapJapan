---
phase: 05-internationalization-translate-all-user-facing-ui-strings-ht
plan: "02"
subsystem: frontend-html
tags: [i18n, html, translation]
dependency_graph:
  requires: [05-01]
  provides: [translated-html-pages]
  affects: [frontend/dashboard.html, frontend/profile.html, frontend/index.html]
tech_stack:
  added: []
  patterns: [static-html-string-replacement]
key_files:
  created: []
  modified:
    - frontend/dashboard.html
    - frontend/profile.html
decisions:
  - "Translated 'Cerrar sesión' to 'Sign out' (not 'Log out') for consistency with modern UI conventions"
  - "Translated 'Sesión' section heading to 'Session' rather than omitting it"
  - "Passkeys description translated in full including fingerprint/Face ID/security key terminology"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-13"
  tasks_completed: 1
  files_modified: 2
---

# Phase 05 Plan 02: Translate dashboard.html and profile.html Summary

HTML pages dashboard.html and profile.html translated from Spanish to English — lang attributes, meta descriptions, titles, all visible text nodes, form labels, placeholders, and button text.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 2 | Translate dashboard.html and profile.html | fc2ac35 | frontend/dashboard.html, frontend/profile.html |

Note: Task 1 (index.html) was already complete before this plan executed (verified via `rg "[áéíóúñ¿¡]" frontend/index.html` returning zero matches).

## Changes Made

### frontend/dashboard.html
- `lang="es"` → `lang="en"`
- meta description translated
- `<title>Mis viajes</title>` → `<title>My Trips</title>`
- Skip link: "Saltar al contenido principal" → "Skip to main content"
- H1 "Mis viajes" → "My Trips"
- Button "Nuevo viaje" → "New Trip"
- Login prompt paragraph and button translated
- Loading state "Cargando viajes…" → "Loading trips…"
- Modal title "Crear nuevo viaje" → "Create New Trip"
- Form labels: Trip name, Description, Start date, End date
- Placeholder "ej. Japón 2027" → "e.g. Japan 2027"
- Placeholder "Descripción opcional" → "Optional description"
- Buttons: "Cancelar" → "Cancel", "Crear viaje" → "Create trip"

### frontend/profile.html
- `lang="es"` → `lang="en"`
- meta description translated
- `<title>Mi perfil</title>` → `<title>My Profile</title>`
- Skip link translated
- H1 "Mi perfil" → "My Profile"
- Section heading "Información de cuenta" → "Account Information"
- Labels: "Nombre" → "Name", "Usuario" → "Username", "Contraseña" → "Password"
- Link "Cambiar contraseña" → "Change password"
- Passkeys description translated in full
- "Cargando passkeys…" → "Loading passkeys…"
- "Agregar passkey" → "Add passkey"
- Section heading "Sesión" → "Session"
- Label "Cerrar sesión" → "Sign out"
- Description "Cerrará la sesión en este dispositivo." → "Signs you out on this device."
- Button "Cerrar sesión" → "Sign out"

## Verification

```
rg "[áéíóúñ¿¡]" frontend/index.html frontend/dashboard.html frontend/profile.html
# exit 1 — zero matches in all three files

rg 'lang="es"' frontend/index.html frontend/dashboard.html frontend/profile.html
# exit 1 — zero matches in all three files
```

## Deviations from Plan

None — plan executed exactly as written. Task 1 (index.html) was pre-completed; only Task 2 required work.

## Known Stubs

None.

## Threat Flags

None — text-node-only changes, no structural or security surface introduced.

## Self-Check: PASSED

- frontend/dashboard.html: modified, committed at fc2ac35
- frontend/profile.html: modified, committed at fc2ac35
- frontend/index.html: already clean (verified)
- Zero Spanish accent chars in all three files
- Zero `lang="es"` in all three files
