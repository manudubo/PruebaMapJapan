# Phase 7: Backend Hardening + KC Config — Research

**Researched:** 2026-05-19
**Domain:** Cloudflare Workers TypeScript / Drizzle ORM / Keycloak 26.6.1 Terraform / FreeMarker themes
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Create `japan-trip-worker` KC client (`serviceAccountsEnabled = true`, `standardFlowEnabled = false`). Add `keycloak_openid_client` in `terraform/keycloak/main.tf`.
- **D-02:** Grant `manage-users` realm role to the service account via `keycloak_openid_client_service_account_role`.
- **D-03:** Backend consumes Admin API credentials via `KC_ADMIN_CLIENT_ID` and `KC_ADMIN_CLIENT_SECRET` env bindings. Local values in `backend/wrangler.dev.toml` (gitignored); prod via `wrangler secret put`.
- **D-04:** Full FTL overrides for `login.ftl`, `login-otp.ftl`, `verify-email.ftl`, `error.ftl` under `keycloak/themes/japan-trip/login/`. Extend KC 26 base. Match dashboard look.
- **D-05:** Add `keycloak/themes/japan-trip/login/messages/messages_es.properties` with Spanish translations.
- **D-06:** Update `theme.properties`: add `locales=es,en` and `defaultLocale=es`.
- **D-07:** Branding: match app dashboard look using existing `login.css` variables.
- **D-08:** Add `emailOtpCodes` table to `backend/src/db/schema.ts`.
- **D-09:** Run `drizzle-kit generate` to produce `0003_add_email_otp_codes.sql`.
- **KC-02:** `browserFlow = "browser-passkey"` in Terraform `main.tf`.
- **KC-03:** `keycloak_required_action` for `webauthn-register-passwordless` with `defaultAction = false`.

### Claude's Discretion

- `users.email` DB column stays `NOT NULL`; BACK-02 scoped to auth layer (`KeycloakJwtPayload.email?: string`, `UserInfo.email?: string`). Existing `?? ''` fallback in `ensureUserProvisioned` is sufficient.
- BACK-01: `VALID_AUDIENCES` added to `Env`; `['japan-trip-frontend']` replaced by `env.VALID_AUDIENCES.split(',').map(s => s.trim())`; `keycloak.test.ts` updated.
- KC-02 flow switch only after password-forms ALTERNATIVE branch verified.
- KC-03: add to `main.tf` or `required-actions.tf`.
- KC-01: `VERIFY_EMAIL` + SMTP config via `keycloak_required_action`; Mailpit already wired.

### Deferred Ideas (OUT OF SCOPE)

- `users.email` DB column nullable — deferred.
- Production Terraform apply for Cloudflare worker secrets — deferred to production deployment phase.
- Full design overhaul of login.css — out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BACK-01 | Extract `validAudiences` from hardcode to `VALID_AUDIENCES` env var | `Env` interface change + `keycloak.ts:198` surgery + test update |
| BACK-02 | Relax `email` to `email?: string` in `KeycloakJwtPayload`; all consumers handle absent email | Four call sites identified; two in users.ts need `?? ''` fallback added |
| BACK-03 | `email_otp_codes` Drizzle migration | `timestamp('col', { withTimezone: true })` pattern; drizzle-kit generate |
| BACK-04 | KC Admin client (service account + manage-users role) operational | Terraform `keycloak_openid_client_service_account_realm_role` pattern researched |
| KC-01 | `VERIFY_EMAIL` Required Action enabled; `accessCodeLifespanUserAction = 1200s` | `keycloak_required_action` resource; realm attribute update |
| KC-02 | `browserFlow = "browser-passkey"`; password-forms ALTERNATIVE branch must pre-exist | **BLOCKER: branch does NOT exist — must be added first** |
| KC-03 | `webauthn-register-passwordless` Required Action with `defaultAction = false` | **ALREADY EXISTS in flows.tf lines 42-48 — verify/no-op** |
| KC-04 | FTL overrides + `messages_es.properties` + `locales=es,en` | KC 26.6.1 base templates fetched; i18n key values confirmed |
</phase_requirements>

