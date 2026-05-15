# Pitfalls Research — v2.0 Auth Infrastructure & Hardening

**Domain:** Terraform IaC for Keycloak 26 + WebAuthn passkey campaign + Email OTP + Playwright real auth
**Researched:** 2026-05-15
**Confidence:** MEDIUM-HIGH (grounded in actual realm-export.json, backend/src/auth/keycloak.ts, and prior phase 04 research)

---

## Critical Pitfalls (must address before shipping)

### 1. rpId Lock-In: Production RP ID Must Be Set Before First Production Passkey Registration

**Risk:** `keycloak/realm-export.json` line 42 has `"webAuthnPolicyPasswordlessRpId": "localhost"`. The rpId is cryptographically bound to every passkey a user registers — the credential stores the rpId at creation time and the WebAuthn API enforces an exact match on every subsequent assertion. If any production user registers a passkey before Terraform sets the correct production rpId (e.g., the Railway hostname), that credential is permanently locked to `localhost` and fails on every production login attempt. There is no migration path; affected credentials must be deleted and re-registered.

**Prevention:**
- Terraform must set `webauthn_policy_passwordless_rp_id` in the `keycloak_realm` resource to the production hostname before production is opened to users.
- Gate user access behind a "realm setup complete" check: verify rpId with `curl -s https://{kc-prod}/realms/japan-trip | jq .webAuthnPolicyPasswordlessRpId` before marking prod live.
- Maintain two environment-specific rpId values: `"localhost"` for local docker-compose (already set), exact Railway/custom domain hostname for production. Never share realm state between environments.

**Warning sign:** `InvalidStateError` or `NotAllowedError` on passkey assertion; browser console shows "The provided rpId is not a registrable domain suffix of, nor equal to the current domain."

**Phase:** Terraform bootstrap — must be configured before the passkey campaign phase begins.

---

### 2. Terraform Drift vs. realm-export.json: Dual Sources of Truth Will Conflict

**Risk:** The project boots via `start-dev --import-realm` against `keycloak/realm-export.json`. Terraform's `keycloak/terraform-provider-keycloak` provider (originally `mrparkers/keycloak`, repo transferred to the Keycloak org — redirect is transparent but verify KC 26 support in the provider's CHANGELOG before writing `.tf`) manages realm state via KC Admin API. If both operate simultaneously — realm imported from JSON, then `terraform apply` runs against the same KC instance — Terraform will fight the JSON on every apply: it attempts to modify already-imported resources and diffs will never converge. Conversely, removing realm-export.json from the import path without covering every resource in Terraform leaves silent gaps (missing authentication flows, missing protocol mappers, missing required actions).

Additional risk: the provider does not expose every KC 26 realm field. Passkey policy fields, the `browser-passkey` custom flow, and the `webauthn-authenticator-passwordless` execution may require `keycloak_custom_identity_provider_mapper` resources or direct REST calls via `null_resource`. Provider KC 26 compatibility must be verified before writing `.tf` files.

**Prevention:**
- Decide on exactly one source of truth per environment before writing any `.tf`. The clean path: keep realm-export.json as the docker/local source; use Terraform exclusively for the Railway/production environment with environment-specific `.tfvars`. If Terraform also manages local, run `terraform import keycloak_realm.japan_trip japan-trip` on first apply to bring the existing realm under management, then remove realm-export.json from the Docker import volume.
- Check `https://github.com/keycloak/terraform-provider-keycloak` CHANGELOG and open issues for KC 26-specific bugs before committing to the provider. Look specifically for issues tagged `keycloak-26`.
- After every `terraform apply`, run `terraform plan` immediately to confirm zero diff — a perpetual non-empty plan is the symptom of drift.

**Warning sign:** `terraform apply` reports changes on every run even with no `.tf` modifications; authentication flows defined in realm-export.json disappear after apply.

**Phase:** Terraform bootstrap — the import-vs-fresh-create decision must be the first task, not an afterthought.

---

### 3. Audience Hardcoded in Backend: New Clients Will Break Silently

