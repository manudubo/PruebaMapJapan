# Phase 7: Backend Hardening + KC Config — Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 17
**Analogs found:** 12 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `backend/src/types/index.ts` | model/interface | — | self (lines 28-51) | exact — modify in place |
| `backend/src/auth/keycloak.ts` | service | request-response | self (lines 193-200) | exact — modify in place |
| `backend/src/auth/keycloak.test.ts` | test | — | self (lines 1-34) | exact — extend in place |
| `backend/src/routes/users.ts` | controller | request-response | self (lines 46-51, 93-97) | exact — modify in place |
| `backend/src/db/schema.ts` | model/schema | CRUD | self (`trips` table, lines 44-72) | exact — add table following same shape |
| `backend/src/db/migrations/0003_add_email_otp_codes.sql` | migration | — | `0001_add_hotel_url_activity_time.sql` | role-match |
| `backend/.dev.vars` | config | — | self (lines 1-2) | exact — extend in place |
| `backend/.dev.vars.example` | config | — | self (lines 1-2) | exact — extend in place |
| `terraform/keycloak/main.tf` (realm edit + worker client) | config/IaC | — | self (`keycloak_openid_client.japan_trip_api`, lines 82-91) | exact — modify + add block |
| `terraform/keycloak/flows.tf` (password-forms subflow) | config/IaC | — | self (`passkey_forms` subflow, lines 16-40) | exact — add block following same shape |
| `terraform/keycloak/flows.tf` (VERIFY_EMAIL required action) | config/IaC | — | self (`keycloak_required_action.webauthn_register_passwordless`, lines 42-48) | exact — add block following same shape |
| `terraform/keycloak/variables.tf` | config/IaC | — | self (lines 1-14) | exact — extend in place |
| `keycloak/themes/japan-trip/login/login.ftl` | template | request-response | no in-repo analog | none |
| `keycloak/themes/japan-trip/login/login-otp.ftl` | template | request-response | no in-repo analog | none |
| `keycloak/themes/japan-trip/login/verify-email.ftl` | template | request-response | no in-repo analog | none |
| `keycloak/themes/japan-trip/login/error.ftl` | template | request-response | no in-repo analog | none |
| `keycloak/themes/japan-trip/login/messages/messages_es.properties` | config/i18n | — | no in-repo analog | none |
| `keycloak/themes/japan-trip/login/theme.properties` | config | — | self (lines 1-8) | exact — extend in place |

---

## Pattern Assignments

### `backend/src/types/index.ts` (model/interface — modify in place)

**Analog:** self

**Env interface to extend** (lines 28-32):
```typescript
export interface Env {
  DATABASE_URL: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  // ADD below:
  VALID_AUDIENCES: string;
  KC_ADMIN_CLIENT_ID: string;
  KC_ADMIN_CLIENT_SECRET: string;
}
```

**KeycloakJwtPayload email field to change** (line 41):
```typescript
// BEFORE:
email: string;
// AFTER (BACK-02):
email?: string;
```

---

### `backend/src/auth/keycloak.ts` (service, request-response — modify in place)

**Analog:** self

**Exact line to change** (line 198):
```typescript
// BEFORE:
const validAudiences = ['japan-trip-frontend'];

// AFTER (BACK-01):
const validAudiences = env.VALID_AUDIENCES.split(',').map(s => s.trim());
```

**`extractUserInfo` already uses `?? ''` fallback** (line 254 — do NOT change):
```typescript
email: payload.email ?? '',
```

---

### `backend/src/auth/keycloak.test.ts` (test — extend in place)

**Analog:** self

**Existing test structure to extend** (lines 1-34):
```typescript
import { describe, it, expect } from 'vitest';
import { validateAudience } from './keycloak';

describe('validateAudience — SEC-04', () => {
  const valid = ['japan-trip-frontend'];
  // existing tests use hardcoded valid array
  ...
});
```

**New describe block to add** — tests that `VALID_AUDIENCES` env string is correctly parsed into an array. Copy the existing `describe` structure above and add a second block:
```typescript
describe('validateAudience — BACK-01 env extraction', () => {
  it('parses comma-separated VALID_AUDIENCES env string', () => {
    const envString = 'japan-trip-frontend, japan-trip-worker';
    const parsed = envString.split(',').map(s => s.trim());
    expect(validateAudience('japan-trip-frontend', parsed)).toBe(true);
    expect(validateAudience('japan-trip-worker', parsed)).toBe(true);
    expect(validateAudience('other', parsed)).toBe(false);
  });

  it('handles single-value VALID_AUDIENCES without trailing comma', () => {
    const parsed = 'japan-trip-frontend'.split(',').map(s => s.trim());
    expect(validateAudience('japan-trip-frontend', parsed)).toBe(true);
  });
});
```

**Note:** All tests that call `verifyJwt()` with an `env` mock must include `VALID_AUDIENCES: 'japan-trip-frontend'` in the mock object after BACK-01 lands.