---

## Summary

Phase 7 touches four independent domains that can largely be parallelized: (1) TypeScript backend hardening (env vars, optional email, Admin client bindings), (2) Drizzle schema migration for `email_otp_codes`, (3) Terraform Keycloak resource additions (new client, required actions, flow fix, realm attribute), and (4) FreeMarker theme i18n (FTL files + messages_es.properties). There are two hard sequencing constraints: the `password-forms` ALTERNATIVE branch in flows.tf must be committed BEFORE `browser_flow = "browser-passkey"` is switched; and `terraform apply` must succeed before the KC Admin client credentials can be put in `.dev.vars`.

Four critical gaps were found during research that contradict or extend the CONTEXT.md decisions. These are documented in Common Pitfalls and Open Questions below and must be addressed by the planner.

**Primary recommendation:** Sequence the Terraform wave as (1) add password-forms subflow + VERIFY_EMAIL action + worker client, (2) `terraform apply`, (3) flip browserFlow, (4) `terraform apply` again. Keep TypeScript changes in a parallel track.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Audience validation (BACK-01) | API / Backend | — | JWT verification is server-side only |
| Email optionality (BACK-02) | API / Backend | — | Type/interface change; DB stays NOT NULL |
| OTP DB schema (BACK-03) | Database / Storage | API / Backend | Migration produces SQL; backend owns schema.ts |
| KC Admin client credentials (BACK-04) | API / Backend | — | Env bindings consumed by Worker runtime |
| VERIFY_EMAIL action (KC-01) | Keycloak (IDP) | — | Managed via Terraform realm config |
| browserFlow switch (KC-02) | Keycloak (IDP) | — | Terraform realm attribute; pre-condition required |
| webauthn-register-passwordless action (KC-03) | Keycloak (IDP) | — | Already exists in flows.tf |
| FTL overrides + i18n (KC-04) | Keycloak (IDP) | — | Theme files mounted via Docker volume |

---

## Standard Stack

### Core
| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `drizzle-orm` | existing | ORM + schema type generation | Already in repo; migration pattern established |
| `drizzle-kit` | existing | SQL migration generation | `drizzle-kit generate` → SQL file in `migrations/` |
| `mrparkers/keycloak` Terraform provider | >= 5.7.0 | KC realm IaC | Project locked decision (Phase 6) |
| Keycloak 26.6.1 | 26.6.1 | Identity provider | Locked in Phase 4 (D-01) |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `wrangler` `.dev.vars` | Local non-secret env var overrides | Add `VALID_AUDIENCES`, `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET` |
| FreeMarker (FTL) | KC theme templates | KC 26.6.1 base templates; override in theme dir |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `.dev.vars` | `wrangler.dev.toml` | CONTEXT.md mentions `wrangler.dev.toml` but Phase 6 used `.dev.vars` — see Open Questions |

---

## Architecture Patterns

### System Architecture Diagram

```
TypeScript BACK-01/02 changes
  └── backend/src/types/index.ts (Env + KeycloakJwtPayload)
       └── backend/src/auth/keycloak.ts (verifyJwt → reads env.VALID_AUDIENCES)
            └── backend/src/routes/users.ts (jwtUser.email ?? '' at 2 call sites)

BACK-03 migration
  └── backend/src/db/schema.ts (add emailOtpCodes table)
       └── drizzle-kit generate
            └── backend/src/db/migrations/0003_add_email_otp_codes.sql

Terraform KC changes (must apply in order)
  step 1: flows.tf — add password-forms subflow (BLOCKER for KC-02)
  step 2: main.tf — VERIFY_EMAIL required action (KC-01)
           flows.tf — (KC-03 already done)
           main.tf — japan-trip-worker client (D-01)
  step 3: main.tf — browserFlow = "browser-passkey" (KC-02)
  → terraform apply × 2 (or combined in 1 apply if password-forms added first)

Theme (KC-04)
  keycloak/themes/japan-trip/login/
    ├── login.ftl
    ├── login-otp.ftl
    ├── verify-email.ftl
    ├── error.ftl
    └── messages/
         └── messages_es.properties
  theme.properties  (locales=es,en, defaultLocale=es)
```

