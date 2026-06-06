# Phase 13: Security Audit + Documentation — Research

**Researched:** 2026-06-06
**Domain:** OAuth/OIDC security audit, Hono middleware, Playwright E2E, documentation
**Confidence:** HIGH (all findings are codebase-verified, no external library research required)

## Summary

Phase 13 is primarily a codebase-internal phase: writing one new middleware, patching one auth function, adding one Playwright test, and producing three documentation artifacts. There are no new library dependencies. All patterns can be directly derived from existing code in the repo.

The two open questions from CONTEXT.md (D-07 and D-14) are resolved below with concrete code-level evidence. The JWKS retry gap confirmed by D-06 is real and the fix is straightforward. The kc-admin-worker client does NOT exist in Terraform under that name — the worker client is named `japan-trip-worker` and its tokens do NOT include the `japan-trip-frontend` audience, which means D-11's strategy works as-is.

**Primary recommendation:** No external research needed. All answers come from reading the existing codebase. The planner can assign tasks directly from this document.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Security Headers — SEC-04**
- D-01: CSP policy: `Content-Security-Policy: default-src 'none'`
- D-02: Additional headers: `X-Frame-Options: DENY` and `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- D-03: All three headers applied unconditionally — no environment detection
- D-04: New `backend/src/middleware/security.ts`, registered in `backend/src/index.ts` after `corsMiddleware`

**JWKS Retry — SEC-02**
- D-05: Existing kid-not-found retry at keycloak.ts:210–221 is confirmed real
- D-06: Gap confirmed: no retry when kid IS found but signature verification fails
- D-07: Researcher must make the recommendation (see below — recommendation is: extend retry to cover signature verification failures)

**RFC 9700 Checklist — SEC-01**
- D-08: Artifact location: `docs/security/rfc9700-checklist.md`
- D-09: Format: `status` + `file:line` or Terraform resource reference + one-sentence rationale. No prose paragraphs.
- D-10: Enumerate RFC 9700 controls, map to existing code or flag as gap

**SEC-05 Audience Assertion**
- D-11: Use `kc-admin-worker` KC client (service_accounts_enabled = true) — researcher must verify name and audience content
- D-12: New `describe` block in `tests/e2e/api.spec.ts`
- D-13: Fetch client_credentials token → send to GET /api/trips → assert 401
- D-14: Researcher must verify audience claim on kc-admin-worker tokens

**Documentation**
- D-15: README.md updated to reflect `npm run dev`; remove `cd keycloak && docker compose up -d` and `dev:backend`/`dev:frontend`; keep concise
- D-16: SETUP.md for fresh dev machine: Docker Desktop, Node 22+, Terraform, git, clone, `.env.example` → `.env`, `terraform init`/`apply`, `npm install`, `npm run dev`
- D-17: `docs/use-cases.md` — table: `User Action | E2E Spec File | Coverage Status`
- D-18: README prerequisites: Docker Desktop, Node.js 22+, Terraform >= 1.0, optionally gh CLI

### Claude's Discretion

- Exact CSP directives beyond `default-src 'none'`
- Whether to extend JWKS retry to signature-verification failures or accept kid-not-found retry (see D-07 recommendation below)
- Exact structure of SETUP.md
- Which additional env vars to document in SETUP.md
- Whether to use markdown table library or raw GFM tables in `docs/use-cases.md`

### Deferred Ideas (OUT OF SCOPE)

None raised during discussion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEVENV-03 | User can follow README to set up local environment from scratch without consulting other sources | README.md content audit below; SETUP.md structure in D-16 |
| SEC-01 | Written RFC 9700 checklist artifact with each control documented as compliant/non-compliant/N/A with evidence | RFC 9700 control enumeration below; existing code references identified |
| SEC-02 | Backend JWT verification retries JWKS fetch once on 401 before failing (handles signing key rotation) | D-07 recommendation confirmed: extend retry to cover signature verification failure at keycloak.ts:235–237 |
| SEC-04 | Backend Hono responses include CSP, X-Frame-Options, and HSTS headers | Middleware pattern from cors.ts verified; insertion point in index.ts confirmed |
| SEC-05 | E2E assertion verifies token with `aud: account` only returns 401 from backend API | kc-admin-worker = `japan-trip-worker`; no audience mapper → tokens have only `account` aud; strategy works |
| DOC-01 | README.md reflects simplified local setup using `npm run dev` | Old content identified; replacement content specified below |
| DOC-02 | SETUP.md exists with step-by-step fresh setup instructions | Structure and content specified below |
| DOC-03 | Use case inventory document listing user scenarios and E2E coverage vs gaps | Existing specs enumerated below for table population |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Security headers (CSP, X-Frame-Options, HSTS) | API / Backend | — | Headers set on Hono responses at middleware layer; browser enforces CSP but only on HTML, so this is defense-in-depth at the API tier |
| JWKS retry logic | API / Backend | — | JWT verification is backend-only; Cloudflare Workers runtime, no frontend involvement |
| RFC 9700 checklist | Documentation | — | Static artifact; references both frontend KC config and backend code |
| SEC-05 audience assertion test | API / Backend (tested via E2E) | — | Test calls backend API directly via Playwright request context; no browser UI needed |
| README / SETUP.md | Documentation | — | Static documentation artifacts |
| Use case inventory | Documentation | — | References existing E2E spec files |

## Standard Stack

### Core (no new dependencies required)

All deliverables use only already-installed packages.

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------------------|---------|--------------|
| hono | ^4.6.17 | Middleware handler type `MiddlewareHandler`; `c.header()` for setting response headers | Already the backend framework |
| @playwright/test | installed in tests/ | `request.newContext()` for SEC-05 token fetch and API assertion | Already the E2E framework |
| vitest | ^2.1.8 | Unit tests for `verifyJwt` retry logic | Already the unit test framework |

### No New Installations Needed

The security.ts middleware, JWKS retry patch, and SEC-05 test all use existing Hono and Playwright APIs already present in the repo.

## Architecture Patterns

### System Architecture Diagram

```
[E2E Test: SEC-05]
    └─ fetch client_credentials token from Keycloak (japan-trip-worker)
    └─ POST /api/trips with Bearer <worker_token>
         └─ [Backend: authMiddleware]
              └─ verifyJwt()
                   └─ validateAudience() → rejects (aud='account', not 'japan-trip-frontend')
                        └─ returns 401