---

### `backend/src/routes/users.ts` (controller, request-response — modify in place)

**Analog:** self

**Two call sites that need `?? ''` fallback** (lines 49 and 96 — same pattern both times):
```typescript
// BEFORE (line 49):
jwtUser.email,

// AFTER (BACK-02):
jwtUser.email ?? '',
```

The `getOrCreateUser` helper signature (lines 20-31) does not change — it still expects `email: string`. The fallback is applied at both call sites, not in the helper.

---

### `backend/src/db/schema.ts` (model/schema, CRUD — add table)

**Analog:** `trips` table in self (lines 44-72) for FK + timestamps pattern; `users` table (lines 20-35) for `serial` PK pattern.

**FK with cascade pattern to copy** (lines 48-51):
```typescript
user_id: integer('user_id')
  .notNull()
  .references(() => users.id, { onDelete: 'cascade' }),
```

**Timestamp with timezone pattern to copy** (lines 29-30):
```typescript
created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
```

**New table to add** — place after the `activities` block at line 175:
```typescript
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

**Import list at top (lines 1-14) already has** `serial`, `integer`, `text`, `timestamp` — no new imports needed. Do NOT add any.

---

### `backend/src/db/migrations/0003_add_email_otp_codes.sql` (migration — generated file)

**Analog:** `backend/src/db/migrations/0001_add_hotel_url_activity_time.sql`

This file is produced by `drizzle-kit generate`, not hand-written. Run:
```bash
cd backend && npx drizzle-kit generate
```

Expected output shape (for verification only — do not hand-write):
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

Naming convention: existing files use `0000_initial.sql`, `0001_add_hotel_url_activity_time.sql`, `0002_add_public_slug.sql` — `drizzle-kit generate` will auto-name the file; rename to `0003_add_email_otp_codes.sql` if needed.

---

### `backend/.dev.vars` (config — extend in place)

**Analog:** self (lines 1-2)

**Existing content:**
```
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
```

**Add three lines** (BACK-01 + BACK-04 D-03):
```
VALID_AUDIENCES=japan-trip-frontend
KC_ADMIN_CLIENT_ID=japan-trip-worker
KC_ADMIN_CLIENT_SECRET=<generate-uuid-locally>
```

---

### `backend/.dev.vars.example` (config — extend in place)

**Analog:** self (lines 1-2); mirror `.dev.vars` structure with placeholder values:
```
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
VALID_AUDIENCES=japan-trip-frontend
KC_ADMIN_CLIENT_ID=japan-trip-worker
KC_ADMIN_CLIENT_SECRET=replace-with-local-uuid
```

---

### `terraform/keycloak/main.tf` — realm edit + worker client (config/IaC — modify + add blocks)

**Analog:** self

**Line to change in realm resource** (line 26):
```hcl
# BEFORE:
browser_flow = "browser"

# AFTER (KC-02):
browser_flow = "browser-passkey"
```

**Line to change for KC-01** (line 20):
```hcl
# BEFORE:
access_code_lifespan_user_action = "5m"

# AFTER:
access_code_lifespan_user_action = "20m"
```

**`japan_trip_api` block pattern to copy for new worker client** (lines 82-91):
```hcl
resource "keycloak_openid_client" "japan_trip_api" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-api"
  name      = "Japan Trip API"
  enabled   = true

  access_type           = "BEARER-ONLY"
  standard_flow_enabled = false
  full_scope_allowed    = false
}
```

**New blocks to add** — append after `japan_trip_api` block:
```hcl
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

data "keycloak_openid_client" "realm_management" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "realm-management"
}

resource "keycloak_openid_client_service_account_role" "worker_manage_users" {
  realm_id                = keycloak_realm.japan_trip.id
  service_account_user_id = keycloak_openid_client.japan_trip_worker.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = "manage-users"
}

resource "keycloak_required_action" "verify_email" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "VERIFY_EMAIL"
  enabled        = true
  default_action = true
  name           = "Verify Email"
}
```

**Critical:** Use `keycloak_openid_client_service_account_role` (no `_realm_` infix) — `manage-users` is a CLIENT role on `realm-management`, not a top-level realm role. See RESEARCH.md Pitfall 4.

---

### `terraform/keycloak/flows.tf` — password-forms subflow (config/IaC — add blocks)

**Analog:** `passkey_forms` subflow + `username_form` execution in self (lines 16-40):
```hcl
resource "keycloak_authentication_subflow" "passkey_forms" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-forms"
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 20
}

resource "keycloak_authentication_execution" "username_form" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  authenticator     = "auth-username-form"
  requirement       = "REQUIRED"
  priority          = 10
}
```

**New blocks to add** — append after `webauthn_passwordless` execution (line 40), BEFORE `keycloak_required_action.webauthn_register_passwordless`:
```hcl
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