**Risk:** `backend/src/auth/keycloak.ts` line 198 has `const validAudiences = ['japan-trip-frontend']`. Adding any new OIDC client — E2E Playwright service account, admin tooling — will produce JWT audience values not in this list and return 401 with the message `JWT audience not accepted`. The same file's companion `KeycloakJwtPayload` in `backend/src/types/index.ts` line 40 types `email: string` as non-optional, but passkey-only auth flows do not guarantee an email claim. Any `payload.email` access returns `undefined` at runtime while TypeScript reports `string`.

**Prevention:**
- Move `validAudiences` to env var `KEYCLOAK_VALID_AUDIENCES` (comma-separated), parsed in `verifyJwt`. Set it in `wrangler.toml` and `.env`.
- Change `email: string` to `email?: string` in `KeycloakJwtPayload`. Audit all callers. `extractUserInfo` already handles this correctly (`payload.email ?? ''`), but the type lie will surface anywhere `email` is destructured directly.
- Complete before Terraform introduces any new KC clients.

**Warning sign:** New client tokens return 401; passkey-authenticated users cause runtime `undefined` errors on email field access.

**Phase:** Pre-Terraform hardening (prerequisite for any new KC client work).

---

### 4. Email OTP Timing Attack: Workers Has No `timingSafeEqual`

**Risk:** `crypto.subtle.timingSafeEqual` does not exist in the Cloudflare Workers runtime. `crypto.getRandomValues` and the full Web Crypto `subtle` API are available, but direct string comparison of OTP codes (`storedOtp === submittedOtp`) is vulnerable to timing attacks — an attacker can measure response latency to determine partial matches and brute-force a 6-digit OTP in far fewer than 10^6 attempts.

**Prevention:**
- Implement constant-time comparison via HMAC: generate a 32-byte random key at Worker startup (store in Workers KV or `wrangler secret`); compute `HMAC-SHA256(key, storedOtp)` and `HMAC-SHA256(key, submittedOtp)` using `crypto.subtle.sign`; compare the resulting `ArrayBuffer`s using an XOR-accumulator — do NOT use an early-return byte compare, which leaks timing:
  ```typescript
  function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
    const av = new Uint8Array(a);
    const bv = new Uint8Array(b);
    let diff = av.byteLength ^ bv.byteLength;
    for (let i = 0; i < av.byteLength; i++) diff |= av[i] ^ bv[i];
    return diff === 0;
  }
  ```
  Both inputs go through the same keyed HMAC, producing equal-length 32-byte outputs — the XOR loop runs in constant time regardless of where bytes differ.
- Rate-limit OTP submission attempts at the Workers layer: max 5 attempts per 10 minutes per email (keyed on hash of email address), stored in Workers KV or a short-TTL Neon row. Return 429 on excess.
- Set OTP TTL to 10 minutes maximum. Invalidate on first successful use. Refuse to re-send within a 60-second window to prevent enumeration via re-send flooding.

**Warning sign:** OTP endpoint responds measurably faster for partially correct codes; no rate limit enforced; multiple submissions of the same OTP code all succeed.

**Phase:** Email OTP fallback implementation.

---

### 5. browser-passkey as Default Flow Locks Out Existing Password-Only Users

**Risk:** `realm-export.json` defines the `browser-passkey` flow (lines 146–194) with `webauthn-authenticator-passwordless` as `REQUIREMENT: REQUIRED`. But `"browserFlow": "browser"` (line 199) keeps the standard flow active — the passkey flow exists but is unused. If Terraform or admin UI switches `browserFlow` to `browser-passkey` as part of the passkey campaign, every existing user who has a password but no registered passkey hits a hard wall: the REQUIRED WebAuthn step has no credential to satisfy and no fallback path. Complete lockout.

**Prevention:**
- Before switching `browserFlow`, modify the `passkey-forms` subflow to make `webauthn-authenticator-passwordless` `ALTERNATIVE` with a password-forms `ALTERNATIVE` sibling, not `REQUIRED`. Safe structure: `auth-cookie` ALTERNATIVE → `passkey-forms` ALTERNATIVE → `password-forms` ALTERNATIVE. The `passkey-forms` subflow can mark WebAuthn as REQUIRED internally, but the passkey-forms branch itself must be ALTERNATIVE to password-forms at the parent level.
- Run the passkey campaign (register passkeys via required action for existing users) before switching `browserFlow`. Never switch the flow on a realm with active password-only users.
- Terraform must manage this as a phased change: modify flow first (add password fallback), then switch `browserFlow`.

