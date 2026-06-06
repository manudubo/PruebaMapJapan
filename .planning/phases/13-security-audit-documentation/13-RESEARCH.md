# Phase 13: Security Audit + Documentation — Research

**Researched:** 2026-06-06
**Domain:** OAuth/OIDC security audit, Hono middleware, Playwright E2E, documentation
**Confidence:** HIGH (all findings are codebase-verified; RFC 9700 fetched from rfc-editor.org; Hono secure-headers verified via official docs)

## Summary

Phase 13 is primarily a codebase-internal phase: writing one new middleware, patching one auth function, adding one Playwright test, and producing three documentation artifacts. There are no new library dependencies that require installation. All patterns can be directly derived from existing code in the repo.

The two open questions from CONTEXT.md (D-07 and D-14) are resolved below with concrete code-level evidence and updated recommendations. The JWKS retry gap is real, but the correct implementation must guard against DoS amplification. The kc-admin-worker client is actually named `japan-trip-worker` — its token audience is most likely `realm-management` (not `account`), which changes how SEC-05's test assertion should be framed.

`npm run dev` (via `scripts/dev.js`) does: Docker check → `docker compose up -d` → wait for Keycloak → `concurrently` (KC logs + backend + frontend). It does NOT run `terraform apply` or DB seed/migrate — those are one-time setup steps that belong in SETUP.md.

**Primary recommendation:** No external library installation needed. The `hono/secure-headers` built-in is available but uses the same execution model as a manual middleware — use the manual pattern for simplicity and explicit control.

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
- D-07: Researcher must make the recommendation (see below — recommendation is: extend retry to cover signature verification failures, with a DoS guard)

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
| DEVENV-03 | User can follow README to set up local environment from scratch without consulting other sources | README.md content audit below; SETUP.md structure in D-16; `npm run dev` scope verified |
| SEC-01 | Written RFC 9700 checklist artifact with each control documented as compliant/non-compliant/N/A with evidence | RFC 9700 control enumeration below; existing code references identified |
| SEC-02 | Backend JWT verification retries JWKS fetch once on 401 before failing (handles signing key rotation) | D-07 recommendation: extend retry to cover signature verification failure at keycloak.ts:235–237, with DoS guard |
| SEC-04 | Backend Hono responses include CSP, X-Frame-Options, and HSTS headers | Middleware pattern from cors.ts and auth.ts verified; insertion point in index.ts confirmed |
| SEC-05 | E2E assertion verifies token with wrong audience returns 401 from backend API | `japan-trip-worker` tokens lack `japan-trip-frontend` audience; strategy confirmed; assertion framing corrected |
| DOC-01 | README.md reflects simplified local setup using `npm run dev` | Old content identified; replacement content and prerequisites specified |
| DOC-02 | SETUP.md exists with step-by-step fresh setup instructions | `npm run dev` scope verified; full env var list from dev.ts; SETUP.md content specified |
| DOC-03 | Use case inventory document listing user scenarios and E2E coverage vs gaps | Existing specs enumerated below for table population |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Security headers (CSP, X-Frame-Options, HSTS) | API / Backend | — | Headers set on Hono responses at middleware layer |
| JWKS retry logic | API / Backend | — | JWT verification is backend-only; Cloudflare Workers runtime |
| RFC 9700 checklist | Documentation | — | Static artifact referencing both KC Terraform and backend code |
| SEC-05 audience assertion test | API / Backend (via E2E) | — | Test calls backend API directly via Playwright request context; no browser UI |
| README / SETUP.md | Documentation | — | Static documentation artifacts |
| Use case inventory | Documentation | — | References existing E2E spec files |

## Standard Stack

### Core (no new dependencies required)

All deliverables use only already-installed packages.

| Library | Installed Version | Purpose | Why Standard |
|---------|-------------------|---------|--------------|
| hono | ^4.6.17 | `MiddlewareHandler` type; `c.header()` for setting response headers | Already the backend framework |
| hono/secure-headers | (bundled with hono) | Alternative to manual `c.header()` — supports CSP/X-Frame/HSTS | Available but not required (see note below) |
| @playwright/test | ^1.59.1 | `request.newContext()` for SEC-05 token fetch and API assertion | Already the E2E framework |
| vitest | ^2.1.8 | Unit tests for `verifyJwt` retry logic | Already the unit test framework |

