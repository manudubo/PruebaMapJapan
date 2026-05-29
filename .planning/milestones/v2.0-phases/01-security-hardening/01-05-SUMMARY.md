---
phase: 01-security-hardening
plan: "05"
subsystem: backend-jwt-audience
tags: [keycloak, jwt, audience, sec-04, wave-2, human-checkpoint]
requires:
  - "02"
provides:
  - backend/src/auth/keycloak.ts — validateAudience exported; validAudiences reduced to ['japan-trip-frontend']
  - keycloak/realm-export.json — oidc-audience-mapper added to japan-trip-frontend client
affects:
  - backend/src/auth/keycloak.test.ts — GREEN (7/7)
  - backend/src/index.test.ts — GREEN (6/6, no regression)
tech-stack:
  added: []
  patterns: [pure-helper-extract, tdd-red-green]
key-files:
  created: []
  modified:
    - backend/src/auth/keycloak.ts
    - keycloak/realm-export.json
key-decisions:
  - validateAudience placed before getKeycloakJwks (near private helpers block, ~line 89)
  - if (aud) guard removed — validateAudience(undefined, ...) returns false, covering absent aud
  - protocolMappers array added to japan-trip-frontend client (was absent, not empty [])
  - Keycloak realm re-import confirmed by user
requirements-completed:
  - SEC-04
duration: 10 min
completed: "2026-04-27"
---

# Phase 01 Plan 05: validateAudience Helper + Realm Re-import Summary

`validateAudience` extracted and exported from keycloak.ts. `validAudiences` reduced to `['japan-trip-frontend']` only. Audience mapper added to realm-export.json. Keycloak realm re-imported (human checkpoint confirmed).

Duration: ~10 min | Tasks: 3 (2 auto + 1 human checkpoint) | Files modified: 2

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Add oidc-audience-mapper to realm-export.json | 8c9ce92 | ✓ Done |
| 2 | Keycloak admin realm re-import | manual | ✓ Confirmed |
| 3 | Extract validateAudience; reduce validAudiences | a48a732 | ✓ Done |

## What Was Built

- **validateAudience**: Pure exported helper `(aud: string | string[] | undefined, valid: string[]) => boolean`. Returns false for undefined, normalises string to array, checks any intersection with valid list.
- **verifyJwt update**: `validAudiences = ['japan-trip-frontend']` only — `account` and `japan-trip-api` removed. `if (aud)` guard removed; tokens without aud claim are now rejected (stricter, correct).
- **realm-export.json**: `protocolMappers` array added to `japan-trip-frontend` client with `oidc-audience-mapper` mapping `included.client.audience: "japan-trip-frontend"` into access tokens only.

## Verification Results

```
PASS src/auth/keycloak.test.ts (7/7) — GREEN
PASS src/middleware/cors.test.ts (3/3) — GREEN (no regression)
PASS src/index.test.ts (6/6) — GREEN (no regression)
grep -c "oidc-audience-mapper" realm-export.json → 1
grep "validAudiences" keycloak.ts → const validAudiences = ['japan-trip-frontend'];
```

## Deviations from Plan

**[Rule 1 — Minor] protocolMappers array was absent (not empty [])**
Found during: Task 1 read | japan-trip-frontend client had no `protocolMappers` key at all; plan described it as "empty: []". Added new key with the mapper. No functional impact — result is identical.

**Total deviations:** 1 (trivial JSON structure difference; correct outcome achieved).

## Self-Check: PASSED

- [x] `grep -c "export function validateAudience" keycloak.ts` → 1
- [x] `grep "validAudiences" keycloak.ts` → `['japan-trip-frontend']` only
- [x] `grep "'account'" keycloak.ts` → empty (removed)
- [x] `grep "'japan-trip-api'" keycloak.ts` → empty (removed)
- [x] keycloak.test.ts GREEN (7/7)
- [x] index.test.ts GREEN (6/6) — no regression
- [x] `grep -c "oidc-audience-mapper" realm-export.json` → 1
- [x] Keycloak realm re-import confirmed

Next: Plan 01-06 (harden tripDetail.ts — replace innerHTML with dom.ts helpers + DOMPurify; export buildPopup and buildHotelPopup)
