# Phase 7: Backend Hardening + KC Config — Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Backend auth hardening (env var extraction, email optionality, OTP DB schema, KC Admin client); Keycloak realm config (VERIFY_EMAIL, browser-passkey flow switch, webauthn Required Action, theme i18n with full FTL overrides) — all via TypeScript + Drizzle + Terraform HCL. No frontend UI changes. No production deployment.

</domain>

<decisions>
## Implementation Decisions

### KC Admin client (BACK-04)
- **D-01:** Create a new dedicated `japan-trip-worker` Keycloak client (do NOT promote `japan-trip-api`). Add `keycloak_openid_client` resource in `terraform/keycloak/main.tf` with `serviceAccountsEnabled = true` and `standardFlowEnabled = false`. Clean separation: `japan-trip-frontend` stays bearer-only for PKCE, worker gets its own client credentials grant.
- **D-02:** Grant `manage-users` realm role to the `japan-trip-worker` service account via a `keycloak_openid_client_service_account_role` resource.
- **D-03:** Backend consumes Admin API credentials via two new `Env` bindings: `KC_ADMIN_CLIENT_ID` and `KC_ADMIN_CLIENT_SECRET`. Local values go in `backend/wrangler.dev.toml` (gitignored); prod via `wrangler secret put`.

### FTL theme overrides (KC-04)
- **D-04:** Full FTL template overrides for `login.ftl`, `login-otp.ftl`, `verify-email.ftl`, `error.ftl` under `keycloak/themes/japan-trip/login/`. Templates extend the KC 26 Keycloak base theme but override markup to match the app's dashboard look (not just messages).
- **D-05:** Add `keycloak/themes/japan-trip/login/messages/messages_es.properties` with Spanish translations for all error keys used in the four FTL files: `invalidUserMessage`, `accountTemporarilyDisabledMessage`, `webauthn-error-*`, OTP-related keys, verify-email copy.
- **D-06:** Update `keycloak/themes/japan-trip/login/theme.properties`: add `locales=es,en` and `defaultLocale=es`.
- **D-07:** Branding goal: match the app's dashboard look — use existing `login.css` variables and card/form patterns from the app's frontend CSS as the visual reference. KC login pages should feel like part of the same app, not vanilla KC.

### Drizzle ORM migration (BACK-03)
- **D-08:** Add `emailOtpCodes` table to `backend/src/db/schema.ts`. Columns per REQUIREMENTS.md: `id serial PK`, `user_id int FK→users(id)`, `code_hash text NOT NULL`, `expires_at timestamptz NOT NULL`, `used_at timestamptz`, `attempts int default 0`, `created_at timestamptz default now()`.
- **D-09:** Run `drizzle-kit generate` to produce `backend/src/db/migrations/0003_add_email_otp_codes.sql`. This SQL file is committed to the repo. Production applies via `drizzle-kit migrate`.

### Claude's Discretion
- `users.email varchar NOT NULL` in DB stays as-is. BACK-02 (email optionality) is scoped to the auth layer only: `KeycloakJwtPayload.email?: string` and `UserInfo.email?: string`. The existing `jwtUser.email ?? ''` fallback in `ensureUserProvisioned` is sufficient — no DB schema migration for the users table.
- VALID_AUDIENCES env var (BACK-01): add `VALID_AUDIENCES: string` to `Env` interface; replace hardcoded `['japan-trip-frontend']` at `keycloak.ts:198` with `env.VALID_AUDIENCES.split(',').map(s => s.trim())`; update `backend/src/auth/keycloak.test.ts` to test the new extraction logic; local value `VALID_AUDIENCES = japan-trip-frontend` in `wrangler.dev.toml`.
- KC-02 flow switch: set `browserFlow = "browser-passkey"` in `terraform/keycloak/main.tf` realm resource. Password-forms ALTERNATIVE branch was established in Phase 6 `flows.tf` — verify it exists before setting this.
- KC-03: `keycloak_required_action` resource for `webauthn-register-passwordless` with `defaultAction = false` — add to `terraform/keycloak/main.tf` or a new `required-actions.tf`.
- KC-01: `VERIFY_EMAIL` required action + SMTP config — Mailpit already wired in Phase 6. Enable via `keycloak_required_action` resource and ensure `smtpServer` block is already in realm config (Phase 6 added it).
- Exact `japan-trip-worker` client secret value for local dev — generate a UUID, document in `wrangler.dev.toml.example`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Goals
- `.planning/REQUIREMENTS.md` §BACK-01, BACK-02, BACK-03, BACK-04, KC-01, KC-02, KC-03, KC-04 — full requirement definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 7 — 8 success criteria that define done

### Prior phase context
- `.planning/phases/06-multi-environment-configuration-vite-env-files-per-environme/06-CONTEXT.md` — D-03 (wrangler.dev.toml convention), D-11 (wrangler.toml cleanup), D-13/D-14 (Mailpit SMTP already wired), Terraform module structure
- `.planning/phases/04-passkeys/04-CONTEXT.md` — D-01 (KC 26.6.1), D-02 (webAuthnPolicyPasswordlessRpId=localhost)

