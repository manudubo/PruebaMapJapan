# Requirements — TravelMap v2.0 Auth Infrastructure & Hardening

**Milestone:** v2.0
**Goal:** Harden auth infrastructure with Terraform IaC, passkey campaign flow, email OTP fallback, KC theme i18n, and full Playwright real-auth coverage.
**Defined:** 2026-05-15

---

## v2.0 Requirements

### Infrastructure (INFRA)

- [ ] **INFRA-01**: Terraform Keycloak module manages all realm config as HCL — `keycloak_realm`, `keycloak_openid_client`, auth flow executions, `keycloak_required_action`; `realm-export.json` becomes read-only reference snapshot; `--import-realm` removed from docker-compose once local apply confirmed
- [ ] **INFRA-02**: Terraform Cloudflare module manages Worker secrets (`RESEND_API_KEY`, `KC_ADMIN_CLIENT_SECRET`) via `cloudflare_worker_secret`; no plaintext secrets in `wrangler.toml`
- [ ] **INFRA-03**: Mailpit v1.29 replaces MailHog in docker-compose as local SMTP (ports 1025 SMTP, 8025 web UI, REST API at `/api/v1/messages`); MailHog removed

### Keycloak Flows (KC)

- [ ] **KC-01**: `VERIFY_EMAIL` Required Action enabled as realm default, deployed atomically with SMTP config (Resend for prod, Mailpit for local); `accessCodeLifespanUserAction` set to 1200s to mitigate KC bug #41171
- [ ] **KC-02**: `browserFlow` switched from `"browser"` to `"browser-passkey"` via Terraform — prerequisite: password-forms ALTERNATIVE branch exists in the flow before switch; safe flow: `auth-cookie` ALT → `passkey-forms` ALT → `password-forms` ALT
- [ ] **KC-03**: `webauthn-register-passwordless` Required Action registered in realm with `defaultAction: false` (campaign triggers it via AIA, not forced on every login)
- [ ] **KC-04**: Theme i18n — `messages_es.properties` created under `keycloak/themes/japan-trip/login/messages/`; `locales=es,en` added to `theme.properties`; FreeMarker overrides for `login.ftl`, `login-otp.ftl`, `verify-email.ftl`, `error.ftl` with KC error keys (`invalidUserMessage`, `accountTemporarilyDisabledMessage`, `webauthn-error-*`)

### Passkeys (PASS)

- [ ] **PASS-04**: Post-login passkey campaign — `initKeycloak()` completion triggers WebAuthn device capability check; if capable and no cookie `pnk_{userId}`, redirect via `kc_action=webauthn-register-passwordless` (KC 26.3+ `skip-if-exists`); per-device opt-out cookie `pnk_{userId}` written with `max-age=2592000`, `SameSite=Strict` only after `initKeycloak()` resolves (userId unavailable before ID token)
- [ ] **PASS-05**: Email OTP fallback for passkey-only users on incompatible devices — Worker endpoints `POST /api/auth/otp-request` and `POST /api/auth/otp-verify`; OTP: 6-digit, SHA-256 hash stored in `email_otp_codes` table, 10-min TTL, single-use, max 5 attempts per email per window; timing-safe comparison via HMAC-SHA256 + XOR accumulator (Workers lacks `timingSafeEqual`); Resend sends email in prod, Mailpit in local
- [ ] **PASS-06**: Guard against deleting last credential — profile page delete flow checks remaining credential count before calling KC Account API; shows error if attempt would leave user with zero credentials
- [ ] **PASS-07**: `UPDATE_PASSWORD` Required Action forced post-OTP verify ONLY when device does NOT support WebAuthn passkeys; devices that support passkeys skip password requirement (passkey-only is acceptable; passwords are an additional vulnerability point)

### Backend Hardening (BACK)