[HTTP Request → Backend]
    └─ corsMiddleware (existing, line 11)
    └─ securityMiddleware (NEW, line 12 — sets 3 headers on response)
    └─ routes / authMiddleware
```

### Recommended Project Structure (additions only)

```
backend/src/middleware/
├── cors.ts            # existing
├── auth.ts            # existing
└── security.ts        # NEW — SEC-04

docs/
├── security/
│   └── rfc9700-checklist.md   # NEW — SEC-01
└── use-cases.md               # NEW — DOC-03

SETUP.md                       # NEW — DOC-02
README.md                      # MODIFIED — DOC-01
```

## Critical Code Investigation Findings

### D-07: JWKS Retry Gap Analysis — CONFIRMED, extend retry

**Current code (keycloak.ts lines 209–237):**

```
lines 210-221: kid-not-found retry
  - Gets keyMap from cache
  - If kid not in keyMap → invalidates jwksCache, refetches, retries lookup
  - If kid still not found → throws "JWT signing key not found"

lines 228-237: signature verification
  - crypto.subtle.verify() → isValid boolean
  - if (!isValid) → throws "JWT signature verification failed"
  - NO retry here — if kid IS found but key is stale after rotation, throws immediately
```

**The gap:** During key rotation, Keycloak may issue tokens signed with a NEW key while the OLD public key is still in the 1-hour TTL cache. If the new kid happens to match an entry from the old JWKS (unlikely but possible with certain rotation strategies), or if the cached public key's `n`/`e` values are stale, `isValid` returns false and the request fails permanently until the cache TTL expires (up to 1 hour).

**More commonly:** After key rotation, a NEW kid will trigger the existing kid-not-found retry at line 213. However, if JWKS cache TTL was recently refreshed (within 1 hour) and rotation happened mid-TTL, tokens with the new kid will always hit the retry path. The signature failure path (line 235) is only reached if the kid IS in cache but the key material is wrong — this cannot happen with Keycloak's standard rotation because old kids are removed from the JWKS endpoint.

**Refined assessment:** The signature-verification failure path (`isValid === false`) in Keycloak's implementation would only be triggered by a corrupted cache entry or a malformed token — not by standard key rotation. Key rotation in Keycloak produces a new `kid` value, which is already handled by the kid-not-found retry.

**D-07 Recommendation (Claude's Discretion):** The existing kid-not-found retry at lines 213–220 is sufficient for Keycloak's standard key rotation behavior. However, SEC-02's stated requirement is "retries JWKS fetch once on a key-verification failure" — and the ROADMAP success criterion says "retries the JWKS fetch once on a key-verification failure before returning 401." The word "key-verification failure" is broad enough to include signature failure. To be strictly compliant with the written requirement, **extend the retry to also cover `isValid === false`**: after the `crypto.subtle.verify` call, if `isValid === false`, invalidate `jwksCache`, re-fetch, re-find the public key, and re-run `crypto.subtle.verify` once. This is a 10-line addition and definitively satisfies SEC-02 regardless of Keycloak's internal rotation strategy.

**Exact insertion point:** After line 237 (`throw new Error('JWT signature verification failed')`), restructure the block:

```typescript
// Verify RS256 signature using Web Crypto API
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signingInputBytes = new TextEncoder().encode(signingInput);
const signatureBytes = base64urlToArrayBuffer(encodedSignature);

