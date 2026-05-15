---
status: resolved
phase: 03-public-sharing
source: [03-VERIFICATION.md]
started: 2026-05-06T00:00:00.000Z
updated: 2026-05-06T00:00:00.000Z
---

## Current Test

All automated items verified via Playwright + curl. One item deferred as product decision.

## Tests

### 1. Apply DB migration (highest priority)
expected: `0002_add_public_slug.sql` applied; `public_slug` column exists with UUID default and unique index.
result: PASS — applied via `docker exec psql`. Column confirmed: `public_slug uuid DEFAULT gen_random_uuid()`, unique index `trips_public_slug_idx`. All existing trips received auto-generated slugs.

### 2. Guest view visual check
expected: `trip.html?slug=<real-uuid>` without auth — trip renders, `#trip-edit-link` hidden, `#copy-link-btn` hidden.
result: PASS — Playwright chromium test confirmed: title populated ("Japan 2026"), both `#trip-edit-link` and `#copy-link-btn` hidden in slug mode.

### 3. WR-01 — Non-owner ?tripId= access-denied message
expected: `trip.html?tripId=<id>` without auth shows access-denied message instead of failed network call.
result: PASS — Playwright chromium test confirmed: `#main-content` contains "acceso" (message: "No tenés acceso a este viaje. Pedile al dueño el enlace público.").

### 4. Backend route — private trip blocked
expected: Private trip slug returns 404 even though slug is valid.
result: PASS — curl + Playwright confirmed: `GET /api/public/trips/<private-slug>` returns 404.

### 5. Backend route — invalid slug rejected
expected: `GET /api/public/trips/not-a-uuid` returns 400 "Invalid slug".
result: PASS — confirmed via curl and Playwright.

### 6. Button label product decision
expected: ROADMAP SC1 references "Compartir" button. Implementation uses "Copiar enlace público".
result: DEFERRED — product wording decision for owner. Current label "Copiar enlace público" is clear and functional; "Compartir" is shorter. No functional impact either way.

## Summary

total: 6
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0
deferred: 1 (button label — product decision, no functional impact)

## Gaps