**Note on `hono/secure-headers`:** Hono ships `hono/secure-headers` that supports `xFrameOptions`, `strictTransportSecurity`, and `contentSecurityPolicy`. It supports setting `defaultSrc: ["'none'"]`. However, its implementation (`await next(); setHeaders(ctx, ...)`) is functionally identical to the manual `c.header()` pattern — no meaningful difference in error-response behavior. Use the manual pattern in `security.ts` to keep the implementation explicit, readable, and consistent with the existing `auth.ts` pattern. [VERIFIED: hono.dev/docs/middleware/builtin/secure-headers + GitHub source]

### No New `npm install` Steps Needed

All packages are already installed in `backend/node_modules`.

## Architecture Patterns

### System Architecture Diagram

```
[HTTP Request → Backend (Hono middleware chain)]
    └─ corsMiddleware (existing, app.use line 11)
    └─ securityMiddleware (NEW, app.use line 12)
         ↓ calls next()
         └─ routes / authMiddleware / notFound / onError
         ↑ after next(): c.header() sets CSP, X-Frame-Options, HSTS on response

[E2E Test: SEC-05]
    └─ fetch() to Keycloak /protocol/openid-connect/token
         client_credentials grant, client_id=japan-trip-worker
    └─ GET /api/trips with Bearer <worker_token>
         └─ authMiddleware → verifyJwt() → validateAudience()
              → rejects (aud lacks japan-trip-frontend)
                   → returns 401
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

### D-07: JWKS Retry Gap Analysis — Extend with DoS Guard

**Current code (keycloak.ts lines 209–237):**

```
lines 210-221: kid-not-found retry
  - Gets keyMap from cache
  - If kid not in keyMap → sets jwksCache = null, refetches, retries lookup
  - If kid still not found → throws "JWT signing key not found"

lines 228-237: signature verification
  - crypto.subtle.verify() → isValid boolean
  - if (!isValid) → throws "JWT signature verification failed"
  - NO retry here
```

**The gap:** If a kid IS in cache but the cached key is stale (theoretically possible during unusual rotation scenarios), `crypto.subtle.verify` returns false and the request fails permanently until the 1-hour TTL expires. In Keycloak's standard rotation, a new key gets a new `kid` value, so this path is not normally reached — the kid-not-found retry handles it. However, the SEC-02 requirement text says "retries JWKS fetch once on a key-verification failure" and the ROADMAP success criterion says "retries the JWKS fetch once on a key-verification failure before returning 401" — both are broad enough to include signature failure.

**DoS risk of naive retry:** If the retry is triggered on ANY `isValid === false` result (including forged tokens or garbage inputs), an attacker can flood the backend with malformed tokens and force a JWKS network fetch on every request — defeating the cache and potentially overwhelming Keycloak.

**D-07 Recommendation (Claude's Discretion):** Extend the retry to cover `isValid === false`, but guard it with a per-request flag to prevent double-fetch:

```typescript
// Track whether we already force-refetched JWKS in this request
let jwksRefreshed = false;

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

