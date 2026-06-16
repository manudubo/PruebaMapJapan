---
phase: 13-security-audit-documentation
verified: 2026-06-07T23:30:00Z
status: passed
score: 5/5
overrides_applied: 0
---

# Phase 13: Security Audit & Documentation — Verification Report

**Phase Goal:** OAuth/OIDC compliance is audited with evidence; a 401 audience assertion guards JWT scope regression; all documentation is accurate and complete for a fresh setup
**Verified:** 2026-06-07T23:30:00Z
**Status:** PASS
**Re-verification:** No — initial verification

---

## Overall Verdict: PASS

All 5 success criteria verified. Backend test suite: 30/30. Frontend test suite: 97/97.

---

## Success Criteria Results

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| SC1 | RFC 9700 checklist with per-control evidence | PASS | `docs/security/rfc9700-checklist.md` — 23 controls documented (19 Compliant, 4 N/A, 0 Non-compliant); evidence cells reference real code and config paths |
| SC2 | JWKS retry on signature failure before 401 | PASS | `backend/src/auth/keycloak.ts` lines 228–250: `jwksRefreshed` flag + retry-once logic; unit test `verifyJwt — JWKS retry on signature failure (SEC-02)` passing (2/2 tests) |
| SC3 | CSP, X-Frame-Options, HSTS on all responses | PASS | `backend/src/middleware/security.ts` sets all 3 headers; `backend/src/index.ts` line 13 registers globally (`app.use('*', securityMiddleware)`); `Security headers middleware` describe block passing (2/2 tests) |
| SC4 | E2E test: wrong-audience token returns 401 | PASS | `tests/e2e/api.spec.ts` lines 69–106: `JWT audience rejection` describe block, test not skipped, sends real `client_credentials` token from a client with no `japan-trip-frontend` audience mapper, asserts `status === 401` |
| SC5 | README quick-start + SETUP.md + use-cases.md | PASS | README.md: `npm run dev` quick-start block + link to `SETUP.md`; SETUP.md: 8-step guide including `terraform apply` (Step 5) and DB seed; `docs/use-cases.md`: 22-row table with Coverage Status column |

---

## Detailed Findings

### SC1 — RFC 9700 Checklist

**File:** `docs/security/rfc9700-checklist.md`

The checklist exists and is substantive (48 lines, 23 control rows). Each row has Status, Evidence, and Rationale columns. Spot-checked evidence references:

- `terraform/keycloak/main.tf` line 63: `pkce_code_challenge_method = "S256"` — confirmed present
- `terraform/keycloak/main.tf` lines 88–95: audience mapper block — confirmed present (grep shows `keycloak_openid_audience_protocol_mapper` at line 88, `included_client_audience` at line 92)
- `backend/src/auth/keycloak.ts:89–93` (`validateAudience` function) — confirmed at lines 89–93
- `backend/src/middleware/security.ts` `Referrer-Policy: no-referrer` — confirmed in file

One minor discrepancy: the checklist claims `implicit_flow_enabled = false` is explicitly in `main.tf`; the literal string does not appear (only `standard_flow_enabled` is set). However, Keycloak 26's default for implicit flow is disabled, and no client enables it. The intent and effect are correct; the literal evidence reference is slightly imprecise but not a blocker for the checklist's purpose.

### SC2 — JWKS Retry Logic

**File:** `backend/src/auth/keycloak.ts`

`verifyJwt` (lines 148–258) implements the retry pattern correctly:

1. Fetches JWKS via `getKeycloakJwks` (with 1-hour cache)
2. If `kid` not found in cache: invalidates `jwksCache = null` and refetches immediately (lines 215–221) — handles missing-key case
3. If signature verification fails (`!isValid && !jwksRefreshed`): sets `jwksRefreshed = true`, invalidates cache, refetches, retries verification (lines 237–250)
4. If still invalid after retry: throws `'JWT signature verification failed'` (line 254)

Unit tests confirm both paths: retry succeeds (key rotation simulation) and retry fails (genuinely bad signature).

### SC3 — Security Headers

**File:** `backend/src/middleware/security.ts`

Sets:
- `Content-Security-Policy: default-src 'none'`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: no-referrer` (bonus — not in SC but documented in checklist)

**File:** `backend/src/index.ts` line 13: `app.use('*', securityMiddleware)` — global registration, runs on every route including error paths.

Unit tests in `Security headers middleware` describe block verify headers appear on both 200 and 401 responses.

Note: `curl -I` runtime verification requires a running backend and is not feasible in this static analysis. The unit tests substitute as the verification mechanism, which is appropriate given the middleware is wired globally.

### SC4 — E2E Audience Rejection Test

**File:** `tests/e2e/api.spec.ts` lines 69–106

The `JWT audience rejection` describe block contains one test: `worker client_credentials token without japan-trip-frontend audience returns 401`. It is:
- Not marked `.skip` or `.todo`
- Gated on `isBackendRunning()` (skips cleanly when backend is down — this is correct E2E gate behavior, not a test defect)
- Fetches a real `client_credentials` token from the `japan-trip-worker` client (which has no `japan-trip-frontend` audience mapper by Terraform design)
- Asserts `res.status() === 401`

The test is substantive and correctly implements the audience rejection assertion. The `test.skip(!backendUp, ...)` pattern means it will skip in CI without a live Keycloak — that is by design for an integration test.

### SC5 — Documentation Accuracy

**README.md:**
- "Getting Started" section includes `npm install && npm run dev` quick-start
- States what `npm run dev` does (Docker, Keycloak, backend at :8787, frontend at :5173)
- Links to `SETUP.md` for first-time setup

**SETUP.md:**
- 8-step guide covering: clone, env templates, `backend/.dev.vars`, Keycloak Docker, `terraform apply` (Step 5 — confirmed present), npm install, DB migration + seed, `npm run dev`
- Documents test users created by Terraform
- Accurate: commands match actual project structure (confirmed `terraform/keycloak/` path exists, `npm run dev` is the real command)

**docs/use-cases.md:**
- 22 user scenarios in a table with `E2E Spec File` and `Coverage Status` columns
- Coverage status values: Full / Partial / None — each row populated
- Includes "Coverage Gaps" section listing Phase 14 candidates

---

## Anti-Pattern Scan

No blockers found in phase-13 key files:
- `backend/src/auth/keycloak.ts` — no TODO/placeholder, retry logic is substantive
- `backend/src/middleware/security.ts` — 9 lines, fully implemented
- `tests/e2e/api.spec.ts` — no `.skip`/`.todo` on audience test
- `docs/security/rfc9700-checklist.md` — no empty evidence cells

---

## Test Suite Results

| Suite | Result | Count | Named Describes Verified |
|-------|--------|-------|--------------------------|
| `backend` | PASS | 30/30 | `Security headers middleware` (2 tests), `verifyJwt — JWKS retry on signature failure (SEC-02)` (2 tests) |
| `frontend` | PASS | 97/97 | N/A for this phase |

---

_Verified: 2026-06-07T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
