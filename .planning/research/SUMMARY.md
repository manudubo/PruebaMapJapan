# Research Summary — v2.0 Auth Infrastructure & Hardening

**Project:** TravelMap / PruebaMapJapan
**Researched:** 2026-05-15
**Confidence:** HIGH (stack/arch) | MEDIUM-HIGH (pitfalls)

---

## Stack Additions

| Package / Tool | Version | Purpose |
|----------------|---------|---------|
| `resend` (npm, backend) | `^6.0.0` | Email OTP via HTTP API — only Workers-compatible option |
| `@playwright/test` | `^1.60.0` | Virtual Authenticator stability + addInitScript fixes |
| `keycloak/keycloak` (Terraform) | `>= 5.7.0, < 6.0.0` | Official KC org provider since Dec 2024; mrparkers archived |
| `cloudflare/cloudflare` (Terraform) | `~> 5.19` | Worker secrets management |
| `kislerdm/neon` (Terraform) | `>= 0.9.0, < 1.0.0` | Neon DB provisioning |
| `axllent/mailpit:v1.29` (Docker) | `v1.29` | Local SMTP — MailHog abandoned 2020, drop-in replacement |
| Terraform CLI | `>= 1.9.0, < 2.0.0` | Required floor for all three providers |
| HCP Terraform | free tier | Remote state CI/prod (500 resources) |

No new frontend npm deps. No new backend deps beyond `resend`.

---

## Feature Table Stakes

### Passkey Campaign
- AIA trigger: `kc_action=webauthn-register-passwordless`; KC 26.3+ `skip-if-exists` param eliminates redundant prompts
- Per-device opt-out cookie `pnk_{userId}`: `max-age=2592000`, `SameSite=Strict` — UX hint only, not a security gate
- Cookie written only after `initKeycloak()` resolves (userId unavailable before ID token)
- `webAuthnPolicyPasswordlessRpId` must be set to production hostname before any user registers a passkey — no migration path

### Email OTP Fallback
- Worker-side TypeScript: `POST /api/auth/otp-request` + `/api/auth/otp-verify` — no Java, no KC SPI
- OTP: SHA-256 hash in `email_otp_codes` table, 6-digit, 10-min TTL, single-use, max 5 attempts
- Timing-safe comparison: HMAC-SHA256 + XOR accumulator (Workers lacks `timingSafeEqual`)
- After OTP verify: force `UPDATE_PASSWORD` Required Action so user never stays passkey-only

### Email Verification
- `VERIFY_EMAIL` Required Action as realm default — must ship atomically with SMTP config
- KC bug #41171: session expires if link opened in different tab — increase `accessCodeLifespanUserAction` to 900–1800s

### KC Flow Configuration
- Switch `browserFlow` from `"browser"` to `"browser-passkey"` via Terraform
- Must NOT happen until password-forms ALTERNATIVE branch exists in the flow
- Safe flow: `auth-cookie` ALT → `passkey-forms` ALT → `password-forms` ALT

### Error Handling & Theme Localization
- Create `keycloak/themes/japan-trip/login/messages/messages_es.properties` (directory missing)
- Add `locales=es,en` to `theme.properties`
- FreeMarker overrides: `login.ftl`, `login-otp.ftl`, `verify-email.ftl`, `error.ftl`
- Key KC error keys: `invalidUserMessage`, `accountTemporarilyDisabledMessage`, `webauthn-error-*`

### Terraform IaC
- Full migration away from `--import-realm` — Terraform is single source of truth per env
- `realm-export.json` becomes read-only reference snapshot
- Resources: `keycloak_realm`, `keycloak_openid_client`, auth flows + executions, `keycloak_required_action`
- `cloudflare_worker_secret` for `RESEND_API_KEY`, `KC_ADMIN_CLIENT_SECRET`

### Playwright Real Auth
- `storageState` via `globalSetup` — headless Chromium drives OIDC redirect, writes `tests/.auth/user.json`
- ROPC disabled — cannot use username/password API auth; storageState is the only path
- `storageState` does NOT capture `sessionStorage` (Playwright bug #31108) — workaround: `page.evaluate` + `addInitScript` replay
- Virtual Authenticator (passkeys): Chromium-only — dedicated `chromium-passkeys` project
- Mailpit REST API for reading OTP codes in E2E tests

---

## Watch Out For

1. **rpId lock-in** — Set production hostname in Terraform before any prod passkey registrations. No migration path.
2. **Dual source of truth** — Remove `--import-realm` from docker-compose immediately after TF local confirmed.
3. **browserFlow switch locks out password-only users** — Add password-forms ALTERNATIVE branch before switching.
4. **OTP timing attack** — `timingSafeEqual` absent in CF Workers. Use HMAC-SHA256 + XOR accumulator.
5. **VERIFY_EMAIL + SMTP must ship atomically** — Enabling Required Action before SMTP silently blocks registrations.

---

## Build Order

1. Local infra — Mailpit, `terraform/keycloak/` module, local apply, remove `--import-realm`
2. Backend hardening — `validAudiences` env var, `email?: string` relaxation
3. DB migration + KC Admin client — `email_otp_codes`, admin service account
4. Backend OTP routes + mailer (parallel with 5) — `/api/auth/otp-*`, `mailer.ts`
5. KC theme extensions (parallel with 4) — FreeMarker, `messages_es.properties`, Required Actions
6. Frontend passkey detection + fallback page — depends on 4
7. Playwright real-auth overhaul — depends on 1–6
8. Production Terraform — prod rpId, redirect_uris, Cloudflare secrets, Neon

---

## Open Questions Resolved

| Question | Decision |
|----------|----------|
| Email OTP: KC SPI vs Worker-side TypeScript | Worker-side TypeScript |
| Email provider | Resend `^6.0.0` |
| Local SMTP | Mailpit v1.29 |
| Terraform state | HCP Terraform free tier (CI/prod), local (dev) |
| KC Terraform provider | `keycloak/keycloak >= 5.7.0` |
| KC customization | FreeMarker themes + built-in flows only |

---

## Remaining Open Questions

| Question | Impact |
|----------|--------|
| KC TF provider KC 26 compat for `browser-passkey` flow topology | May need `null_resource` REST fallback |
| Exact Railway production hostname | Blocks prod rpId and redirect_uris |
| Separate `japan-trip-worker` vs promote `japan-trip-api` for Admin API | Least-privilege design |
| VERIFY_EMAIL vs webauthn-register-passwordless ordering | Conflicting defaults if wrong |