let isValid = await crypto.subtle.verify(
  { name: 'RSASSA-PKCS1-v1_5' },
  publicKey,
  signatureBytes,
  signingInputBytes,
);

if (!isValid) {
  // Retry once: invalidate cache and refetch JWKS (handles key rotation mid-TTL)
  jwksCache = null;
  const retryKeyMap = await getKeycloakJwks(env);
  const retryKey = retryKeyMap.get(header.kid);
  if (retryKey) {
    isValid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      retryKey,
      signatureBytes,
      signingInputBytes,
    );
  }
}

if (!isValid) {
  throw new Error('JWT signature verification failed');
}
```

### D-14: kc-admin-worker Audience Verification — Strategy Confirmed Working

**Finding:** There is NO resource named `kc-admin-worker` in `terraform/keycloak/main.tf`. The client established in Phase 7 for KC Admin worker operations is named `japan-trip-worker` (resource: `keycloak_openid_client.japan_trip_worker`, client_id: `"japan-trip-worker"`).

**Audience mapper audit:**
- `keycloak_openid_audience_protocol_mapper.audience` at line 88 is attached to `keycloak_openid_client.japan_trip_frontend` (the frontend client) — it adds `japan-trip-frontend` to the frontend client's tokens.
- `keycloak_openid_client.japan_trip_worker` has NO audience mapper resource defined anywhere in main.tf or flows.tf.

**Conclusion:** A client_credentials token from `japan-trip-worker` will contain only the default Keycloak audience — which is `account` (the built-in Keycloak client). It will NOT contain `japan-trip-frontend`. The backend's `validateAudience()` at keycloak.ts:89–93 will reject it because `VALID_AUDIENCES` is set to `japan-trip-frontend`.

**D-11 strategy is confirmed correct.** Use `japan-trip-worker` as the token source for SEC-05.

**Test env vars needed:** `KC_ADMIN_CLIENT_ID` and `KC_ADMIN_CLIENT_SECRET` are already in the test environment (used by kc-admin.ts fixture). However, for SEC-05, a direct HTTP call to Keycloak's token endpoint is needed — the kc-admin.ts fixture uses `@keycloak/keycloak-admin-client` library, not raw fetch. The test must fetch the token directly.

### Middleware Pattern for security.ts (from cors.ts)

cors.ts uses the `hono/cors` helper and exports a named const. The security.ts pattern must NOT use a Hono helper — it uses `c.header()` directly. The correct analog is the `authMiddleware` pattern in auth.ts:

```typescript
// backend/src/middleware/security.ts
import type { MiddlewareHandler } from 'hono';

