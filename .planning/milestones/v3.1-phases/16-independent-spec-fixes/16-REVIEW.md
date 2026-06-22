---
phase: 16
status: issues_found
files_reviewed: 2
depth: standard
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
---

# Code Review: Phase 16 — Independent Spec Fixes

## Files Reviewed

- `tests/e2e/public-sharing.spec.ts`
- `tests/e2e/idp-theme.spec.ts`

## Summary

`idp-theme.spec.ts` is clean. PKCE S256 is correctly computed via `crypto.createHash('sha256').update(CODE_VERIFIER).digest('base64url')`, the `storageState: { cookies: [], origins: [] }` override correctly prevents chromium from reusing the KC SSO session, and all DOM assertions are tight. No issues.

`public-sharing.spec.ts` had two test-reliability issues — both fixed inline before commit.

---

## Findings

### WR-01: No response-status guard on beforeAll fixture creation

**Severity:** warning  
**File:** `tests/e2e/public-sharing.spec.ts` — `beforeAll`

`pubResp.json()` / `privResp.json()` were called unconditionally after `page.request.post(...)`. If the backend returns 4xx/5xx, `pubData.data` is `undefined` and `String(pubData.data.id)` throws a TypeError. The error surfaced as "Cannot read properties of undefined" in `beforeAll`, obscuring the real cause (bad auth, wrong URL, API error).

**Status:** Fixed — `if (!pubResp.ok()) throw new Error(...)` guard added for both requests.

---

### WR-02: "unauthenticated" test ran as authenticated owner in chromium

**Severity:** warning  
**File:** `tests/e2e/public-sharing.spec.ts` — `Public sharing — non-owner ?tripId= access`

The test name said "unauthenticated" but the chromium project injects `storageState: '.auth/user.json'` (playwright.config.ts:25). Under chromium, `tripDetail.ts` calls `initKeycloak()` successfully, `getTrip(tripId)` returns the fixture trip (same user created it in `beforeAll`), `showError()` is never called, and `#main-content` does not contain the word `'access'`. The assertion `expect(text).toContain('access')` therefore fails on chromium while passing on firefox/webkit — a cross-browser flake.

**Status:** Fixed — `test.use({ storageState: { cookies: [], origins: [] } })` added inside that describe block (same pattern as `idp-theme.spec.ts:25`).
