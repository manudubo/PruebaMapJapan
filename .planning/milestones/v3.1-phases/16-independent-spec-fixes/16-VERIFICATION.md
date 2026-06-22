---
phase: 16-independent-spec-fixes
status: human_needed
score: 5/5
requirements_covered: [SHARE-01, SHARE-02, THEME-01, THEME-02, THEME-03]
human_verification:
  - E2E run with live stack (backend + KC) on both specs
  - Confirm no firefox/webkit regressions
---

# Verification: Phase 16 — Independent Spec Fixes

## Phase Goal

Both `public-sharing.spec.ts` and `idp-theme.spec.ts` are green and can run independently (no auth dependency, no coupling to the shared login helper).

## Result: STRUCTURALLY COMPLETE — E2E runtime confirmation pending

All 5 success criteria verified in code. `human_needed` status is an environment constraint (shell unavailable during automated verification), not a code defect.

## Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `public-sharing.spec.ts` creates fixture data in `beforeAll` — no hardcoded UUIDs | VERIFIED | `beforeAll` lines 41-79 create public + private trips via `POST /api/trips`. No UUID constants remain. `grep 4dd5492e\|e3214d9f` → no matches. |
| 2 | Assertions reference current English copy, not removed Spanish placeholder | VERIFIED | `grep 'Cargando viaje'` → no matches. Positive assertion `toBe(TEST_PUBLIC_TRIP_NAME)` at line 152. |
| 3 | `idp-theme.spec.ts` runs with empty `storageState` — KC SSO session cannot skip login page | VERIFIED | `test.use({ storageState: { cookies: [], origins: [] } })` at line 25, inside `Keycloak theme` describe. Overrides chromium project's `.auth/user.json`. |
| 4 | `idp-theme.spec.ts` uses valid PKCE S256 `code_challenge` | VERIFIED | `CODE_CHALLENGE = crypto.createHash('sha256').update(CODE_VERIFIER).digest('base64url')` at lines 6-9. `CODE_VERIFIER` is 52 chars (valid 43-128 range). Old `aaaaaaa...` gone. |
| 5 | DOM/CSS assertions match KC 26 template structure | VERIFIED (static) | `#kc-header-wrapper { display: none !important }` in login.css:279. `.jp-idp-exit` with `href="${appUrl}">Return</a>` in footer.ftl:4. KC auto-includes footer.ftl; firefox/webkit were passing before Phase 16. |

## Requirements Coverage

| Req ID | Plan | Status |
|--------|------|--------|
| SHARE-01 | 16-01-PLAN.md | SATISFIED — self-contained fixture, no hardcoded UUIDs |
| SHARE-02 | 16-01-PLAN.md | SATISFIED — stale Spanish assertion removed |
| THEME-01 | 16-02-PLAN.md | SATISFIED — empty storageState override present |
| THEME-02 | 16-02-PLAN.md | SATISFIED — real SHA-256 PKCE challenge computed |
| THEME-03 | 16-02-PLAN.md | SATISFIED — DOM assertions correct per static analysis |

## Human Verification Items

1. **E2E run on both specs with live stack**
   ```
   cd tests && npx playwright test public-sharing idp-theme --project=chromium --reporter=list
   ```
   Expected: all tests pass or skip (0 failures).

2. **Confirm no regressions on firefox/webkit**
   ```
   cd tests && npx playwright test public-sharing idp-theme --reporter=list
   ```
   Expected: firefox and webkit continue to pass.
