---
phase: 16-independent-spec-fixes
plan: 02
subsystem: e2e-tests
tags: [playwright, keycloak, pkce, storagestate]
key-files:
  modified:
    - tests/e2e/idp-theme.spec.ts
metrics:
  tasks_completed: 1
  tasks_total: 1
  commits: 1
---

# Plan 16-02 Summary: idp-theme spec fix

## What Was Built

Applied two surgical changes to `tests/e2e/idp-theme.spec.ts`:

1. **THEME-01** — Added `test.use({ storageState: { cookies: [], origins: [] } })` inside the `Keycloak theme` describe block. Chromium's project-level storageState inherits `.auth/user.json` which contains a valid KC SSO session cookie, causing KC to redirect straight to the dashboard instead of rendering the login page. The empty override prevents this redirect, allowing theme assertions to execute on chromium.

2. **THEME-02** — Replaced the invalid 43-`a` placeholder `code_challenge` with a real SHA-256 S256 value computed via `crypto.createHash('sha256').update(CODE_VERIFIER).digest('base64url')`. KC 26 validates the PKCE challenge format; the placeholder was causing a 400 `invalid_request` response.

**THEME-03**: No code change needed — DOM assertions (`toBeHidden`, `toBeVisible`, `toHaveText`, `toHaveAttribute`, `borderRadius`, `fontFamily`) were already correct per the KC 26 template structure; firefox/webkit were already passing.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 04c6a04 | fix(16-02): empty storageState override + valid PKCE S256 challenge in idp-theme spec |

## Deviations

None. Both changes applied exactly as specified in the plan.

## Self-Check: PASSED

- `grep "aaaaaaaaaa" tests/e2e/idp-theme.spec.ts` → no matches ✓
- `grep "CODE_CHALLENGE\|createHash\|base64url\|CODE_VERIFIER" tests/e2e/idp-theme.spec.ts` → all 4 terms present ✓
- `grep "storageState.*cookies.*origins" tests/e2e/idp-theme.spec.ts` → match on line 25 ✓
- `grep "import crypto" tests/e2e/idp-theme.spec.ts` → match on line 2 ✓
- TypeScript check (`tsc --noEmit` from frontend): exit 0, no errors ✓