**Warning sign:** After `browserFlow` switch, existing users see "No passkey found" error with no login alternative; admin console shows zero passkey credentials for affected users.

**Phase:** Passkey campaign flow design — must be resolved before `browserFlow` is changed in any environment.

---

### 6. Brute Force Protection Interacts With Email OTP: Account DoS Risk

**Risk:** `realm-export.json` has `"bruteForceProtected": true` with `"failureFactor": 30` and `"maxFailureWaitSeconds": 900`. If email OTP verification routes through Keycloak (e.g., via a custom authenticator SPI or Application-Initiated Action), each wrong OTP submission increments the user's failure counter in KC. An attacker who knows a target's email can spam 30 wrong OTP codes to lock the legitimate account for 15 minutes — a trivial denial-of-service. The victim cannot log in during the lockout period even with a correct OTP.

This only applies if OTP validation touches KC's auth system. If the OTP is validated entirely at the Worker level (Worker generates the code, stores in KV/DB, validates the submission, then calls KC Admin API to mark the session) — without going through a KC login flow — then KC's brute force counter is not incremented and the risk does not apply. The architecture decision drives the answer.

**Prevention:**
- Decide explicitly: Worker-side OTP validation (recommended — KC brute force counter is bypassed, Worker-level rate limit applies from pitfall #4) vs. KC-SPI OTP authenticator (KC brute force counter applies, must tune `failureFactor` and `quickLoginCheckMilliSeconds`).
- If using Worker-side OTP: enforce rate limiting at the Worker layer (pitfall #4) and never route OTP attempts through a KC login flow.
- If using KC-SPI approach: set `failureFactor` high enough that legitimate retry attempts don't trigger lockout, or disable brute force for the OTP-specific flow and rely on OTP TTL + rate limiting instead.

**Warning sign:** Account lockout (KC returns `Account is temporarily disabled`) after a small number of wrong OTP submissions; legitimate users locked out by an attacker who knows their email address.

**Phase:** Email OTP architecture decision — must be resolved before implementation begins.

---

## Medium Pitfalls

### 7. VERIFY_EMAIL and Email OTP Must Ship Atomically

**Risk:** `realm-export.json` has no `requiredActions` section — VERIFY_EMAIL is not enforced on new registrations. If email OTP is added first and VERIFY_EMAIL enforcement is added separately, there is a window where users register with unverified (potentially mistyped) emails, receive OTP codes at wrong addresses, and have no recovery path. Conversely, enabling VERIFY_EMAIL before SMTP is configured in KC blocks all new registrations — KC tries to send a verification email, delivery fails silently, and the user is stuck at an unresolvable "check your email" screen.

**Prevention:**
- SMTP configuration (KC `smtp` realm attribute in Terraform), VERIFY_EMAIL required action (`defaultAction: false` initially), and the email OTP Worker endpoint must all be deployed in the same `terraform apply` + `wrangler deploy`. Never enable VERIFY_EMAIL in isolation.
- Test with a real SMTP provider in a staging environment before enabling VERIFY_EMAIL in production.
- Set `defaultAction: false` for VERIFY_EMAIL initially; gate it behind a manual flag-flip after confirming end-to-end email delivery works.

**Warning sign:** New user registrations stop completing after VERIFY_EMAIL is enabled; no error message shown; KC logs show SMTP connection failures.

**Phase:** Email OTP / SMTP infrastructure phase.

---

### 8. Playwright Real Auth: `directAccessGrantsEnabled: false` Means No ROPC

**Risk:** `realm-export.json` client `japan-trip-frontend` has `"directAccessGrantsEnabled": false`. This is correct for security — Resource Owner Password Credentials (ROPC) grant is disabled. Many Playwright KC auth setups acquire tokens via ROPC (POST to `/token` with username/password). This pattern returns 401 here. Additionally, `keycloak-js` defaults to enabling `checkLoginIframe` which loads a cross-origin iframe for session state — this interferes with Playwright's cookie isolation in headless Chromium, causing `keycloak.authenticated` to be `false` in tests even when storageState has valid session cookies.

**Prevention:**
- Use Playwright `storageState`: authenticate once in a `setup` project (drive the full OIDC browser redirect flow), save the resulting cookies + localStorage, and load it in test projects via `use: { storageState: 'auth.json' }`.
- Set `checkLoginIframe: false` in keycloak-js `init()` for test builds via `VITE_KC_CHECK_LOGIN_IFRAME=false` env var. The cross-origin iframe check breaks headless Chromium session replay.
- Do not attempt to manually construct `Authorization` headers from hardcoded tokens in Playwright — the PKCE `code_verifier` is per-session and tokens expire in 300 seconds (realm-export.json line 23).

**Warning sign:** `storageState` is loaded but Playwright test pages immediately redirect to login; `keycloak.authenticated` is `false` in test pages; Network tab shows 400 on `/token` when ROPC is attempted.

**Phase:** Playwright E2E auth hardening.

---

### 9. JWKS Cache Is Per-Isolate: Intermittent 401s After Realm Rebuild

**Risk:** `backend/src/auth/keycloak.ts` line 41 uses module-level `let jwksCache`. Cloudflare Workers spawns multiple isolates; each starts cold with no cache and fetches independently. After a Terraform-driven realm rebuild (KC generates new signing keys on fresh realm creation), isolates that have the old key cached will fail signature verification. The existing retry path (line 215: `jwksCache = null` on key-not-found) only triggers when the new key has a different `kid` — if KC reuses the same `kid` with a new key value, the old cached key fails verification indefinitely until the 1-hour TTL expires.

**Prevention:**
- After any `terraform apply` that rebuilds the realm or rotates keys, immediately redeploy the Worker (`wrangler deploy`) — new isolates start cold.
- KC generates fresh `kid` values on realm rebuild by default; confirm this after first Terraform apply with `curl -s https://{kc-prod}/realms/japan-trip/protocol/openid-connect/certs | jq '.keys[].kid'` before and after.
- Consider reducing `JWKS_CACHE_TTL_MS` from 3600000 (1 hour) to 300000 (5 minutes) during the Terraform setup phase; restore after realm config stabilises.

**Warning sign:** Intermittent 401 errors from the API immediately after `terraform apply` or KC restart; errors vary by request (some succeed, some fail) because different isolates have different cache states.

**Phase:** Terraform bootstrap / post-apply testing.

---

### 10. redirect_uri Wildcards: Production Domain Not Covered

**Risk:** `realm-export.json` client `japan-trip-frontend` has `redirectUris: ["http://localhost:5173/*", "https://*.github.io/*"]`. The `account` client has hardcoded `webOrigins: ["http://localhost:5173", "https://manudubovis.github.io"]` (lines 110–113). If the production frontend URL uses a custom domain, Cloudflare Pages subdomain, or any other hostname not in these lists, KC returns `Invalid redirect_uri` on login. KC 26 has also tightened wildcard matching in OIDC redirect validation — the `*.github.io` wildcard may not match subpaths as expected in KC 26 vs KC 25.

**Prevention:**
- Terraform must parameterise `redirect_uris` and `web_origins` with environment-specific variables (`.tfvars`). Do not rely on wildcards for production — use exact URIs.
- Confirm the exact production frontend URL before writing Terraform redirect_uris; add it explicitly.
- The `account` client's `webOrigins` being hardcoded means CORS for `/account/credentials` calls from any new origin fails silently. Terraform must own this list.

**Warning sign:** Login redirects return `error=invalid_redirect_uri` in the browser URL bar; passkey management API calls show CORS errors in browser DevTools.

**Phase:** Terraform bootstrap / production deployment.

---

### 11. Keycloak Admin API Service Account Not Present in Current Realm

**Risk:** The current realm-export.json has no service account client. The email OTP resetPassword flow requires calling KC Admin REST API (`POST /admin/realms/{realm}/users/{id}/reset-password`) from the Cloudflare Worker. This requires a service account with `manage-users` role from the `realm-management` client. Adding this incorrectly — e.g., granting `realm-admin` instead of `manage-users` — gives the Worker full realm administration capability including creating/deleting users and modifying auth flows.

**Prevention:**
- Create a dedicated service account client in Terraform (e.g., `japan-trip-worker`) with `service_accounts_enabled = true` and map only the `manage-users` role from `realm-management`. Do not grant `realm-admin`.
- Store the client secret via `wrangler secret put KC_SERVICE_ACCOUNT_SECRET`, not in `wrangler.toml` vars.
- In the Worker, acquire a service account token via Client Credentials grant (`grant_type=client_credentials`) with a TTL-aware cache; do not cache longer than `accessTokenLifespan` (currently 300 seconds per realm-export.json line 23).

**Warning sign:** 403 on Admin API calls (under-privileged); or service account token can access `/admin/realms/{realm}/users` list endpoint without restriction (over-privileged).

**Phase:** Email OTP / service account bootstrap.

---

### 12. KC Theme FreeMarker Caching in Dev Blocks OTP Template Iteration

**Risk:** The `japan-trip` login theme CSS (`keycloak/themes/japan-trip/login/resources/css/login.css`) uses extensive `!important` overrides and inherits templates from the `keycloak` base theme without overriding any `.ftl` files. KC 26 caches theme resources and FreeMarker templates in-process — even with `start-dev`, the default `KC_SPI_THEME_STATIC_MAX_AGE` is 2592000 seconds (30 days) unless explicitly overridden. CSS edits will not be reflected without container restart. Adding new FreeMarker templates for the email OTP flow will also not hot-reload.

**Prevention:**
- Add to `keycloak/docker-compose.yml` environment block:
  ```yaml
  KC_SPI_THEME_STATIC_MAX_AGE: "-1"
  KC_SPI_THEME_CACHE_THEMES: "false"
  KC_SPI_THEME_CACHE_TEMPLATES: "false"
  ```
  These are officially documented KC dev flags and disable all theme caching without affecting production behavior.

**Warning sign:** CSS or FreeMarker template edits are not reflected in the browser after a hard refresh; only a full container restart shows changes.

**Phase:** Theme development / Email OTP FreeMarker template work.

---

## Low / Watch-Out

### 13. Per-Device Passkey Cookie Degrades in Safari and Private Mode

**Risk:** A "remember this device" cookie set by the Worker for per-device passkey detection is subject to Safari ITP. First-party cookies in a cross-site context receive a 7-day expiry cap; users on Safari who rely on device recognition will be re-prompted weekly. In private/incognito mode across all browsers, the cookie is blocked entirely — device recognition always fails silently.

**Prevention:**
- Use the per-device cookie only as a UX hint ("suggest passkey prompt") never as a security gate. Fall through to the standard login flow when the cookie is absent.
- Document that device recognition degrades gracefully in Safari private mode.

**Warning sign:** Safari users report being prompted to re-authenticate weekly; incognito users never see the passkey suggestion despite having registered one.

**Phase:** Passkey campaign UX.

---

### 14. Account REST API DELETE Credential Is Deprecated in KC 26

**Risk:** Phase 04 implemented `DELETE /realms/{realm}/account/credentials/{id}` for passkey removal. This endpoint is marked `@Deprecated` in KC 26 Javadoc (see phase 04 research). It still works now but will be removed in a future KC version. The replacement is Application-Initiated Action: `keycloak.login({ action: 'delete_credential:{id}' })`.

**Prevention:**
- If v2.0 modifies the passkey profile page, migrate DELETE to the AIA approach. If not touched in v2.0, add a TODO comment in profile.ts referencing the deprecation and the AIA alternative.

**Warning sign:** After a future KC upgrade past the removal version, DELETE returns 404 or 410.

**Phase:** Passkey campaign / profile page work in v2.0.

---

### 15. KC 26 Admin Env Var Deprecation Noise

**Risk:** `keycloak/docker-compose.yml` uses `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` (KC 25 names). KC 26 logs deprecation warnings for these on every container start. They still work but the noise can mask real startup errors.

**Prevention:**
- Update docker-compose.yml to `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` in the same commit as any KC 26 image tag bump.

**Warning sign:** KC startup logs contain `WARN: KEYCLOAK_ADMIN is deprecated` on every container start.

**Phase:** Infrastructure / docker-compose update.

---

## Phase-Specific Warning Matrix

| Phase | Pitfall | Severity |
|-------|---------|----------|
| Terraform bootstrap | Drift vs realm-export.json — decide source of truth first (#2) | CRITICAL |
| Terraform bootstrap | rpId lock-in — set prod rpId before users can register (#1) | CRITICAL |
| Terraform bootstrap | redirect_uri wildcards — confirm exact prod URL before authoring (#10) | HIGH |
| Terraform bootstrap | JWKS cache isolate variance — redeploy Worker after realm rebuild (#9) | MEDIUM |
| Pre-Terraform hardening | Audience hardcoded in backend — move to env var before new clients (#3) | HIGH |
| Email OTP architecture | Brute force + OTP DoS — decide Worker-side vs KC-SPI before building (#6) | CRITICAL |
| Email OTP | Timing attack — implement HMAC + XOR-accumulator, never `===` (#4) | CRITICAL |
| Email OTP | Service account scope — grant manage-users only, not realm-admin (#11) | HIGH |
| Email OTP + SMTP | VERIFY_EMAIL sequencing — ship SMTP + OTP + VERIFY_EMAIL atomically (#7) | HIGH |
| Passkey campaign | browser-passkey as default — build ALTERNATIVE flow before switching (#5) | CRITICAL |
| Passkey campaign | Per-device cookie Safari ITP — UX hint only, not security gate (#13) | LOW |
| Passkey campaign | Account REST DELETE deprecated — migrate to AIA if page is touched (#14) | LOW |
| Playwright E2E | No ROPC, iframe SSO — use storageState + checkLoginIframe=false (#8) | HIGH |
| Theme dev / OTP templates | FreeMarker caching — add KC_SPI_THEME_CACHE_* flags to docker-compose (#12) | MEDIUM |
| Infrastructure | Admin env var deprecation noise — update docker-compose.yml (#15) | LOW |

---

## Sources

- `keycloak/realm-export.json` (this repo) — rpId value (line 42), browserFlow (line 199), bruteForceProtected + failureFactor (lines 13–17), client config, audience mapper, account client webOrigins (lines 110–113)
- `backend/src/auth/keycloak.ts` (this repo) — hardcoded validAudiences (line 198), JWKS module-level cache (line 41), key-not-found retry path (line 215)
- `backend/src/types/index.ts` (this repo) — `email: string` non-optional in KeycloakJwtPayload (line 40)
- `.planning/phases/04-passkeys/04-RESEARCH.md` (this repo) — KC 25→26 upgrade findings, DELETE deprecation, admin env vars, docker compose down -v requirement
- [Keycloak 26.0.0 Release Notes](https://www.keycloak.org/2024/10/keycloak-2600-released) — hostname v1 removal, admin env var deprecation
- [Keycloak Import/Export Guide](https://www.keycloak.org/server/importExport) — --import-realm skips existing realm silently
- [AccountCredentialResource Javadoc 26.6.1](https://www.keycloak.org/docs-api/latest/javadocs/org/keycloak/services/resources/account/AccountCredentialResource.html) — DELETE deprecated annotation
- [Cloudflare Workers Runtime APIs — Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) — crypto.getRandomValues available; timingSafeEqual not listed
- [W3C WebAuthn Spec — Relying Party Identifier](https://www.w3.org/TR/webauthn-2/#relying-party-identifier) — rpId binding semantics and lock-in
- [keycloak/terraform-provider-keycloak GitHub](https://github.com/keycloak/terraform-provider-keycloak) — canonical provider repo (transferred from mrparkers/keycloak to keycloak org; KC 26 compat needs verification via CHANGELOG)
- [Keycloak Passkeys Support 26.4](https://www.keycloak.org/2025/09/passkeys-support-26-4) — native passkey UI additions in KC 26.3+