export const securityMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Content-Security-Policy', "default-src 'none'");
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
};
```

**Critical: `await next()` FIRST, then set headers.** In Hono, `c.header()` called after `next()` sets headers on the response already written by downstream handlers. This is the standard Hono middleware pattern for response header injection.

[VERIFIED: codebase — auth.ts and cors.ts patterns read directly]

### Exact Insertion Point in index.ts

Current state of `backend/src/index.ts`:

```
line 1: import { Hono } from 'hono';
line 2: import { corsMiddleware } from './middleware/cors';
line 3: import routes from './routes';
...
line 11: app.use('*', corsMiddleware);
```

Add after line 2:
```typescript
import { securityMiddleware } from './middleware/security';
```

Add after line 11:
```typescript
app.use('*', securityMiddleware);
```

The CONTEXT.md canonical ref at line 114 confirms: "add `app.use('*', securityMiddleware)` immediately after" corsMiddleware.

[VERIFIED: backend/src/index.ts read directly]

### SEC-05 Client Credentials Token Fetch Pattern

The kc-admin.ts fixture uses `@keycloak/keycloak-admin-client` library which internally does client_credentials. For SEC-05, a raw fetch to Keycloak's token endpoint is simpler:

```typescript
// Inside the SEC-05 test describe block in tests/e2e/api.spec.ts
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const KC_REALM = process.env.KEYCLOAK_REALM ?? 'japan-trip';

