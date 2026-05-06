---
status: partial
phase: 03-public-sharing
source: [03-VERIFICATION.md]
started: 2026-05-06T00:00:00.000Z
updated: 2026-05-06T00:00:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apply DB migration (highest priority)
expected: `npm run db:migrate` from backend/ completes without error, applying `0002_add_public_slug.sql`. The `public_slug` column must exist on the `trips` table for the route to work at runtime.
result: [pending]

### 2. Guest view visual check
expected: Open `trip.html?slug=<real-uuid>` while logged out. Trip renders, `#trip-edit-link` is hidden, `#copy-link-btn` is absent, no edit controls visible.
result: [pending]

### 3. Owner copy-link end-to-end
expected: Log in as owner, open `trip.html?tripId=<id>`, `#copy-link-btn` is visible, click it, clipboard gets `?slug=<uuid>` URL, button shows "¡Copiado!" for ~2s.
result: [pending]

### 4. Button label product decision
expected: ROADMAP SC1 references "Compartir" button. Implementation uses "Copiar enlace público". Confirm which label is intended.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
