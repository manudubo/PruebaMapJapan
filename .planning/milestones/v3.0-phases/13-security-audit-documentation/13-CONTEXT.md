# Phase 13: Security Audit + Documentation — Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers:

1. **Security headers** — New `backend/src/middleware/security.ts` adds CSP, X-Frame-Options, and HSTS to all Hono responses (SEC-04).
2. **JWKS retry extension** — Verify and extend JWKS retry to cover signature-verification failures in addition to the existing kid-not-found retry (SEC-02).
3. **RFC 9700 checklist** — Written artifact at `docs/security/rfc9700-checklist.md` with each OAuth/OIDC BCP control documented as compliant/non-compliant/N/A with a code reference and one-line rationale (SEC-01).
4. **SEC-05 E2E assertion** — New test in `tests/e2e/api.spec.ts` using the existing kc-admin-worker client_credentials token (wrong audience) to assert the backend returns 401.
5. **Documentation** — README.md updated for `npm run dev` setup (DOC-01); SETUP.md created for fresh dev machine setup (DOC-02); `docs/use-cases.md` use case inventory table created (DOC-03, DEVENV-03).

**Out of scope:** Production deployment documentation (post-v3.0), E2E spec migration from ROPC (Phase 14 UX-06), Keycloak account console restyling.

</domain>

<decisions>
## Implementation Decisions

### Security Headers — SEC-04

- **D-01:** CSP policy: `Content-Security-Policy: default-src 'none'` — the correct policy for a pure JSON API that never serves HTML. Defense-in-depth; browsers only enforce CSP on HTML documents so this is a no-op in practice but correct by spec.
- **D-02:** Additional headers: `X-Frame-Options: DENY` and `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- **D-03:** All three headers applied unconditionally — no environment detection. HSTS on HTTP (local dev) is ignored by browsers; environment detection adds complexity for no benefit.
- **D-04:** Implementation location: new `backend/src/middleware/security.ts`, registered in `backend/src/index.ts` after `corsMiddleware`. Matches the existing middleware pattern (cors.ts, auth.ts).

### JWKS Retry — SEC-02

- **D-05:** The existing code at `backend/src/auth/keycloak.ts:210–221` already retries on `kid-not-found` (invalidates cache, refetches JWKS, retries lookup). This covers the most common key-rotation scenario.
- **D-06:** Gap identified: there is NO retry when the kid IS found in cache but signature verification fails (stale cached key after key rotation). SEC-02 requires "retries JWKS fetch once on a key-verification failure" — the parenthetical "(signing key rotation does not require a backend restart)" implies this case should also be covered.
- **D-07:** The researcher must confirm whether to extend the retry to cover signature verification failures. If yes: after `isValid === false`, invalidate jwksCache and retry the full verify flow once. If the existing kid-not-found retry is accepted as sufficient per the requirement, document it as evidence for SEC-02.

### RFC 9700 Checklist — SEC-01

- **D-08:** Artifact location: `docs/security/rfc9700-checklist.md` — version-controlled alongside source code, visible to contributors.
- **D-09:** Format per control: `status (Compliant/N/A/Non-compliant)` + a `file:line` or Terraform resource reference as evidence + one-sentence rationale. No full prose paragraphs — practical and maintainable.
- **D-10:** The researcher should enumerate the RFC 9700 controls and map each to existing code or config. Key areas already addressed: PKCE S256 (Phase 12), audience validation (Phase 7/12), strict redirect URIs (Phase 12), CORS (Phase 1), XSS (Phase 1).

### SEC-05 Audience Assertion — E2E

- **D-11:** Token strategy: use the existing `kc-admin-worker` KC client (service_accounts_enabled = true, already in Terraform). A client_credentials token from this client will have an audience that does NOT include `japan-trip-frontend` — making it the correct "wrong audience" token for the test.
- **D-12:** Test placement: add a new `describe` block in `tests/e2e/api.spec.ts`. No new spec file needed.
- **D-13:** Test structure: (1) fetch a client_credentials token from kc-admin-worker, (2) send it to any authenticated API endpoint (e.g. GET /api/trips), (3) assert response status is 401.
- **D-14:** The researcher must verify the audience claim on kc-admin-worker tokens. If they include `japan-trip-frontend` (e.g. via an audience mapper), a different approach is needed (e.g. a new minimal test KC client or the built-in `account` client).

### Documentation

- **D-15 (DOC-01):** README.md updated to reflect `npm run dev` as the single-command dev startup (Phase 12 changed this). Remove references to the old `cd keycloak && docker compose up -d` setup. Keep the README concise — prerequisites list + quick start + link to SETUP.md.
- **D-16 (DOC-02):** SETUP.md covers fresh dev machine setup: prerequisites (Docker Desktop, Node 22+, Terraform, git), clone, copy `.env.example` to `.env`, `terraform init` + `terraform apply` in `terraform/keycloak/`, `npm install`, `npm run dev`. This is the "start from scratch on a new machine" guide.
- **D-17 (DOC-03):** `docs/use-cases.md` — markdown table with columns: `User Action | E2E Spec File | Coverage Status`. Lists all user-facing flows (login, create trip, add destination, passkey registration, OTP flow, public sharing, etc.) with which spec covers them and whether coverage is full/partial/none. Gaps feed into Phase 14 scope.
- **D-18 (DEVENV-03):** README prerequisites section lists: Docker Desktop, Node.js 22+, Terraform >= 1.0, and optionally the gh CLI. This directly satisfies DEVENV-03 ("user can follow the README to set up the local environment from scratch without consulting other sources").

### Claude's Discretion

- Exact CSP directives beyond `default-src 'none'` — the researcher may find additional directives appropriate for a Cloudflare Workers API
- Whether to extend JWKS retry to signature-verification failures or accept kid-not-found retry as sufficient for SEC-02 (see D-06/D-07 — researcher must make a recommendation)
- Exact structure of `SETUP.md` (sections, level of detail per step)
- Which additional env vars to document in SETUP.md (beyond KEYCLOAK_URL, KEYCLOAK_REALM, VALID_AUDIENCES, DATABASE_URL)
- Whether to use an existing markdown table library or raw GFM tables in `docs/use-cases.md`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend Auth — JWKS and JWT Verification
- `backend/src/auth/keycloak.ts` — full JWKS fetch, caching, and JWT verification; existing kid-not-found retry at lines 210–221; signature verification at lines 224–237
- `backend/src/middleware/auth.ts` — JWT auth middleware; where headers and audience validation are invoked
- `backend/src/index.ts` — middleware registration order (corsMiddleware → new securityMiddleware → routes)

### Backend Middleware Pattern
- `backend/src/middleware/cors.ts` — existing middleware structure to follow for new security.ts
- `backend/src/middleware/auth.ts` — second example of middleware structure

### E2E Test Infrastructure
- `tests/e2e/api.spec.ts` — target file for SEC-05 audience assertion; existing API test patterns
- `tests/e2e/fixtures/` — existing KC admin fixture patterns for client_credentials token fetch
- `tests/global-setup.ts` — OIDC PKCE global setup; shows how auth tokens are obtained
- `tests/playwright.config.ts` — storageState configuration

### Terraform (for kc-admin-worker client verification)
- `terraform/keycloak/main.tf` — kc-admin-worker client definition; check its audience mappers

### Existing Documentation
- `README.md` — current state (126 lines); references old `cd keycloak && docker compose up -d` setup to be replaced
- RFC 9700: https://www.rfc-editor.org/rfc/rfc9700 — the standard to audit against

### Requirements
- `.planning/REQUIREMENTS.md` §Security (SEC-01 through SEC-05), §Documentation (DOC-01 through DOC-03), §Dev Environment DEVENV-03
- `.planning/ROADMAP.md` §Phase 13 — success criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/src/middleware/cors.ts` — direct analog for new `security.ts`; same export pattern (`export const securityMiddleware = ...`)
- `backend/src/auth/keycloak.ts:getKeycloakJwks()` — the function to potentially call twice on signature failure (D-06/D-07)
- `tests/e2e/api.spec.ts` — existing API assertion tests; SEC-05 fits in a new `describe('JWT audience rejection', ...)` block