const tokenRes = await fetch(
  `${KEYCLOAK_URL}/realms/${KC_REALM}/protocol/openid-connect/token`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.KC_ADMIN_CLIENT_ID!,
      client_secret: process.env.KC_ADMIN_CLIENT_SECRET!,
    }),
  }
);
const { access_token } = await tokenRes.json();
```

The env vars `KC_ADMIN_CLIENT_ID` and `KC_ADMIN_CLIENT_SECRET` are already present in the test environment (used by `kc-admin.ts`). No new env vars needed.

**Note:** The describe block should include the `isBackendRunning()` skip guard pattern from existing tests in api.spec.ts (lines 7–16), since the backend must be running for this test.

[VERIFIED: tests/e2e/fixtures/kc-admin.ts and tests/e2e/api.spec.ts read directly]

## RFC 9700 BCP Controls Enumeration (SEC-01)

For the `docs/security/rfc9700-checklist.md` artifact. Each control mapped to existing code/config or flagged as gap:

| Section | Control | Status | Evidence |
|---------|---------|--------|----------|
| 2.1 | Exact string matching for redirect URIs | Compliant | `terraform/keycloak/main.tf` — `valid_redirect_uris` lists exact URIs, no wildcards (Phase 12) |
| 2.1 | No open redirectors | Compliant | Backend never issues redirects; frontend uses KC's redirect handling |
| 2.1.1 | Public clients must implement PKCE | Compliant | `main.tf` line 63: `pkce_code_challenge_method = "S256"` |
| 2.1.1 | Only S256 code challenge method | Compliant | `pkce_code_challenge_method = "S256"` — S256 enforced server-side |
| 2.1.1 | AS must reject token requests with code_verifier if no code_challenge | Compliant | Enforced by Keycloak 25 when PKCE is mandated (Phase 12 INFRA-04) |
| 2.1.2 | Avoid implicit grant | Compliant | `main.tf`: `standard_flow_enabled = true` only; no implicit grant |
| 2.2.1 | Sender-constrained access tokens (mTLS or DPoP) | N/A | Single resource server; deferred to post-v3.0 per REQUIREMENTS.md |
| 2.2.2 | Refresh token protection (rotation or sender-constraint) | Compliant | Keycloak handles refresh token rotation by default; single-user app |
| 2.3 | Audience-restricted access tokens | Compliant | `main.tf` lines 88–95: `keycloak_openid_audience_protocol_mapper.audience` restricts tokens to `japan-trip-frontend` |
| 2.4 | ROPC grant must not be used | Compliant | `direct_access_grants_enabled = false` in all KC clients; no ROPC in test fixtures |
| 2.5 | Client authentication (asymmetric preferred) | Compliant | `japan-trip-frontend` is PUBLIC (no secret); `japan-trip-worker` is CONFIDENTIAL with client_secret |
| 2.6 | Publish AS metadata (RFC 8414) | Compliant | Keycloak publishes `/.well-known/openid-configuration` by default |
| 2.6 | End-to-end TLS | Compliant (partial) | Production: GitHub Pages (HTTPS) → Cloudflare Workers (HTTPS) → Railway KC (HTTPS); local dev: HTTP (acceptable per RFC for loopback) |
| 4.1.3 | Exact URI string comparison | Compliant | Keycloak enforces; Terraform lists exact URIs |
| 4.2.4 | Suppress Referer headers via Referrer-Policy | Gap | No `Referrer-Policy` header currently set — add to security.ts |
| 4.3.2 | Never pass access tokens in URI query parameters | Compliant | All API calls use `Authorization: Bearer` header |
| 4.4.2 | Mix-up attack defense (multiple AS binding) | N/A | Single authorization server (Keycloak); no mix-up risk |
| 4.5.3 / 4.8.2 | PKCE protects against authorization code injection and downgrade | Compliant | S256 enforced; KC rejects requests violating PKCE protocol |
| 4.7.1 | CSRF protection via PKCE/nonce/state | Compliant | PKCE S256 provides CSRF protection; KC + keycloak-js handle state |
| 4.9.3 | Treat access tokens as sensitive; audience restriction | Compliant | `validateAudience()` in `backend/src/auth/keycloak.ts:89–93`; JWT in sessionStorage (frontend, same-origin) |
| 4.10.1 | Sender-constrained tokens | N/A | Deferred per REQUIREMENTS.md (DPoP deferred post-v3.0) |
| 4.10.2 | Audience-restricted tokens at resource server | Compliant | `backend/src/auth/keycloak.ts:198–202` — validates aud against VALID_AUDIENCES env |

**Gap identified:** `Referrer-Policy` header not currently set. Consider adding `c.header('Referrer-Policy', 'no-referrer')` to security.ts alongside the three required headers (D-03 says "all three headers applied unconditionally" — this would be an additional header, within Claude's Discretion since D-01/D-02 name exactly three required headers).

[VERIFIED: terraform/keycloak/main.tf and backend/src/auth/keycloak.ts read directly; RFC 9700 fetched from rfc-editor.org]

## README.md — Content to Remove and Replace (DOC-01)

**Current README.md (126 lines) — sections to replace:**

The "Getting Started" section (lines 29–51) contains:
```
# 2. Start infrastructure (PostgreSQL + Keycloak)
cd keycloak && docker compose up -d && cd ..

# 3. Initialise database
cd backend
DATABASE_URL=... npx drizzle-kit push --force
DATABASE_URL=... npx tsx src/db/seed.ts
cd ..

