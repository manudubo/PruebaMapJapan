---
phase: 13-security-audit-documentation
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - backend/src/index.ts
  - backend/src/index.test.ts
  - backend/src/auth/keycloak.ts
  - backend/src/auth/keycloak.test.ts
  - tests/e2e/api.spec.ts
  - docs/security/rfc9700-checklist.md
  - README.md
files_not_found:
  - backend/src/middleware/security.ts
  - SETUP.md
  - docs/use-cases.md
findings:
  critical: 1
  warning: 0
  info: 1
  total: 2
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-06-06
**Depth:** standard
**Files Reviewed:** 7 (3 listed files not found — see below)
**Status:** issues_found

## Files Not Found

Three files listed in the review scope do not exist on disk:

- `backend/src/middleware/security.ts`
- `SETUP.md`
- `docs/use-cases.md`

The missing `security.ts` is directly relevant to the Critical finding below.

## Summary

The auth core (`backend/src/auth/keycloak.ts`) is solid: RS256 JWKS verification, correct expiry/nbf/iss/aud validation, cache-invalidation on key rotation, and `sub` presence check all look correct. The audience validation function is well-tested in `keycloak.test.ts`. The `authMiddleware` in `auth.ts` (read for context) correctly surfaces JWT error messages as 401 responses rather than leaking stack traces.

One Critical finding: the RFC 9700 compliance checklist marks §4.2.4 (Referrer-Policy) as Compliant and cites `backend/src/middleware/security.ts` as evidence. That file does not exist. No middleware in the running backend sets `Referrer-Policy` — the only globally-registered middleware in `index.ts` is `corsMiddleware`. The control is asserted but not implemented.

One Info finding: a version discrepancy in README.md.

## Critical Issues

### CR-01: RFC 9700 §4.2.4 compliance claim is unsubstantiated — Referrer-Policy header is not set

**File:** `docs/security/rfc9700-checklist.md:28`
**Also affects:** `backend/src/index.ts:11`

**Issue:** The checklist marks §4.2.4 ("Suppress Referer headers to prevent auth code leakage") as **Compliant** and cites `backend/src/middleware/security.ts` as evidence, describing it as "added Phase 13… set unconditionally on all API responses." That file does not exist. Grepping the entire `backend/` tree for `Referrer-Policy`, `secureHeaders`, and `hono/secure-headers` returns zero matches. The only globally-registered middleware in `index.ts` is `corsMiddleware` (line 11). The `Referrer-Policy: no-referrer` header is never sent.

In this architecture the risk is low (the backend is a pure JSON API; tokens flow in `Authorization` headers, not query params), but a security checklist asserting a control that isn't present is worse than marking it N/A — it gives false assurance.

**Fix:** Either implement the missing middleware or correct the checklist entry.

Option A — add the middleware (two steps):

```typescript
// backend/src/middleware/security.ts
import type { Context, Next } from 'hono';

export async function securityHeadersMiddleware(c: Context, next: Next): Promise<Response> {
  await next();
  c.res.headers.set('Referrer-Policy', 'no-referrer');
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  return c.res;
}
```

```typescript
// backend/src/index.ts — add after corsMiddleware
import { securityHeadersMiddleware } from './middleware/security';
app.use('*', securityHeadersMiddleware);
```

Option B — correct the checklist to reflect actual status:

```markdown
| 4.2.4 | Suppress Referer headers ... | N/A | Backend is a pure JSON API; tokens are never placed in URLs | No redirect-based auth code flow occurs at the resource server |
```

Pick whichever matches the intended design. If the plan is to add the middleware in a later step of Phase 13, update the checklist status to `Pending` rather than `Compliant` until the code lands.

## Info

### IN-01: README.md states Keycloak 25; checklist states 26.6.1

**File:** `README.md:24` and `README.md:77`

**Issue:** The Tech Stack table and project-structure comment both reference "Keycloak 25" while `docs/security/rfc9700-checklist.md:6` identifies the audited version as "Keycloak 26.6.1". One of these is stale.

**Fix:** Align README to the version actually deployed:

```markdown
| Auth | Keycloak 26 (local Docker / Railway in production) |
```

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