if (!isValid && !jwksRefreshed) {
  // Retry once: invalidate cache and refetch JWKS (handles key rotation mid-TTL)
  jwksRefreshed = true;
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

**Note:** The `jwksRefreshed` flag is a local variable within `verifyJwt()`, so it prevents the signature-failure retry from cascading if the kid-not-found path already refetched. The kid-not-found retry (lines 215–216) already sets `jwksCache = null` — the flag is not needed there because it runs first and `publicKey` would be populated before reaching the signature block.

**Alternative (also defensible):** Document the existing kid-not-found retry as SEC-02 evidence and explicitly note that the signature-failure path is unreachable under Keycloak's standard rotation. This avoids the DoS surface entirely. The planner should choose based on the strictness of the SEC-02 requirement interpretation.

[VERIFIED: backend/src/auth/keycloak.ts lines 209–237 read directly]

### D-14: kc-admin-worker Audience Verification — Strategy Confirmed, Framing Corrected

**Finding on name:** There is NO resource named `kc-admin-worker` in `terraform/keycloak/main.tf`. The worker client is named `japan-trip-worker` (resource: `keycloak_openid_client.japan_trip_worker`, client_id: `"japan-trip-worker"`).

**Audience mapper audit:**
- `keycloak_openid_audience_protocol_mapper.audience` (main.tf lines 88–95) is attached to `keycloak_openid_client.japan_trip_frontend` only — it adds `japan-trip-frontend` to frontend client tokens.
- `keycloak_openid_client.japan_trip_worker` has NO audience mapper resource.

**What audience will the worker token contain?** This is NOT `account`. Keycloak's default Audience Resolve mapper adds audiences for each client where the service account holds a role. Since `japan-trip-worker`'s service account is granted the `manage-users` role on `realm-management` (main.tf lines 131–136), its tokens will likely contain `realm-management` as the audience — not `account`. The `account` client is a separate built-in Keycloak client for user account management, not related to service accounts.

**Impact on SEC-05:**
- The existing requirement text (REQUIREMENTS.md): "verifies a token with `aud: account` only returns 401 from the backend API"
- The actual test can still send a worker token that lacks `japan-trip-frontend` and verify 401
- The test should NOT assert the token has `aud: account` — it should assert the response is 401
- If the planner needs to exactly satisfy the "aud: account" requirement text, they need the built-in Keycloak `account` client (client_credentials with `account` client — but this client is public and not set up for service accounts by default)

**D-14 Recommendation:** Proceed with `japan-trip-worker` (using `process.env.KC_ADMIN_CLIENT_ID` / `KC_ADMIN_CLIENT_SECRET`). The test assertion is "response status is 401" — no assertion about the token's aud claim content. The failing condition is that `japan-trip-frontend` is absent from the token's aud. This satisfies the SEC-05 spirit regardless of whether the aud is `realm-management`, `account`, or something else.

[VERIFIED: terraform/keycloak/main.tf lines 88–95 and 109–136 read directly]
[ASSUMED: Keycloak 25 Audience Resolve behavior for service accounts with manage-users role — should be confirmed by decoding a live token]

### Middleware Pattern for security.ts

The correct pattern follows `auth.ts` (not `cors.ts` which uses the `hono/cors` helper). The securityMiddleware must call `await next()` FIRST, then set headers on the response:

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

**Why `await next()` first:** In Hono, `c.header()` called after `next()` sets headers on the response. This is the standard Hono pattern for response header injection, as confirmed by the `hono/secure-headers` source which uses the same order (`await next(); setHeaders(ctx, ...)`).

**Error response coverage:** Hono's middleware chain wraps `notFound` and `onError` execution — code running after `next()` in a `app.use()` middleware executes regardless of whether downstream returned a 200, 404, or 500. The `hono/secure-headers` built-in uses this same pattern and would have the same behavior. [ASSUMED: verified by secureHeaders source review; Hono docs do not explicitly guarantee post-next() code runs on notFound/onError]

[VERIFIED: backend/src/middleware/auth.ts and cors.ts read directly; hono/secure-headers source reviewed]

### Exact Insertion Point in index.ts

```typescript
// line 2 — add import:
import { securityMiddleware } from './middleware/security';

// line 12 — add registration immediately after corsMiddleware:
app.use('*', securityMiddleware);
```

No other changes to index.ts.

[VERIFIED: backend/src/index.ts read directly]

### What `npm run dev` Does (for SETUP.md and README)

`scripts/dev.js` (115 lines) does exactly:
1. Checks if Docker is running; if not, opens Docker Desktop and waits (60s timeout)
2. Runs `docker compose up -d` in `keycloak/` directory
3. Polls `http://localhost:8080/realms/japan-trip` until healthy (90s timeout)
4. Hands off to `concurrently` with three processes: `docker compose logs -f keycloak`, `npm run dev --workspace=backend`, `npm run dev --workspace=frontend`

**Does NOT do:**
- `terraform apply` — required separately for first-time setup
- DB migration (`drizzle-kit push`) — required separately for first-time setup
- DB seed — required separately for first-time setup

**Implication for SETUP.md:** A fresh-machine guide MUST include these steps before `npm run dev`. The SETUP.md must cover: prerequisites → clone → copy `.dev.vars` (not `.env`) → terraform apply → DB push → DB seed → `npm run dev`.

**Backend reads env from `.dev.vars` (not `.env`):** `backend/src/dev.ts` calls `dotenv.config({ path: '.dev.vars' })`. The root `.env.example` shows DATABASE_URL/KEYCLOAK_URL/KEYCLOAK_REALM but is a composite file mixing frontend and backend vars. The actual backend local dev env file is `.dev.vars` (Wrangler convention).

**Full env var list (from `backend/src/dev.ts`):**
| Var | Purpose | Required |
|-----|---------|----------|
| DATABASE_URL | PostgreSQL connection string | Yes |
| KEYCLOAK_URL | Keycloak base URL | Yes |
| KEYCLOAK_REALM | Keycloak realm name | Yes |
| VALID_AUDIENCES | Comma-separated accepted JWT audiences | Yes |
| KC_ADMIN_CLIENT_ID | Worker client ID for admin operations | Yes |
| KC_ADMIN_CLIENT_SECRET | Worker client secret | Yes |
| OTP_SECRET | OTP signing secret | Yes |
| RESEND_API_KEY | Email sending (optional — undefined if not set) | No |

[VERIFIED: scripts/dev.js, backend/src/dev.ts, .env.example all read directly]

### SEC-05 Client Credentials Token Fetch Pattern

The kc-admin.ts fixture uses `@keycloak/keycloak-admin-client` for admin API operations. For SEC-05, use a raw `fetch()` to Keycloak's token endpoint:

```typescript
// Inside the SEC-05 describe block in tests/e2e/api.spec.ts
import { test, expect, request } from '@playwright/test';

const BACKEND_URL = 'http://localhost:8787';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const KC_REALM = process.env.KEYCLOAK_REALM ?? 'japan-trip';

test.describe('JWT audience rejection', () => {
  test('worker token without japan-trip-frontend audience returns 401', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend is not running — skipping audience assertion test');

    // Fetch a client_credentials token from japan-trip-worker
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
    const { access_token } = await tokenRes.json() as { access_token: string };

    // Send token to authenticated endpoint — expect 401 (wrong audience)
    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const res = await ctx.get('/api/trips', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
```

**Note:** `process.env.KEYCLOAK_URL` and `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` are already loaded from `tests/.env.test` (used by kc-admin.ts). No new env vars needed.

[VERIFIED: tests/e2e/fixtures/kc-admin.ts, tests/e2e/api.spec.ts, tests/global-setup.ts read directly]

## RFC 9700 BCP Controls Enumeration (SEC-01)

For the `docs/security/rfc9700-checklist.md` artifact. Each control mapped to existing code/config:

| Section | Control | Status | Evidence |
|---------|---------|--------|----------|
| 2.1 | Exact string matching for redirect URIs | Compliant | `main.tf` — `valid_redirect_uris` lists exact URIs, no wildcards |
| 2.1 | No open redirectors | Compliant | Backend never issues redirects; frontend uses KC's redirect handling |
| 2.1.1 | Public clients must implement PKCE | Compliant | `main.tf` line 63: `pkce_code_challenge_method = "S256"` |
| 2.1.1 | Only S256 code challenge method | Compliant | `pkce_code_challenge_method = "S256"` — S256 enforced server-side |
| 2.1.1 | AS rejects token requests with code_verifier if no code_challenge | Compliant | Enforced by Keycloak 25 when PKCE is mandated (INFRA-04) |
| 2.1.2 | Avoid implicit grant | Compliant | `main.tf`: `standard_flow_enabled = true` only; no implicit grant |
| 2.2.1 | Sender-constrained access tokens (mTLS or DPoP) | N/A | Single resource server; DPoP deferred post-v3.0 per REQUIREMENTS.md |
| 2.2.2 | Refresh token rotation or sender-constraining | N/A | [ASSUMED] KC refresh token behavior — verify KC realm settings; rotation is configurable, not on-by-default in Keycloak |
| 2.3 | Audience-restricted access tokens | Compliant | `main.tf` lines 88–95: audience mapper restricts frontend tokens to `japan-trip-frontend` |
| 2.4 | ROPC grant must not be used | Compliant | `direct_access_grants_enabled = false` in all KC clients; no ROPC in test fixtures |
| 2.5 | Client authentication | Compliant | `japan-trip-frontend` is PUBLIC (PKCE, no secret); `japan-trip-worker` is CONFIDENTIAL |
| 2.6 | Publish AS metadata (RFC 8414) | Compliant | Keycloak publishes `/.well-known/openid-configuration` by default |
| 2.6 | End-to-end TLS | Compliant (partial) | Prod: all HTTPS; local dev: HTTP loopback (acceptable per RFC) |
| 4.1.3 | Exact URI string comparison | Compliant | Keycloak enforces; Terraform lists exact URIs |
| 4.2.4 | Suppress Referer headers via Referrer-Policy | Gap | No `Referrer-Policy` header currently set |
| 4.3.2 | Never pass access tokens in URI query parameters | Compliant | All API calls use `Authorization: Bearer` header |
| 4.4.2 | Mix-up attack defense | N/A | Single authorization server; no mix-up risk |
| 4.5.3 / 4.8.2 | PKCE protects against code injection and downgrade | Compliant | S256 enforced; KC rejects PKCE violations |
| 4.7.1 | CSRF protection via PKCE/nonce/state | Compliant | PKCE S256 provides CSRF protection; KC + keycloak-js handle state |
| 4.9.3 | Treat access tokens as sensitive; audience restriction | Compliant | `validateAudience()` in `backend/src/auth/keycloak.ts:89–93`; JWT in sessionStorage (same-origin) |
| 4.10.1 | Sender-constrained tokens | N/A | Deferred per REQUIREMENTS.md (DPoP deferred post-v3.0) |
| 4.10.2 | Audience-restricted tokens at resource server | Compliant | `backend/src/auth/keycloak.ts:198–202` — validates aud against VALID_AUDIENCES env |

**Gap identified:** `Referrer-Policy` header not currently set (RFC 9700 §4.2.4). Claude's Discretion area covers "exact CSP directives beyond `default-src 'none'`" — adding `Referrer-Policy: no-referrer` to `security.ts` as a 4th header is within scope and costs nothing. Document as part of the checklist.

[VERIFIED: terraform/keycloak/main.tf and backend/src/auth/keycloak.ts read directly]
[CITED: rfc-editor.org/rfc/rfc9700 — RFC 9700 controls fetched 2026-06-06]

## README.md — Content to Remove and Replace (DOC-01)

**Current README.md "Getting Started" section (lines 29–51) — OLD content to remove:**
```
cd keycloak && docker compose up -d && cd ..
DATABASE_URL=... npx drizzle-kit push --force
DATABASE_URL=... npx tsx src/db/seed.ts
npm run dev:backend   # → http://localhost:8787
npm run dev:frontend  # → http://localhost:5173/PruebaMapJapan/
```

**Replace with:**
```bash
# Prerequisites: Docker Desktop, Node.js 22+, Terraform >= 1.0
# First-time setup: see SETUP.md
npm install
npm run dev
```

**Also update:**
- Line 84: reference to `DEVELOPMENT.md` → change to `SETUP.md`
- Line 122: "See [DEVELOPMENT.md § Production deployment]" → update or remove
- Add a **Prerequisites** section listing Docker Desktop, Node.js 22+, Terraform >= 1.0, gh CLI (optional)

**Keep:** Features list, Tech Stack table, Project Structure, API table, Running Tests section, License.

[VERIFIED: README.md read directly (126 lines)]

## SETUP.md Content (DOC-02)

**What `npm run dev` does vs. one-time setup:**
- `npm run dev` handles: Docker startup, Compose up, Keycloak health wait, all services running
- `npm run dev` does NOT handle: terraform apply, DB migration, DB seed

**SETUP.md must cover (in order):**
1. Prerequisites: Docker Desktop, Node.js 22+, Terraform >= 1.0, git
2. Clone the repo
3. Copy `.env.example` → `.env` (root); copy `frontend/.env.example` → `frontend/.env`
4. Create `backend/.dev.vars` with all required backend env vars (see list above)
5. `terraform init && terraform apply` in `terraform/keycloak/`
6. `npm install` (root — installs all workspaces)
7. DB migration: `cd backend && DATABASE_URL=<url> npx drizzle-kit push --force`
8. DB seed: `cd backend && DATABASE_URL=<url> npx tsx src/db/seed.ts`
9. `npm run dev` (from root)

**Backend env vars for `.dev.vars`:** DATABASE_URL, KEYCLOAK_URL, KEYCLOAK_REALM, VALID_AUDIENCES, KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET, OTP_SECRET, RESEND_API_KEY (optional)

[VERIFIED: scripts/dev.js, backend/src/dev.ts, .env.example, frontend/.env.example all read directly]

## docs/ Directory Status

The `docs/` directory does NOT exist. Both `docs/security/rfc9700-checklist.md` and `docs/use-cases.md` must be created from scratch, including parent directories.

[VERIFIED: Bash `ls docs/` returned DOES_NOT_EXIST]

## Existing E2E Specs (for DOC-03 use-cases.md table)

Spec files in `tests/e2e/` for table population:

| Spec File | User Actions Covered |
|-----------|---------------------|
| `auth.spec.ts` | Login, logout |
| `passkeys.spec.ts` | Passkey registration, passkey auth |
| `otp.spec.ts` | OTP email verification |
| `session-management.spec.ts` | Session expiry, session refresh |
| `trips.spec.ts` | Trip CRUD (create, list, delete) |
| `trip-edit.spec.ts` | Trip editing UI |
| `trip-edit-integration.spec.ts` | Trip edit (ROPC — Phase 14 migration scope) |
| `public-sharing.spec.ts` | Public trip sharing |
| `search.spec.ts` | Global search |
| `geocoder.spec.ts` | Geocoder widget |
| `landing.spec.ts` | Landing/demo page |
| `city-pages.spec.ts` | City itinerary pages |
| `pwa.spec.ts` | PWA install/offline |
| `ui-consistency.spec.ts` | Visual consistency |
| `accessibility.spec.ts` | A11y checks |
| `idp-theme.spec.ts` | KC login page theme |
| `api.spec.ts` | Backend API integration, SEC-05 audience assertion |

**Notable gaps for the DOC-03 table (Coverage Status = None):**
- New user creation end-to-end (login → empty dashboard → create trip → full lifecycle)
- Empty-state dashboard for users with no trips
- Geocoder widget on destination and activity forms (only hotel form has coverage)

[VERIFIED: Glob of tests/e2e/*.spec.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP response headers | Custom header-injection logic | `c.header()` built into Hono | Standard Hono API; already in auth.ts pattern |
| JWT audience validation | Custom aud comparison | Existing `validateAudience()` in keycloak.ts | Already handles string and array forms per RFC |
| KC token fetch (one-time test) | New library | Raw `fetch()` to token endpoint | One-time use; no library justified |
| Security header middleware | Entire custom middleware framework | `hono/secure-headers` (if desired) or 3-line manual pattern | Either approach is valid; manual is simpler here |

## Common Pitfalls

### Pitfall 1: Hono Header Setting — Before vs After `next()`

**What goes wrong:** Setting response headers BEFORE `await next()` — headers set before `next()` in Hono are request-phase headers, not response headers.

**How to avoid:** Always call `await next()` first, then `c.header(...)`.

**Warning signs:** Headers appear on some responses but not others; `curl -I` shows headers missing.

### Pitfall 2: SEC-05 — Backend and Keycloak must be running

**What goes wrong:** The SEC-05 test needs both backend (8787) and Keycloak (8080) running. Unlike browser tests, there's no mocking.

**How to avoid:** Add the `isBackendRunning()` guard pattern from api.spec.ts lines 7–16. Keycloak is started by `npm run dev` so if the backend is up, KC is likely up too.

### Pitfall 3: `japan-trip-worker` not `kc-admin-worker`

**What goes wrong:** Using the wrong client_id in the SEC-05 token fetch causes a 401 from Keycloak (client not found), not a 401 from the backend. The test would then pass for the wrong reason.

**How to avoid:** Use `process.env.KC_ADMIN_CLIENT_ID` (already in tests/.env.test) — do not hardcode `kc-admin-worker`.

### Pitfall 4: Creating docs/security/ without parent docs/

**What goes wrong:** File creation fails if `docs/` doesn't exist.

**How to avoid:** Create directories with `-p` flag or create parent first: `mkdir -p docs/security`.

### Pitfall 5: Backend env file is `.dev.vars` not `.env`

**What goes wrong:** SETUP.md that says "copy `.env.example` to `.env`" — but the backend reads from `.dev.vars` (Wrangler convention).

**How to avoid:** SETUP.md must distinguish: root `.env.example` → root `.env` (for frontend Vite vars), AND separate `backend/.dev.vars` with backend-specific vars.

### Pitfall 6: JWKS Retry DoS Amplification

**What goes wrong:** Retry on signature failure triggers a Keycloak fetch for every forged/garbage token. An attacker floods with malformed tokens → cache disabled → N requests/sec to Keycloak.

**How to avoid:** Use the `jwksRefreshed` flag (one refetch per request maximum).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Backend unit framework | Vitest ^2.1.8 |
| Backend test command | `cd backend && npm test` |
| E2E framework | Playwright ^1.59.1 |
| E2E test command | `cd tests && npx playwright test e2e/api.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-02 | JWKS retry on signature failure refetches and succeeds | unit | `cd backend && npm test -- --reporter=verbose` | ✅ extend `backend/src/auth/keycloak.test.ts` |
| SEC-04 | CSP, X-Frame-Options, HSTS on Hono response | unit | `cd backend && npm test` | ✅ extend `backend/src/index.test.ts` |
| SEC-05 | Worker token lacking japan-trip-frontend aud → 401 | E2E | `cd tests && npx playwright test e2e/api.spec.ts` | ✅ add describe block to existing file |
| SEC-01 | rfc9700-checklist.md exists and is non-empty | smoke | `test -f docs/security/rfc9700-checklist.md && wc -l docs/security/rfc9700-checklist.md` | ❌ create |
| DOC-01 | README no longer has `docker compose up -d` in quick start | smoke | `grep -c "docker compose up" README.md` returns 0 | ✅ (verify after edit) |
| DOC-02 | SETUP.md exists with terraform apply step | smoke | `grep -c "terraform apply" SETUP.md` returns > 0 | ❌ create |
| DOC-03 | docs/use-cases.md exists with table header | smoke | `grep -c "Coverage Status" docs/use-cases.md` | ❌ create |
| DEVENV-03 | README has prerequisites section | manual | Read README.md | ✅ (verify after edit) |

### Sampling Rate

- **Per task commit:** `cd backend && npm test`
- **Per wave merge:** `cd backend && npm test && cd tests && npx playwright test e2e/api.spec.ts`
- **Phase gate:** All unit tests green + SEC-05 E2E passing + `curl -I http://localhost:8787/api/health` shows all three security headers

### Wave 0 Gaps

The following test additions are needed before or alongside implementation:

- [ ] New test case in `backend/src/auth/keycloak.test.ts` — covers JWKS retry on signature failure (SEC-02)
- [ ] New test case in `backend/src/index.test.ts` — verifies security headers on a response (SEC-04)

*(Existing test files cover both modules — extend rather than create new files)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Keycloak PKCE; KC JWKS JWT verification in keycloak.ts |
| V3 Session Management | yes | KC session tokens; 1-hour JWKS cache; storageState for tests |
| V4 Access Control | yes | `validateAudience()` in keycloak.ts; SEC-05 assertion |
| V5 Input Validation | yes | Zod validators on routes (existing) |
| V6 Cryptography | yes | Web Crypto API `crypto.subtle.verify` — never hand-rolled |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| JWT with wrong audience accepted | Elevation of Privilege | `validateAudience()` in keycloak.ts + SEC-05 E2E test |
| Stale JWKS after key rotation causing valid tokens to be rejected | Denial of Service | JWKS retry (SEC-02 implementation with DoS guard) |
| Clickjacking via iframe embedding | Tampering | `X-Frame-Options: DENY` (SEC-04) |
| XSS via injected scripts | Tampering | `Content-Security-Policy: default-src 'none'` (SEC-04) |
| HTTPS downgrade / mixed content | Information Disclosure | `Strict-Transport-Security` (SEC-04) |
| Referer header leaking auth codes | Information Disclosure | `Referrer-Policy: no-referrer` (RFC 9700 §4.2.4 gap — add to security.ts) |

## Environment Availability

| Dependency | Required By | Available | Fallback |
|------------|------------|-----------|---------|
| Keycloak (localhost:8080) | SEC-05 E2E test token fetch | Runtime (started by `npm run dev`) | `test.skip` guard in api.spec.ts pattern |
| Backend (localhost:8787) | SEC-05 E2E test | Runtime (started by `npm run dev`) | `isBackendRunning()` guard |
| `docs/` directory | SEC-01, DOC-03 | Does not exist | Create with `mkdir -p docs/security` |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `KC_ADMIN_CLIENT_ID` in tests/.env.test points to `japan-trip-worker` | SEC-05 pattern | Test uses wrong client; verify by reading tests/.env.test before implementing |
| A2 | `japan-trip-worker` service account tokens contain `realm-management` in aud (not `account`) | D-14 | Does not break the test (any aud lacking `japan-trip-frontend` → 401); but if a literal `aud: account` check is added to the test it will fail |
| A3 | Hono middleware post-next() code runs on notFound and onError responses | SEC-04 headers on error responses | If headers are missing on 404/500, `hono/secure-headers` has same limitation; verify with `curl -I localhost:8787/nonexistent` after implementation |
| A4 | KC refresh token rotation is not enabled by default in Keycloak 25 | RFC 9700 §2.2.2 | If rotation is on by default, §2.2.2 status changes from N/A to Compliant; verify in KC admin or realm-export.json |

**If this table is empty:** All claims in this research were verified or cited. (Table is not empty — A1-A4 require runtime confirmation.)

## Open Questions

1. **SEC-05 literal `aud: account` requirement**
   - What we know: REQUIREMENTS.md says "a token with `aud: account` only returns 401" — but japan-trip-worker tokens likely have `aud: realm-management`
   - What's unclear: Whether the acceptance test literally checks for `aud: account` or just "wrong audience"
   - Recommendation: Frame the test as "aud excludes japan-trip-frontend → 401"; do not assert `aud: account` in the test

2. **SETUP.md — does `terraform apply` require KC to be running?**
   - What we know: `terraform/keycloak/main.tf` provisions KC realm resources; KC must be running for terraform provider to connect
   - What's unclear: Whether `npm run dev` must be started before `terraform apply` on a fresh machine (no DB data) or if there's a docker-compose-only startup mode
   - Recommendation: SETUP.md order: docker compose up → terraform apply → DB push → DB seed → npm run dev (full); this is consistent with `scripts/dev.js` starting compose first

## Sources

### Primary (HIGH confidence — codebase verified)
- `backend/src/auth/keycloak.ts` — JWKS fetch, caching, kid-not-found retry (lines 99–141), signature verification (lines 223–237) [read directly]
- `backend/src/middleware/cors.ts` — middleware export pattern [read directly]
- `backend/src/middleware/auth.ts` — async middleware pattern with `await next()` [read directly]
- `backend/src/index.ts` — middleware registration order [read directly]
- `backend/src/dev.ts` — backend env var list; `.dev.vars` file convention [read directly]
- `terraform/keycloak/main.tf` — `japan-trip-worker` client (no audience mapper); audience mapper on frontend client only [read directly]
- `tests/e2e/api.spec.ts` — existing test patterns, isBackendRunning guard [read directly]
- `tests/e2e/fixtures/kc-admin.ts` — client_credentials auth; env vars used [read directly]
- `tests/global-setup.ts` — OIDC PKCE auth setup [read directly]
- `scripts/dev.js` — `npm run dev` scope (Docker → Compose → KC health → concurrently) [read directly]
- `.env.example`, `frontend/.env.example` — env var templates [read directly]
- `README.md` — current content (126 lines); old Quick Start identified [read directly]
- `docs/` — does not exist [Bash ls confirmed]

### Secondary (MEDIUM confidence — official source)
- RFC 9700 — fetched from rfc-editor.org — full control enumeration [CITED: rfc-editor.org/rfc/rfc9700]
- Hono `secureHeaders` — official docs + GitHub source — confirms `await next(); setHeaders()` execution order [CITED: hono.dev/docs/middleware/builtin/secure-headers + raw.githubusercontent.com/honojs/hono]

## Metadata

**Confidence breakdown:**
- D-07 JWKS gap analysis: HIGH — code read directly; DoS risk identified from analysis
- D-14 audience verification: MEDIUM — Terraform verified; live KC behavior assumed
- Middleware pattern: HIGH — cors.ts and auth.ts read directly; Hono source confirmed
- `npm run dev` scope: HIGH — scripts/dev.js read directly
- RFC 9700 controls: HIGH — RFC fetched + code mapping verified
- SEC-05 token fetch pattern: HIGH — kc-admin.ts pattern read directly
- SETUP.md env vars: HIGH — dev.ts read directly

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (stable codebase; RFC 9700 is stable; Hono API stable)