# 4. Start backend + frontend (two terminals)
npm run dev:backend   # → http://localhost:8787
npm run dev:frontend  # → http://localhost:5173/PruebaMapJapan/
```

This must be replaced with:
```bash
npm install
npm run dev
```

The "Project Structure" section (lines 54–85) references `keycloak/` directory and `DEVELOPMENT.md` — the `keycloak/` reference is still valid; `DEVELOPMENT.md` reference should become `SETUP.md`.

Line 122: "See [DEVELOPMENT.md § Production deployment]" — update to reference SETUP.md or remove.

**Keep:** Features list, Tech Stack table, Project Structure, API table, Running Tests section, License.

**Add:** Prerequisites section (Docker Desktop, Node.js 22+, Terraform >= 1.0, optionally gh CLI).

[VERIFIED: README.md read directly]

## docs/ Directory Status

The `docs/` directory does NOT exist. Both `docs/security/rfc9700-checklist.md` and `docs/use-cases.md` must be created from scratch, including the directory structure.

[VERIFIED: Bash `ls docs/` returned DOES_NOT_EXIST]

## Existing E2E Specs (for DOC-03 use-cases.md table)

The following spec files exist in `tests/e2e/`:

| Spec File | Coverage Area |
|-----------|---------------|
| `auth.spec.ts` | Login / logout flow |
| `passkeys.spec.ts` | Passkey registration + authentication |
| `otp.spec.ts` | OTP email verification flow |
| `session-management.spec.ts` | Session expiry, refresh |
| `trips.spec.ts` | Trip CRUD operations |
| `trip-edit.spec.ts` | Trip editing UI |
| `trip-edit-integration.spec.ts` | Trip edit integration (currently ROPC — Phase 14 scope) |
| `public-sharing.spec.ts` | Public trip sharing |
| `search.spec.ts` | Global search |
| `geocoder.spec.ts` | Geocoder widget |
| `landing.spec.ts` | Landing page |
| `city-pages.spec.ts` | City itinerary pages |
| `pwa.spec.ts` | PWA install/offline |
| `ui-consistency.spec.ts` | Visual consistency |
| `accessibility.spec.ts` | A11y checks |
| `idp-theme.spec.ts` | KC login page theme |
| `api.spec.ts` | Backend API integration (including new SEC-05 block) |

**Flows to enumerate in use-cases.md** (per D-17 columns: `User Action | E2E Spec | Coverage Status`):
- Login with password → auth.spec.ts → Full
- Login with passkey → passkeys.spec.ts → Full
- Register passkey → passkeys.spec.ts → Full
- OTP email verification → otp.spec.ts → Full
- Create trip → trips.spec.ts → Full/Partial (verify)
- Add destination → trips.spec.ts / trip-edit.spec.ts → TBD
- Add hotel → trip-edit.spec.ts → TBD
- Add day/activities → trip-edit.spec.ts → TBD
- Edit trip metadata → trip-edit-integration.spec.ts → Partial (ROPC)
- Delete trip → trips.spec.ts → TBD
- View trip on map → trips.spec.ts → TBD
- Global search → search.spec.ts → Full
- Public sharing → public-sharing.spec.ts → Full
- Empty state (no trips) → None → None (Phase 14 gap)
- New user creation E2E → None → None (Phase 14 gap)

[VERIFIED: Glob of tests/e2e/*.spec.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP response headers | Custom header-injection logic | `c.header()` built into Hono | Standard Hono API; `c.res.headers.set()` also works but `c.header()` is idiomatic |
| JWT audience validation | Custom aud comparison | Existing `validateAudience()` in keycloak.ts | Already handles string and array forms per RFC |
| KC token fetch | New library | Raw `fetch()` to token endpoint | One-time test use; no library needed |

## Common Pitfalls

### Pitfall 1: Hono Header Setting — Before vs After `next()`

**What goes wrong:** Setting response headers BEFORE `await next()` in a Hono middleware — headers set before `next()` are request headers, not response headers.

**Why it happens:** Express-style muscle memory.

**How to avoid:** Always call `await next()` first in middleware that sets response headers. Pattern: `async (c, next) => { await next(); c.header(...); }`.

**Warning signs:** Headers appear on some responses but not others; `curl -I` shows headers missing.

### Pitfall 2: sec-05 test — Backend must be running

**What goes wrong:** The SEC-05 test fails with network error if backend is not running; unlike browser tests, there's no mocking.

**How to avoid:** Add the `isBackendRunning()` guard and `test.skip()` pattern identical to existing api.spec.ts tests (lines 18–22).

### Pitfall 3: Treating `japan-trip-worker` as `kc-admin-worker`

**What goes wrong:** The CONTEXT.md and discussion refer to "kc-admin-worker" but the actual Terraform resource and client_id is `japan-trip-worker`. Using the wrong client_id in the SEC-05 test causes a 401 from Keycloak (client not found), not a 401 from the backend.

**How to avoid:** Use `process.env.KC_ADMIN_CLIENT_ID` (already in test env, already points to `japan-trip-worker`).

### Pitfall 4: Creating docs/security/ without the parent docs/

**What goes wrong:** `mkdir docs/security/` fails if `docs/` doesn't exist.

**How to avoid:** `mkdir -p docs/security/` or create `docs/` first. File-writing tools handle this automatically if given the full path.

### Pitfall 5: JWKS retry double-invalidation

**What goes wrong:** The retry implementation invalidates `jwksCache` inside the retry block, then `getKeycloakJwks()` itself also checks the cache. If the retry code sets `jwksCache = null` then calls `getKeycloakJwks()`, the function will correctly re-fetch. But if the retry code calls `getKeycloakJwks()` WITHOUT first setting `jwksCache = null`, the 1-hour TTL check will return the stale cache.

**How to avoid:** Always set `jwksCache = null` before calling `getKeycloakJwks()` in the retry path. The kid-not-found retry at lines 215–216 already does this correctly — follow the same pattern.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.8 (backend unit tests) |
| Config file | none — `vitest run` from backend/ directory (via `npm test` in backend/package.json) |
| Quick run command | `cd backend && npm test` |
| Full suite command | `cd backend && npm test` |
| E2E framework | Playwright (tests/playwright.config.ts) |
| E2E run command | `cd tests && npx playwright test e2e/api.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-02 | JWKS retry on signature failure invokes re-fetch and succeeds | unit | `cd backend && npm test -- keycloak` | ✅ `backend/src/auth/keycloak.test.ts` |
| SEC-04 | Security headers present on Hono response | unit | `cd backend && npm test -- index` | ✅ `backend/src/index.test.ts` |
| SEC-05 | Worker token (aud=account) returns 401 from /api/trips | E2E | `cd tests && npx playwright test e2e/api.spec.ts` | ✅ (test added to existing file) |
| SEC-01 | rfc9700-checklist.md exists and is non-empty | manual/smoke | `test -f docs/security/rfc9700-checklist.md` | ❌ create |
| DOC-01 | README.md no longer contains `cd keycloak && docker compose up -d` | smoke | `grep -c "docker compose up" README.md` returns 0 | ✅ (verify after edit) |
| DOC-02 | SETUP.md exists and contains terraform apply instructions | manual/smoke | `test -f SETUP.md` | ❌ create |
| DOC-03 | docs/use-cases.md exists with table | manual/smoke | `test -f docs/use-cases.md` | ❌ create |
| DEVENV-03 | README contains prerequisites section | manual | Read README.md | ✅ (verify after edit) |