- [ ] **BACK-01**: `validAudiences` extracted from hardcode in `backend/src/auth/keycloak.ts:198` to `VALID_AUDIENCES` env var (comma-separated); `wrangler.toml` and `wrangler.dev.toml` updated; no KC client addition can bypass audience check
- [ ] **BACK-02**: `email` field in `KeycloakJwtPayload` and `extractUserInfo()` relaxed to `email?: string`; all backend consumers handle absent email gracefully (passkey-only tokens omit the email claim)
- [ ] **BACK-03**: `email_otp_codes` Drizzle migration — columns: `id serial PK`, `user_id int FK→users`, `code_hash text`, `expires_at timestamptz`, `used_at timestamptz`, `attempts int default 0`, `created_at timestamptz default now()`
- [ ] **BACK-04**: KC Admin client configured — `japan-trip-api` client promoted from `bearerOnly` to service account with `manage-users` role (or separate `japan-trip-worker` client created); Admin API calls use client credentials grant

### End-to-End Tests (E2E)

- [ ] **E2E-01**: Playwright global setup drives real OIDC login via headless Chromium, writes `tests/.auth/user.json` via `storageState`; sessionStorage replayed via `page.evaluate(() => JSON.stringify(sessionStorage))` + `context.addInitScript()` workaround for Playwright bug #31108; ROPC not used
- [ ] **E2E-02**: Keycloak Admin API fixture helper (`tests/fixtures/kc-admin.ts`) — creates/deletes test users, resets credentials, clears OTP codes between test runs; uses client credentials grant against `japan-trip-worker` service account
- [ ] **E2E-03**: Passkey E2E tests in dedicated `chromium-passkeys` Playwright project — CDP Virtual Authenticator API registers/asserts passkeys in headless Chromium; tests: register passkey, login with passkey, delete passkey (guard: last credential)
- [ ] **E2E-04**: OTP fallback E2E tests — Mailpit REST API (`GET /api/v1/messages`) reads delivered OTP code; tests: request OTP, verify OTP, expired OTP rejected, max-attempts lockout, UPDATE_PASSWORD flow gated by WebAuthn capability flag

---

## Future Requirements (Deferred)

- Production Terraform (DEPLOY) — prod `webAuthnPolicyPasswordlessRpId` set to Railway hostname, Neon provisioning, Cloudflare Worker secrets wired to prod values
- Deployment runbook (DEPLOY) — local and production bring-up documented end-to-end
- Rename passkey (PASS) — `PUT /account/credentials/{id}/label`
- CSP response header (SEC) — Hono middleware; v1 fixes XSS at source
- Landing demo experience (DEMO) — Landing page showcases Japan trip without login

---

## Out of Scope

- Java KC SPIs — all KC customization via built-in flows + FreeMarker themes only; email OTP in Worker TypeScript
- Terraform Neon module — Neon provisioned manually for now; Terraform Neon scope deferred
- ROPC / username-password API auth in tests — PKCE only; storageState is the auth path
- Mobile native app — web-only by design
- Social features, AI suggestions, marketplace, payment — not a v2 concern

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| INFRA-01 | Phase 6 | Pending |
| INFRA-02 | Phase 6 | Pending |
| INFRA-03 | Phase 6 | Pending |
| KC-01 | Phase 7 | Pending |
| KC-02 | Phase 7 | Pending |
| KC-03 | Phase 7 | Pending |
| KC-04 | Phase 7 | Pending |
| BACK-01 | Phase 7 | Pending |
| BACK-02 | Phase 7 | Pending |
| BACK-03 | Phase 7 | Pending |
| BACK-04 | Phase 7 | Pending |
| PASS-04 | Phase 8 | Pending |
| PASS-05 | Phase 8 | Pending |
| PASS-06 | Phase 8 | Pending |
| PASS-07 | Phase 8 | Pending |
| E2E-01 | Phase 9 | Pending |
| E2E-02 | Phase 9 | Pending |
| E2E-03 | Phase 9 | Pending |
| E2E-04 | Phase 9 | Pending |