### Backend source files
- `backend/src/auth/keycloak.ts` — `verifyJwt()` (line 198 hardcoded validAudiences), `extractUserInfo()`, `validateAudience()`
- `backend/src/auth/keycloak.test.ts` — existing audience tests; must be updated for BACK-01
- `backend/src/types/index.ts` — `Env` interface (needs VALID_AUDIENCES, KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET), `KeycloakJwtPayload` (email needs ?), `ContextVariables`
- `backend/src/middleware/user.ts` — `ensureUserProvisioned()` with `jwtUser.email ?? ''` fallback
- `backend/src/db/schema.ts` — existing tables; add emailOtpCodes here
- `backend/src/db/migrations/` — 0000/0001/0002 SQL migration files; new file 0003 goes here
- `backend/drizzle.config.ts` — `out: './src/db/migrations'` confirms migration output path
- `backend/wrangler.toml` — base config; only DATABASE_URL secret reference

### Terraform files
- `terraform/keycloak/main.tf` — realm resource + existing clients; japan-trip-worker client + KC-02 browserFlow change go here
- `terraform/keycloak/flows.tf` — browser-passkey flow definition; verify password-forms ALTERNATIVE branch exists before KC-02 switch
- `terraform/keycloak/variables.tf` — existing variables; KC Admin client vars go here

### Theme files
- `keycloak/themes/japan-trip/login/theme.properties` — add `locales=es,en`, `defaultLocale=es`
- `keycloak/themes/japan-trip/login/login.css` — existing CSS; FTL files reference this for dashboard branding
- `frontend/src/styles/main.css` — reference for app's dashboard visual style (card colors, form patterns)

</canonical_refs>

<code_context>
## Existing Code Insights

### Files to read before modifying
- `backend/src/auth/keycloak.ts:198` — `const validAudiences = ['japan-trip-frontend']` — the exact line BACK-01 changes
- `backend/src/types/index.ts:42` — `email: string` (required) — BACK-02 changes to `email?: string`
- `backend/src/types/index.ts:28-34` — `Env` interface currently has only DATABASE_URL, KEYCLOAK_URL, KEYCLOAK_REALM — add VALID_AUDIENCES + KC_ADMIN_CLIENT_ID + KC_ADMIN_CLIENT_SECRET
- `backend/src/db/schema.ts` — no emailOtpCodes table yet; Drizzle import list at top must be extended (add `timestamptz` or use existing `timestamp` with timezone)
- `keycloak/themes/japan-trip/login/` — currently only theme.properties + footer.ftl + resources/css/login.css; no messages/ dir and no FTL overrides

### Established patterns
- Drizzle migrations: `drizzle-kit generate` produces SQL in `backend/src/db/migrations/`; existing files 0000-0002 establish the naming convention
- Wrangler env vars: non-secret vars go in `wrangler.dev.toml` (gitignored local overrides); secrets via `wrangler secret put`
- Terraform KC module: `mrparkers/keycloak >= 5.7.0` provider; resources split across main.tf, flows.tf, mappers.tf

### Integration points
- After adding `VALID_AUDIENCES` to `Env`, all tests that call `verifyJwt()` with an `env` mock must include `VALID_AUDIENCES: 'japan-trip-frontend'`
- After making `KeycloakJwtPayload.email?: string`, `extractUserInfo()` return type `UserInfo` must also change `email` to optional (or keep required with empty-string fallback — check all consumers)
- KC Admin API base URL: `${env.KEYCLOAK_URL}/admin/realms/${env.KEYCLOAK_REALM}/` — uses existing KEYCLOAK_URL/REALM bindings

</code_context>

<specifics>
## Specific Ideas

- `japan-trip-worker` client in Terraform: `clientId = "japan-trip-worker"`, `serviceAccountsEnabled = true`, `standardFlowEnabled = false`, `directAccessGrantsEnabled = false`
- Drizzle migration column for timestamps: use `timestamp('col', { withTimezone: true })` — consistent with existing schema.ts pattern
- FTL files must be KC 26.x compatible — pull from the keycloak-themes GitHub repo at tag 26.6.1 and trim down; do NOT use KC 25 or KC 27 templates
- `messages_es.properties` encoding: UTF-8 with `#encoding=UTF-8` first line (KC requirement for non-ASCII chars)

</specifics>

<deferred>
## Deferred Ideas

- Make `users.email` DB column nullable — deferred; not in Phase 7 scope. Handle at provisioning layer with empty-string fallback.
- Production Terraform apply for Cloudflare worker secrets — deferred to production deployment phase (per Phase 6 D-09)
- Dashboard-style branding CSS additions to login.css — if the existing login.css is insufficient, Phase 7 may update it; full design overhaul is out of scope

</deferred>

---

*Phase: 07-backend-hardening-kc-config*
*Context gathered: 2026-05-19*