### Sampling Rate

- **Per task commit:** `cd backend && npm test` (unit tests, < 10 seconds)
- **Per wave merge:** `cd backend && npm test && cd tests && npx playwright test e2e/api.spec.ts`
- **Phase gate:** All unit tests green + SEC-05 E2E passing + `curl -I http://localhost:8787/api/health` shows security headers

### Wave 0 Gaps

- [ ] `backend/src/middleware/security.test.ts` — test that securityMiddleware sets all three headers (or verify via `backend/src/index.test.ts`)

Existing test infrastructure covers keycloak.test.ts for SEC-02 unit test — a new test case for the retry behavior should be added to the existing file, not a new file.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Keycloak PKCE + KC JWKS verification |
| V3 Session Management | yes | KC session tokens; storageState for tests |
| V4 Access Control | yes | `validateAudience()` in keycloak.ts |
| V5 Input Validation | yes | Zod validators on routes (existing) |
| V6 Cryptography | yes | Web Crypto API `crypto.subtle.verify` — never hand-rolled |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| JWT with wrong audience accepted | Elevation of Privilege | `validateAudience()` in keycloak.ts + SEC-05 test |
| Stale JWKS after key rotation causing valid tokens to be rejected | Denial of Service | JWKS retry (SEC-02 implementation) |
| Clickjacking via iframe embedding | Tampering | `X-Frame-Options: DENY` (SEC-04) |
| XSS via injected scripts from API responses | Tampering | `Content-Security-Policy: default-src 'none'` (SEC-04) |
| HTTPS downgrade / mixed content | Information Disclosure | `Strict-Transport-Security` (SEC-04) |