**KC-03 is already done** — `keycloak_required_action.webauthn_register_passwordless` exists at lines 42-48 with correct values. Do NOT add a duplicate resource.

---

### `terraform/keycloak/variables.tf` (config/IaC — extend in place)

**Analog:** self (lines 1-14). Existing pattern for sensitive variables:
```hcl
variable "kc_admin_pass" {
  type      = string
  sensitive = true
}
```

No new variables are needed for `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` in the Terraform module itself — these are Cloudflare Worker env bindings (`.dev.vars`), not Terraform inputs. The Terraform provider only needs `kc_url`, `kc_admin_user`, `kc_admin_pass` (already present) to apply realm changes.

---

### `keycloak/themes/japan-trip/login/theme.properties` (config — extend in place)

**Analog:** self (lines 1-8)

**Current content:**
```properties
parent=keycloak
import=common/keycloak

styles=css/login.css
kcHtmlClass=login-pf
kcBodyClass=login-pf-background
appUrl=http://localhost:5173/PruebaMapJapan/
```

**Add two lines** (D-06):
```properties
locales=es,en
defaultLocale=es
```

---

## Shared Patterns

### Drizzle timestamp with timezone (apply to: `schema.ts` emailOtpCodes table)
**Source:** `backend/src/db/schema.ts` lines 29-30 (users) and 58-59 (trips)
```typescript
timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
```
Use for every timestamp column in `emailOtpCodes`. Nullable timestamps (`used_at`) omit `.notNull()`.

### Drizzle FK with cascade (apply to: `schema.ts` emailOtpCodes.user_id)
**Source:** `backend/src/db/schema.ts` lines 48-51 (trips.user_id)
```typescript
integer('user_id')
  .notNull()
  .references(() => users.id, { onDelete: 'cascade' })
```

### `?? ''` fallback for optional string JWT claims (apply to: `routes/users.ts` lines 49, 96)
**Source:** `backend/src/auth/keycloak.ts` line 254
```typescript
email: payload.email ?? '',
```
This is the established pattern for optional JWT string fields where downstream code expects `string`.

### Keycloak required_action resource shape (apply to: VERIFY_EMAIL resource in main.tf)
**Source:** `terraform/keycloak/flows.tf` lines 42-48
```hcl
resource "keycloak_required_action" "webauthn_register_passwordless" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "webauthn-register-passwordless"
  enabled        = true
  default_action = false
  name           = "Webauthn Register Passwordless"
}
```
Note: uses `.realm` (string) not `.id` (UUID) for `realm_id`. Copy this exactly.

### FTL import and layout macro (apply to: all four new FTL files)
**Source:** `keycloak/themes/japan-trip/login/footer.ftl` lines 1-6 shows the macro convention.
**Branding reference:** `keycloak/themes/japan-trip/login/resources/css/login.css` lines 8-24 — CSS custom properties (`--jp-bg`, `--jp-accent`, `--jp-font`, `--jp-surface`, `--jp-danger`) are the visual contract. FTL files reference `${properties.kcFormClass!}` etc. from `theme.properties`; custom classes like `jp-idp-footer` are in `login.css` and available to all FTL overrides.

---

## No Analog Found

Files with no close match in the codebase (planner must use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `keycloak/themes/japan-trip/login/login.ftl` | template | request-response | Only existing FTL is the trivial 6-line `footer.ftl` macro; no full-page template in repo |
| `keycloak/themes/japan-trip/login/login-otp.ftl` | template | request-response | Same — no full-page FTL overrides exist |
| `keycloak/themes/japan-trip/login/verify-email.ftl` | template | request-response | Same — no full-page FTL overrides exist |
| `keycloak/themes/japan-trip/login/error.ftl` | template | request-response | Same — no full-page FTL overrides exist |
| `keycloak/themes/japan-trip/login/messages/messages_es.properties` | config/i18n | — | No `messages/` directory exists yet in the theme |

**Planner instructions for FTL files:**
- Use KC 26.6.1 upstream base templates from RESEARCH.md Code Examples as the starting structure.
- Override markup to use CSS classes/variables from `keycloak/themes/japan-trip/login/resources/css/login.css` (branding reference per D-07).
- All user-visible strings must use `${msg("key")}` referencing `messages_es.properties` keys (D-05).
- FTL files must begin with `<#import "template.ftl" as layout>` and use `<@layout.registrationLayout ...>`.

**Planner instructions for messages_es.properties:**
- First line must be `#encoding=UTF-8` (KC requirement for non-ASCII).
- RESEARCH.md Code Examples section contains the full key list with verified Spanish translations — copy directly.

---

## Metadata

**Analog search scope:** `backend/src/`, `terraform/keycloak/`, `keycloak/themes/japan-trip/login/`, `backend/src/db/migrations/`
**Files read:** 14
**Pattern extraction date:** 2026-05-19