### Recommended Project Structure

```
terraform/keycloak/
├── main.tf              # realm + clients + audience mapper + required actions
├── flows.tf             # browser-passkey flow + password-forms subflow (ADD)
├── mappers.tf           # protocol mappers
└── variables.tf         # variables (add KC_ADMIN vars)

backend/src/
├── types/index.ts       # Env (3 new bindings), KeycloakJwtPayload (email?)
├── auth/
│   ├── keycloak.ts      # VALID_AUDIENCES extraction
│   └── keycloak.test.ts # updated audience tests
├── routes/users.ts      # ?? '' fallbacks at lines 49, 96
└── db/
    ├── schema.ts        # emailOtpCodes table
    └── migrations/
        └── 0003_add_email_otp_codes.sql

keycloak/themes/japan-trip/login/
├── theme.properties     # locales=es,en
├── login.ftl
├── login-otp.ftl
├── verify-email.ftl
├── error.ftl
└── messages/
    └── messages_es.properties
```

### Pattern 1: VALID_AUDIENCES env var extraction
**What:** Replace hardcoded `['japan-trip-frontend']` with env-driven list
**When to use:** Anywhere validAudiences is consumed

```typescript
// Source: keycloak.ts:198 — before
const validAudiences = ['japan-trip-frontend'];

// After (BACK-01)
const validAudiences = env.VALID_AUDIENCES.split(',').map(s => s.trim());
```

`Env` interface addition:
```typescript
export interface Env {
  DATABASE_URL: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  VALID_AUDIENCES: string;         // comma-separated, e.g. "japan-trip-frontend"
  KC_ADMIN_CLIENT_ID: string;      // D-03
  KC_ADMIN_CLIENT_SECRET: string;  // D-03
}
```

### Pattern 2: email optional ripple (BACK-02)
**What:** Make email optional in JWT payload; propagate to all consumers

```typescript
// types/index.ts — change
email?: string;  // was: email: string

// keycloak.ts:254 — already safe (uses ?? '')
email: payload.email ?? '',

// routes/users.ts:49 and :96 — MUST add fallback
jwtUser.email ?? '',   // was: jwtUser.email
```

**Note:** `getOrCreateUser` in `users.ts:23` has signature `email: string` — it expects `string`. After making `KeycloakJwtPayload.email?: string`, TypeScript strict mode will flag `jwtUser.email` (now `string | undefined`) passed directly. Both call sites at lines 49 and 96 need `?? ''`. [VERIFIED: backend/src/routes/users.ts grep]

`UserInfo.email` in `keycloak.ts:27` should also become `email?: string` (or keep `string` and leave the `?? ''` fallback — either is fine since extractUserInfo always fills it). Per CONTEXT.md discretion, keeping `UserInfo.email: string` with the `?? ''` fill is acceptable.

### Pattern 3: Drizzle emailOtpCodes table (BACK-03)
**What:** New table following existing `timestamp({ withTimezone: true })` pattern