### Established Patterns
- Middleware: `export const xMiddleware: MiddlewareHandler = async (c, next) => { ... }` registered via `app.use('*', xMiddleware)` in `index.ts`
- E2E auth: storageState + addInitScript for browser-based flows; kc-admin fixture for admin API calls
- No ROPC anywhere in test files — all auth via PKCE or service accounts

### Integration Points
- `index.ts` line 11: `app.use('*', corsMiddleware)` — add `app.use('*', securityMiddleware)` immediately after
- `api.spec.ts`: new `describe('JWT audience rejection')` block at the end of the file
- `docs/` directory: does not exist yet — create `docs/security/rfc9700-checklist.md` and `docs/use-cases.md`

</code_context>

<specifics>
## Specific Details

- Security header values (exact strings for planner):
  - `Content-Security-Policy: default-src 'none'`
  - `X-Frame-Options: DENY`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- kc-admin-worker KC client name: verify exact resource name in `terraform/keycloak/main.tf` — it was established in Phase 7 (KC Admin worker client). The researcher should confirm the exact client_id value and whether its tokens include the `japan-trip-frontend` audience (which would break the SEC-05 test approach).
- README.md quick start to update: the old "cd keycloak && docker compose up -d" and separate `npm run dev:backend` / `npm run dev:frontend` commands must be replaced with just `npm run dev` (Phase 12 shipped this as `scripts/dev.js`).
- `docs/use-cases.md` table columns: `User Action | E2E Spec | Coverage Status (Full / Partial / None)`

</specifics>

<deferred>
## Deferred Ideas

None raised during discussion.

</deferred>

---

*Phase: 13-security-audit-documentation*
*Context gathered: 2026-06-06*