## Environment Availability

| Dependency | Required By | Available | Fallback |
|------------|------------|-----------|---------|
| Keycloak (localhost:8080) | SEC-05 E2E test | Runtime (not checked at research time) | `test.skip` guard already in api.spec.ts pattern |
| Backend (localhost:8787) | SEC-05 E2E test | Runtime | `isBackendRunning()` guard |
| terraform/keycloak state | D-14 verification | ✅ (main.tf read) | N/A |

Step 2.6: External tooling deps are all runtime services already guarded by skip patterns in existing tests. No new installation steps needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `KC_ADMIN_CLIENT_ID` env var in tests/.env.test points to `japan-trip-worker` | SEC-05 pattern | Test would use wrong client; verify against tests/.env.test before implementing |
| A2 | Keycloak 25 default behavior issues tokens with `aud: account` for service accounts without an audience mapper | D-14 | If KC version differs, tokens might include additional audiences; verify by decoding a live token |

## Open Questions

1. **Referrer-Policy header scope**
   - What we know: RFC 9700 section 4.2.4 recommends suppressing Referer headers; the three headers in D-01/D-02 don't include Referrer-Policy
   - What's unclear: D-03 says "all three headers applied unconditionally" — is adding Referrer-Policy within scope or not?
   - Recommendation: Add `Referrer-Policy: no-referrer` to security.ts as a 4th header (within Claude's Discretion for exact CSP directives); document it as part of the RFC 9700 checklist; costs nothing

2. **SETUP.md env var list**
   - What we know: D-16 mentions KEYCLOAK_URL, KEYCLOAK_REALM, VALID_AUDIENCES, DATABASE_URL; D-62 (Claude's Discretion) says "which additional env vars to document"
   - What's unclear: Does `.env.example` exist? What are all required env vars?
   - Recommendation: Read `.env.example` if it exists; otherwise read `backend/src/types/index.ts` for the `Env` interface to enumerate all required bindings

## Sources

### Primary (HIGH confidence — codebase verified)
- `backend/src/auth/keycloak.ts` — JWKS fetch, caching, kid-not-found retry (lines 99–141), signature verification (lines 223–237)
- `backend/src/middleware/cors.ts` — middleware export pattern
- `backend/src/middleware/auth.ts` — async middleware pattern with `await next()`
- `backend/src/index.ts` — middleware registration order
- `terraform/keycloak/main.tf` — kc-admin-worker (actually `japan-trip-worker`) client definition; audience mapper on frontend client only
- `tests/e2e/api.spec.ts` — existing test patterns, isBackendRunning guard
- `tests/e2e/fixtures/kc-admin.ts` — client_credentials auth pattern via KcAdminClient
- `tests/global-setup.ts` — OIDC PKCE auth setup
- `README.md` — current content (126 lines)
- `docs/` — does not exist (Bash ls confirmed)

### Secondary (MEDIUM confidence — official source)
- RFC 9700 — fetched from rfc-editor.org — full control enumeration

## Metadata

**Confidence breakdown:**
- D-07 JWKS gap analysis: HIGH — code read directly; analysis grounded in actual lines
- D-14 audience verification: HIGH — Terraform read directly; no audience mapper on worker client
- Middleware pattern: HIGH — cors.ts and auth.ts read directly
- RFC 9700 controls: HIGH — RFC fetched directly; mapping to codebase grounded in verified code
- SEC-05 token fetch pattern: HIGH — kc-admin.ts pattern read directly

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (stable codebase; RFC 9700 is stable)