```typescript
// Source: backend/src/db/schema.ts — existing pattern at lines 29, 30, 58
// backend/src/db/schema.ts — add this table
export const emailOtpCodes = pgTable('email_otp_codes', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code_hash: text('code_hash').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at: timestamp('used_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

The import list at the top of schema.ts already has `serial`, `integer`, `text`, `timestamp` — no new imports needed. [VERIFIED: backend/src/db/schema.ts lines 2-14]

Expected generated SQL:
```sql
CREATE TABLE IF NOT EXISTS "email_otp_codes" (
  "id"         SERIAL PRIMARY KEY,
  "user_id"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash"  TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used_at"    TIMESTAMPTZ,
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Pattern 4: KC Admin client Terraform (BACK-04 + D-01/D-02)

**CRITICAL:** `manage-users` is a CLIENT role on the built-in `realm-management` client, NOT a realm role. Use `keycloak_openid_client_service_account_realm_role`, which requires a data source lookup to get the `realm-management` client ID. [CITED: registry.terraform.io/providers/mrparkers/keycloak/latest/docs]

```hcl
# Add to terraform/keycloak/main.tf

# D-01: Worker client with service account
resource "keycloak_openid_client" "japan_trip_worker" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-worker"
  name      = "Japan Trip Worker"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  direct_access_grants_enabled = false
}

# Lookup the built-in realm-management client (contains manage-users role)
data "keycloak_openid_client" "realm_management" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "realm-management"
}

# Lookup the manage-users role within realm-management
data "keycloak_role" "manage_users" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = data.keycloak_openid_client.realm_management.id
  name      = "manage-users"
}

# D-02: Assign manage-users to the worker service account
resource "keycloak_openid_client_service_account_realm_role" "worker_manage_users" {
  realm_id                = keycloak_realm.japan_trip.id
  service_account_user_id = keycloak_openid_client.japan_trip_worker.service_account_user_id
  role                    = data.keycloak_role.manage_users.name
}
```

**Note on resource name:** The resource is `keycloak_openid_client_service_account_realm_role` (with `realm_`), NOT `keycloak_openid_client_service_account_role`. The `realm_role` variant assigns a realm-level role name; the non-realm variant assigns a client role ID. Since `manage-users` is scoped to the `realm-management` client, we need the version that can reference it by name via `data.keycloak_role`. [CITED: registry.terraform.io/providers/mrparkers/keycloak]

### Pattern 5: KC-01 VERIFY_EMAIL + access_code_lifespan update

```hcl
# Add to terraform/keycloak/main.tf

resource "keycloak_required_action" "verify_email" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "VERIFY_EMAIL"
  enabled        = true
  default_action = true
  name           = "Verify Email"
}
```

Also update `keycloak_realm.japan_trip`:
```hcl
# Current value is "5m" (300s). REQUIREMENTS.md line 19 specifies 1200s.
access_code_lifespan_user_action = "20m"  # was: "5m" — mitigates KC bug #41171
```

[VERIFIED: terraform/keycloak/main.tf line 20 shows current value "5m"]

### Pattern 6: password-forms subflow addition + KC-02 browserFlow flip (CRITICAL SEQUENCE)

The `password-forms` ALTERNATIVE branch DOES NOT exist in `flows.tf`. [VERIFIED: grep returned zero matches for "password-forms" in flows.tf]

This must be added BEFORE `browser_flow = "browser-passkey"` is set. Adding it and flipping can be in the same `terraform apply` because Terraform applies in dependency order — but the subflow must be declared before the realm attribute that references it, or they must be in the same apply run.

```hcl
# Add to terraform/keycloak/flows.tf

resource "keycloak_authentication_subflow" "password_forms" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "password-forms"
  description       = "Username + password authentication"
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 30
}

resource "keycloak_authentication_execution" "username_password_form" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.password_forms.alias
  authenticator     = "auth-username-password-form"
  requirement       = "REQUIRED"
  priority          = 10
}
```

Then in `main.tf`, change the realm:
```hcl
# Change from:
browser_flow = "browser"
# To:
browser_flow = "browser-passkey"
```

### Pattern 7: KC-03 — ALREADY EXISTS, verify only

`keycloak_required_action.webauthn_register_passwordless` is declared in `terraform/keycloak/flows.tf` lines 42-48 with `enabled = true, default_action = false`. [VERIFIED: flows.tf lines 42-48]

KC-03 is a verification step in Phase 7, not new work. The plan should include a `terraform plan` check to confirm no drift. Creating a duplicate resource will cause `terraform apply` to fail on the pre-existing state.

### Anti-Patterns to Avoid

- **Duplicate keycloak_required_action for webauthn-register-passwordless:** Already exists in flows.tf. Do NOT add another resource.
- **Using `keycloak_openid_client_service_account_role` (no `_realm_`) for manage-users:** `manage-users` is a client role in `realm-management`, not a top-level realm role. Wrong resource type causes apply failure.
- **Flipping `browser_flow` before password-forms subflow exists:** Password-only users lose login access immediately. Must add subflow first.
- **Using `wrangler.dev.toml` for local env vars:** Phase 6 used `.dev.vars` (see Open Questions). Writing to a non-existent file is a silent no-op.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT audience validation | Custom string matching | `validateAudience()` already in keycloak.ts | Existing tested helper |
| DB timezone timestamps | Manual UTC conversion | `timestamp('col', { withTimezone: true })` | Drizzle maps to TIMESTAMPTZ natively |
| KC Admin API auth | Manual client_credentials flow | Standard `fetch` with `grant_type=client_credentials` using D-03 env vars | Straightforward; no library needed for this phase |
| FTL i18n lookups | Hardcoded strings in FTL | `${msg("key")}` with messages_es.properties | KC i18n system; fallback to en built-in |

---

## Common Pitfalls

### Pitfall 1: password-forms ALTERNATIVE branch missing (BLOCKER for KC-02)
**What goes wrong:** `browser_flow = "browser-passkey"` is set in main.tf but the flow has no fallback for password-only users. Password-only users cannot log in until the flow is fixed.
**Why it happens:** flows.tf was built in Phase 6 with passkey-only paths. The password-forms subflow was described as a prerequisite but never added.
**How to avoid:** Add `password_forms` subflow + `auth-username-password-form` execution to flows.tf in the SAME commit/plan as the browserFlow flip (or a prior one). Never flip browserFlow in a separate apply without the subflow in place.
**Warning signs:** grep for "password-forms" in flows.tf returns zero results — confirmed in this research session. [VERIFIED: grep zero matches]

### Pitfall 2: KC-03 duplicate resource will break terraform apply
**What goes wrong:** Adding a new `keycloak_required_action` for `webauthn-register-passwordless` when one already exists in state causes `Error: resource already exists`.
**Why it happens:** flows.tf lines 42-48 already declare this resource with the correct values. CONTEXT.md implies it needs to be added in Phase 7.
**How to avoid:** Run `terraform state list | grep required_action` before writing any new required_action resource. Phase 7's KC-03 task is verify-only.
**Warning signs:** `keycloak_required_action.webauthn_register_passwordless` exists in flows.tf lines 42-48. [VERIFIED: flows.tf lines 42-48]

### Pitfall 3: .dev.vars vs wrangler.dev.toml mismatch
**What goes wrong:** CONTEXT.md D-03 and the discretion section reference `backend/wrangler.dev.toml` for local env vars. No such file exists. The actual convention from Phase 6 is `backend/.dev.vars` (gitignored at `.gitignore` line 48-49).
**Why it happens:** Phase 6 D-11 implemented as `.dev.vars` while CONTEXT.md used a different name.
**How to avoid:** Add `VALID_AUDIENCES`, `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET` to `backend/.dev.vars` and `backend/.dev.vars.example`. Do not create `wrangler.dev.toml`.
**Warning signs:** `backend/.dev.vars` and `backend/.dev.vars.example` exist; no `wrangler.dev.toml` found. [VERIFIED: glob]

### Pitfall 4: manage-users is a client role, not a realm role
**What goes wrong:** Using `keycloak_openid_client_service_account_realm_role` with `role = "manage-users"` when manage-users is a role inside the `realm-management` client — not a top-level realm role. The resource type distinction matters.
**Why it happens:** KC naming is confusing: there are realm roles AND client roles. `manage-users` exists on the `realm-management` built-in client.
**How to avoid:** Use the data sources `data.keycloak_openid_client.realm_management` + `data.keycloak_role.manage_users` as shown in Pattern 4. The `role` argument takes the role name string; `service_account_user_id` comes from `keycloak_openid_client.japan_trip_worker.service_account_user_id`.
**Warning signs:** `terraform apply` error mentioning unknown role or role not found on realm.

### Pitfall 5: BACK-02 TypeScript strict-mode breakage at users.ts:49 and :96
**What goes wrong:** Making `KeycloakJwtPayload.email?: string` causes TypeScript to infer `jwtUser.email` as `string | undefined`. The `getOrCreateUser` function accepts `email: string`. `npm run typecheck` fails.
**Why it happens:** CONTEXT.md says "ensureUserProvisioned already has ?? '' fallback — sufficient." That covers middleware/user.ts line 28. But `routes/users.ts` lines 49 and 96 pass `jwtUser.email` directly without a fallback. [VERIFIED: backend/src/routes/users.ts grep]
**How to avoid:** Add `?? ''` at both `jwtUser.email` calls in users.ts. Run `npm run typecheck` after BACK-02 to catch any remaining sites.
**Warning signs:** TypeScript error on `Argument of type 'string | undefined' is not assignable to parameter of type 'string'`.

---

## Code Examples

### messages_es.properties (KC 26.6.1 key values)

```properties
# encoding: UTF-8
# All keys sourced from KC 26.6.1 messages_en.properties
invalidUserMessage=Nombre de usuario o contraseña inválidos.
accountTemporarilyDisabledMessage=Cuenta temporalmente deshabilitada. Contactá al administrador o intentá de nuevo más tarde.
emailVerifyTitle=Verificación de email
emailVerifyInstruction1=Enviamos un correo a {0} con instrucciones para verificar tu dirección.
emailVerifyInstruction2=¿No recibiste el correo de verificación?
emailVerifyInstruction3=para reenviar el correo.
emailVerifyInstruction4=Para verificar tu email, te vamos a enviar instrucciones a {0}.
emailVerifyResend=Reenviar email
emailVerifySend=Enviar email
loginOtpOneTime=Código de un solo uso
errorTitle=Lo sentimos...
backToApplication=« Volver a la aplicación
doClickHere=Hacé clic aquí
doCancel=Cancelar
doLogIn=Ingresar
loginAccountTitle=Iniciá sesión en tu cuenta
webauthn-error-title=Error de clave de acceso
webauthn-error-registration=Error al registrar tu clave de acceso. {0}
webauthn-error-api-get=Error al autenticar con clave de acceso. {0}
webauthn-error-different-user=El usuario autenticado no coincide con el de la clave de acceso.
webauthn-error-auth-verification=El resultado de autenticación con clave de acceso es inválido. {0}
webauthn-error-register-verification=El resultado de registro de clave de acceso es inválido. {0}
webauthn-error-user-not-found=Usuario desconocido autenticado por la clave de acceso.
noAccount=¿No tenés cuenta?
doRegister=Registrate
usernameOrEmail=Nombre de usuario o email
password=Contraseña
rememberMe=Recordarme
doForgotPassword=¿Olvidaste tu contraseña?
```

[VERIFIED: base English key values from https://raw.githubusercontent.com/keycloak/keycloak/26.6.1/themes/src/main/resources/theme/base/login/messages/messages_en.properties]

### FTL template structure — login-otp.ftl (KC 26.6.1 base, trimmed for override)

```freemarker
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('totp'); section>
    <#if section="header">
        ${msg("doLogIn")}
    <#elseif section="form">
        <form id="kc-otp-login-form" class="${properties.kcFormClass!}"
              onsubmit="login.disabled = true; return true;"
              action="${url.loginAction}" method="post">
            <#if otpLogin.userOtpCredentials?size gt 1>
                <!-- credential selector omitted for brevity -->
            </#if>
            <div class="${properties.kcFormGroupClass!}">
                <label for="otp" class="${properties.kcLabelClass!}">${msg("loginOtpOneTime")}</label>
                <input id="otp" name="otp" autocomplete="one-time-code" type="text"
                       class="${properties.kcInputClass!}"
                       autofocus
                       aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>" dir="ltr"/>
                <#if messagesPerField.existsError('totp')>
                    <span class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('totp'))?no_esc}
                    </span>
                </#if>
            </div>
            <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}"
                   name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
        </form>
    </#if>
</@layout.registrationLayout>
```

[VERIFIED: https://raw.githubusercontent.com/keycloak/keycloak/26.6.1/themes/src/main/resources/theme/base/login/login-otp.ftl]

### FTL template structure — verify-email.ftl (KC 26.6.1 base)

Uses `<#import "template.ftl" as layout>` with `registrationLayout`. Key variables: `verifyEmail` (optional — present when link already sent), `user.email`, `isAppInitiatedAction` (optional — present when AIA), `url.loginAction`. [VERIFIED: raw GitHub 26.6.1]

### FTL template structure — error.ftl (KC 26.6.1 base)

Uses `displayMessage=false`. Key variables: `message.summary`, `traceId` (optional), `client.baseUrl` (optional), `skipLink` (optional). [VERIFIED: raw GitHub 26.6.1]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `MailHog` for local SMTP | `Mailpit v1.29` (ports 1025/8025) | Phase 6 | SMTP already wired in `keycloak_realm.smtp_server`; no change needed |
| `--import-realm` KC startup | Terraform `apply` | Phase 6 | KC config managed as HCL |
| `realm-export.json` as live config | Read-only reference snapshot | Phase 6 | Do not edit |
| `browser` flow | `browser-passkey` (Phase 7) | Phase 7 KC-02 | Requires password-forms subflow pre-existing |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `keycloak_openid_client` exports `service_account_user_id` attribute when `service_accounts_enabled = true` | Pattern 4 | Terraform plan fails; need data source lookup instead |
| A2 | `auth-username-password-form` is the correct authenticator ID for the password subflow in KC 26 | Pitfall 1 / Pattern 6 | Users cannot log in with password; flow misconfigured |
| A3 | `priority = 30` for password-forms subflow places it after passkey-forms (priority 20) | Pattern 6 | Flow priority ordering wrong; KC executes wrong path first |
| A4 | The `messages_es.properties` Spanish translations above are correct Spanish for the target audience | Code Examples | Theme shows poor/wrong Spanish text |

---

## Open Questions

1. **`wrangler.dev.toml` vs `.dev.vars` for local env vars**
   - What we know: CONTEXT.md D-03 says "local values go in `backend/wrangler.dev.toml` (gitignored)". Phase 6 actually used `backend/.dev.vars` (gitignored at `.gitignore:48-49`). No `wrangler.dev.toml` exists.
   - What's unclear: Whether the CONTEXT.md was aspirational or whether Phase 6 deviated.
   - Recommendation: Use `.dev.vars` to match Phase 6 reality. CONTEXT.md reference to `wrangler.dev.toml` appears to be a mismatch. Low risk — both mechanisms work for local Wrangler dev. Flag for user confirmation before plan execution if desired.

2. **KC Admin API base URL for `japan-trip-worker` client credentials**
   - What we know: `env.KEYCLOAK_URL/realms/env.KEYCLOAK_REALM/protocol/openid-connect/token` is the token endpoint for client credentials grant. Phase 7 creates the client and puts credentials in env vars. The actual Admin API calls are Phase 8 (PASS-05) scope.
   - What's unclear: Does Phase 7 need to verify the Admin API works end-to-end, or just that credentials are in place?
   - Recommendation: Phase 7 success criterion 4 says "Admin API calls succeed" — include a smoke test `curl` in the verification plan.

3. **`access_code_lifespan_user_action` current value is `"5m"` — needs to change to `"20m"` for KC-01**
   - What we know: `terraform/keycloak/main.tf` line 20 has `access_code_lifespan_user_action = "5m"`. REQUIREMENTS.md KC-01 specifies `1200s` (20 min) to mitigate KC bug #41171.
   - What's unclear: This attribute update was not mentioned in CONTEXT.md decisions.
   - Recommendation: Update as part of the KC-01 task. It is a one-line change in main.tf that pairs with the VERIFY_EMAIL action.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Keycloak (Docker) | All KC Terraform tasks | Must be running | 26.6.1 | Run `docker compose up -d keycloak` first |
| Terraform CLI | All TF tasks | [ASSUMED] from Phase 6 | >= 1.x | Re-run Phase 6 bootstrap if missing |
| `drizzle-kit` | BACK-03 | [ASSUMED] already installed | in package.json | `npm install` |
| `DATABASE_URL` | BACK-03 migration apply | Must be set in env | — | Set in `.dev.vars` |
| Mailpit (Docker) | KC-01 SMTP test | Running via Phase 6 docker-compose | 1.29 | `docker compose up -d mailpit` |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | `backend/vitest.config.ts` or `package.json` |
| Quick run command | `npm run test:run` (from `backend/`) |
| Full suite command | `npm run test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BACK-01 | `validateAudience` reads from env var, not hardcode | unit | `npm run test:run -- keycloak.test` | Partially — keycloak.test.ts exists but tests hardcoded valid array; needs update |
| BACK-02 | `email?: string` accepted without error | unit | `npm run test:run` | No new test file needed; existing tests must still pass |
| BACK-03 | `email_otp_codes` table exists with correct columns | manual / migration check | `drizzle-kit generate` produces expected SQL | ❌ Wave 0: migration file does not exist yet |
| BACK-04 | KC Admin client credentials accepted by KC token endpoint | smoke (manual) | `curl` against local KC | ❌ Manual verification after terraform apply |
| KC-01..04 | Terraform config correct | terraform plan | `terraform -chdir=terraform/keycloak plan` | Partially — plan validates HCL |

### Wave 0 Gaps
- [ ] Update `backend/src/auth/keycloak.test.ts` — add tests for `VALID_AUDIENCES` env extraction
- [ ] `backend/src/db/migrations/0003_add_email_otp_codes.sql` — produced by `drizzle-kit generate`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Keycloak OIDC (managed by IDP) |
| V3 Session Management | no | Stateless JWT; no server sessions |
| V4 Access Control | yes | `validateAudience` in verifyJwt |
| V5 Input Validation | yes | VALID_AUDIENCES split/trim (no user input) |
| V6 Cryptography | no | Phase 8 concern (OTP HMAC) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Audience confusion (JWT issued to wrong client) | Spoofing | BACK-01: `VALID_AUDIENCES` env var; never hardcode |
| Service account secret leak | Info disclosure | `KC_ADMIN_CLIENT_SECRET` via wrangler secret / `.dev.vars` (gitignored); never in `wrangler.toml` |
| KC Admin over-privilege | Elevation | `manage-users` role only (not `realm-admin`); dedicated `japan-trip-worker` client |

---

## Sources

### Primary (HIGH confidence)
- `backend/src/auth/keycloak.ts` — BACK-01 change site verified at line 198
- `backend/src/routes/users.ts` — BACK-02 impact at lines 49, 96 confirmed by grep
- `terraform/keycloak/flows.tf` — KC-03 already exists lines 42-48; password-forms missing confirmed by grep
- `terraform/keycloak/main.tf` — `browser_flow = "browser"` at line 26; `access_code_lifespan_user_action = "5m"` at line 20
- `backend/.dev.vars` — actual local env var file in use
- KC 26.6.1 GitHub raw FTL: login-otp.ftl, login-verify-email.ftl, error.ftl verified
- KC 26.6.1 GitHub raw messages_en.properties key values verified

### Secondary (MEDIUM confidence)
- `keycloak_required_action` resource schema — confirmed via WebSearch against registry.terraform.io [CITED: registry.terraform.io/providers/mrparkers/keycloak/latest/docs/resources/required_action]
- `keycloak_openid_client_service_account_realm_role` resource schema — confirmed via WebSearch [CITED: registry.terraform.io/providers/mrparkers/keycloak/latest/docs/resources/openid_client_service_account_realm_role]
- Drizzle `timestamp({ withTimezone: true })` → TIMESTAMPTZ — confirmed via WebSearch + existing schema.ts pattern [CITED: orm.drizzle.team/docs/column-types/pg]

### Tertiary (LOW confidence — tagged [ASSUMED])
- Terraform CLI available on machine from Phase 6
- `service_account_user_id` is an exported attribute of `keycloak_openid_client` when `service_accounts_enabled = true`

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all libraries already in repo; patterns verified in source
- Architecture: HIGH — source files read directly
- Pitfalls: HIGH — verified by direct grep/read of source files
- Terraform patterns: MEDIUM — registry docs confirmed; attribute names assumed correct

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (KC 26.6.1 stable; Terraform provider stable)
