# Phase 6: Local Infrastructure — Research

**Researched:** 2026-05-15
**Domain:** Terraform IaC (Keycloak realm + Cloudflare Worker secrets) / Mailpit local SMTP / Wrangler local dev config
**Confidence:** HIGH (provider schemas verified via Context7 + GitHub source; Mailpit via official docs)

---

## CONTEXT.md Conflicts (Discuss-Phase Required)

Two locked decisions in CONTEXT.md contain factual errors discovered during research. The planner MUST NOT implement these as written. They require user re-confirmation before planning proceeds.

### CONFLICT-01 — Provider registry path (D-04)

**Locked decision:** `mrparkers/keycloak >= 5.7.0`

**Finding:** Version 5.x of the Keycloak Terraform provider is published ONLY under `keycloak/keycloak` on the Terraform Registry. The `mrparkers/keycloak` registry namespace stopped at 4.x. The Keycloak project officially adopted the provider in December 2024 (`keycloak/terraform-provider-keycloak`). The `>= 5.7.0` version constraint is satisfiable only via the `keycloak/keycloak` source. [VERIFIED: https://github.com/keycloak/terraform-provider-keycloak/blob/main/CHANGELOG.md — v5.7.0 released 2026-02-20; search results confirming mrparkers stopped at 4.x]

**Corrected `required_providers` block:**
```hcl
terraform {
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = ">= 5.7.0"
    }
  }
}
```

**Action:** User must confirm switch from `mrparkers/keycloak` to `keycloak/keycloak` in required_providers. The resource schema is identical (same codebase, transferred ownership). No HCL changes beyond the source string.

---

### CONFLICT-02 — wrangler.dev.toml does not exist as a Wrangler pattern (D-11)

**Locked decision:** "Create `wrangler.dev.toml` for local dev overrides (KEYCLOAK_URL, KEYCLOAK_REALM); `wrangler.dev.toml` is gitignored."

**Finding:** Wrangler does NOT support a file named `wrangler.dev.toml`. There is no mechanism in Wrangler that auto-loads a secondary TOML config file for local dev. The native Wrangler patterns for local-only variable overrides are: [VERIFIED: https://developers.cloudflare.com/workers/wrangler/configuration/]
1. **`.dev.vars`** — dotenv-format file in the same directory as `wrangler.toml`; auto-loaded by `wrangler dev`; gitignored.
2. **`[dev.vars]` block** inside `wrangler.toml` — inline local-only vars; committed to git (so only non-secret values).

**Corrected approach for D-11:**
- Remove `KEYCLOAK_URL` and `KEYCLOAK_REALM` from `wrangler.toml` `[vars]` section (currently they're empty strings, so this is correct).
- Create `backend/.dev.vars` (gitignored) with:
  ```
  KEYCLOAK_URL=http://localhost:8080
  KEYCLOAK_REALM=japan-trip
  ```
- Commit a `backend/.dev.vars.example` with placeholder values for reference.
- `wrangler dev` auto-loads `.dev.vars` from the same directory as `wrangler.toml`.

**Action:** User must confirm `.dev.vars` replaces the planned `wrangler.dev.toml`. Both achieve the same goal; only the filename and format differ.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: `terraform/` directory at project root (not nested under `keycloak/`).
- D-02: Two separate child modules: `terraform/keycloak/` and `terraform/cloudflare/`. Each has its own provider, variables, outputs. Applied independently.
- D-03: Local vars via `.tfvars` per module (`terraform/keycloak/local.tfvars`, `terraform/cloudflare/local.tfvars`), both gitignored. Template `.tfvars.example` files committed.
- D-04: KC provider: `mrparkers/keycloak >= 5.7.0`. CF provider: `cloudflare/cloudflare`. (**See CONFLICT-01 above — source must be `keycloak/keycloak`**.)
- D-05: `terraform/keycloak/` manages: `keycloak_realm`, `keycloak_openid_client` (japan-trip-frontend), `keycloak_required_action`, auth flow executions, `webAuthnPolicyPasswordlessRpId`. All realm config in realm-export.json → HCL.
- D-06: `realm-export.json` becomes read-only reference with comment annotation.
- D-07: `--import-realm` removed from docker-compose once local `terraform apply` confirmed working.
- D-08: TF connects to local KC at `http://localhost:8080` with admin credentials from `local.tfvars`. Boot order: `docker compose up -d keycloak` → `terraform apply`.
- D-09: `terraform/cloudflare/` defines `cloudflare_worker_secret` for `RESEND_API_KEY` and `KC_ADMIN_CLIENT_SECRET`. HCL written and committed but NOT applied in Phase 6.
- D-10: Phase 6 validates CF HCL via `terraform init` + `terraform plan` with mock values only.
- D-11: `wrangler.toml` loses `KEYCLOAK_URL` and `KEYCLOAK_REALM`; local dev uses `wrangler.dev.toml`. (**See CONFLICT-02 above — correct mechanism is `backend/.dev.vars`.**)
- D-12: Mailpit v1.29 added to `keycloak/docker-compose.yml` on ports `1025:1025` and `8025:8025`. No MailHog removal needed.
- D-13: Wire Mailpit as KC realm SMTP in Phase 6. `smtpServer` block added to `realm-export.json` pointing to `mailpit:1025`.
- D-14: Mailpit SMTP: `host: mailpit`, `port: 1025`, `from: noreply@japan-trip.local`, `ssl: false`, `auth: false`.

### Claude's Discretion
- Exact HCL resource structure (file layout, resource naming conventions) — follow `mrparkers/keycloak` provider docs
- `main.tf` + `variables.tf` + `outputs.tf` split vs single file — split preferred
- KC module provider config (timeout, TLS skip verify for local)
- Whether `terraform plan` mock-apply in CI or local — local is fine
- Bootstrap order documentation format

### Deferred Ideas (OUT OF SCOPE)
- Actual `terraform apply` against real Cloudflare — deferred to production deployment phase
- Terraform Neon module
- `VERIFY_EMAIL` Required Action enablement — Phase 7
- Production SMTP (Resend) wiring
- KC admin UI browser flow changes (`browser-passkey` switch) — Phase 7
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Terraform KC module manages all realm config as HCL; `realm-export.json` becomes read-only; `--import-realm` removed | `keycloak_realm`, `keycloak_openid_client`, `keycloak_authentication_flow`, `keycloak_authentication_subflow`, `keycloak_authentication_execution`, `keycloak_required_action` resources verified; provider schema documented |
| INFRA-02 | Terraform CF module manages Worker secrets via `cloudflare_worker_secret`; no plaintext in `wrangler.toml` | `cloudflare_worker_secret` schema verified; `wrangler.toml` `[vars]` removal strategy documented |
| INFRA-03 | Mailpit v1.29 in docker-compose on ports 1025/8025 with REST API at `/api/v1/messages` | Mailpit Docker image, port config, and REST API verified via official docs |
</phase_requirements>

---

## Summary

Phase 6 is a pure infrastructure phase: no frontend/backend TypeScript changes, no user-visible behavior. The three workstreams are (1) greenfield Terraform for KC realm IaC, (2) a Cloudflare secrets module that is written but not applied, and (3) swapping in Mailpit for local email testing.

The KC Terraform module is the most complex deliverable. The `realm-export.json` must be translated in full to HCL: realm settings, two WebAuthn policy blocks, one public PKCE client, two auth flows (`browser-passkey` top-level + `passkey-forms` subflow), and two existing Required Actions. The provider schema supports all of this through discrete resources. KC 26.6.1 is the CI test target for the `keycloak/keycloak` provider 5.7.0, so no compatibility risk.

Two decisions from the discuss phase require correction before planning: the KC provider source (`mrparkers/keycloak` → `keycloak/keycloak`) and the wrangler local override mechanism (`wrangler.dev.toml` → `.dev.vars`). Both are mechanical fixes with no impact on the rest of the plan.

**Primary recommendation:** Plan the KC Terraform module as six resource types in dependency order: `keycloak_realm` → `keycloak_openid_client` + `keycloak_openid_audience_protocol_mapper` → `keycloak_authentication_flow` + `keycloak_authentication_subflow` + `keycloak_authentication_execution`. Apply against running KC container, then remove `--import-realm`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| KC realm configuration | Local IaC (Terraform) | KC container (applies state) | Realm config is auth-server state managed as code |
| KC SMTP (Mailpit wiring) | KC realm config (TF) | docker-compose (Mailpit service) | SMTP is a realm property; Mailpit provides the server |
| Cloudflare Worker secrets | IaC (Terraform CF module) | Cloudflare API (future apply) | Secrets are CF-side state; TF declares intent |
| Local Wrangler dev vars | Backend local config (.dev.vars) | — | Wrangler picks up .dev.vars automatically for `wrangler dev` |
| docker-compose changes | Local infra config | — | Adding Mailpit service; removing --import-realm flag |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| keycloak/keycloak (TF provider) | >= 5.7.0 | KC realm IaC | Official Keycloak-maintained provider; KC 26.6.1 tested in CI |
| cloudflare/cloudflare (TF provider) | >= 4.0 | CF Worker secrets IaC | Official Cloudflare provider |
| axllent/mailpit (Docker image) | v1.29 | Local SMTP test server | Lightweight, REST API for E2E tests, active maintenance |
| Terraform CLI | >= 1.5 | IaC execution engine | Industry standard; required by both providers |

[VERIFIED: keycloak provider 5.7.0 — https://github.com/keycloak/terraform-provider-keycloak/blob/main/CHANGELOG.md]
[VERIFIED: Mailpit v1.29.x series — https://github.com/axllent/mailpit/releases]
[ASSUMED: Terraform CLI >= 1.5 minimum — standard for modern provider requirements; not version-checked against provider docs]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| keycloak/keycloak TF provider | Keycloak Admin REST API calls (shell scripts) | Scripts are stateless/idempotent-fragile; TF manages drift |
| Mailpit | MailHog | MailHog is unmaintained; Mailpit has REST API needed for Phase 9 E2E |

---

## Architecture Patterns

### System Architecture Diagram

```
terraform/keycloak/
  local.tfvars  →  provider "keycloak" { url=http://localhost:8080 }
       │
       ▼
  keycloak_realm "japan-trip"
       │
       ├──► keycloak_openid_client "japan-trip-frontend" (PUBLIC, PKCE S256)
       │         └──► keycloak_openid_audience_protocol_mapper
       │
       ├──► keycloak_authentication_flow "browser-passkey" (top-level)
       │         ├──► keycloak_authentication_execution (auth-cookie, ALTERNATIVE, priority=10)
       │         └──► keycloak_authentication_subflow "passkey-forms" (ALTERNATIVE, priority=20)
       │                   ├──► keycloak_authentication_execution (auth-username-form, REQUIRED, priority=10)
       │                   └──► keycloak_authentication_execution (webauthn-authenticator-passwordless, REQUIRED, priority=20)
       │
       └──► keycloak_required_action (webauthn-register-passwordless)

terraform/cloudflare/                     [written but NOT applied in Phase 6]
  local.tfvars  →  provider "cloudflare" { }
       └──► cloudflare_worker_secret "RESEND_API_KEY"
       └──► cloudflare_worker_secret "KC_ADMIN_CLIENT_SECRET"

keycloak/docker-compose.yml:
  postgres ──► keycloak (KC 26.6.1, --import-realm REMOVED)
  mailpit  (ports 1025:1025, 8025:8025)
       └──► KC realm smtpServer: host=mailpit port=1025

backend/wrangler.toml:  [vars] section — KEYCLOAK_URL + KEYCLOAK_REALM removed
backend/.dev.vars:      KEYCLOAK_URL=http://localhost:8080, KEYCLOAK_REALM=japan-trip [gitignored]
```

### Recommended Project Structure

```
terraform/
├── keycloak/
│   ├── main.tf          # keycloak_realm + all realm resources
│   ├── variables.tf     # var.kc_url, var.kc_admin_user, var.kc_admin_pass
│   ├── outputs.tf       # output realm_id etc.
│   ├── versions.tf      # required_providers { keycloak = { source = "keycloak/keycloak" } }
│   ├── local.tfvars.example   # committed placeholder
│   └── local.tfvars           # gitignored — real credentials
└── cloudflare/
    ├── main.tf          # cloudflare_worker_secret resources
    ├── variables.tf     # var.cf_account_id, var.cf_api_token, var.resend_api_key, var.kc_admin_secret
    ├── versions.tf      # required_providers { cloudflare = { source = "cloudflare/cloudflare" } }
    ├── local.tfvars.example   # committed placeholder (mock values)
    └── local.tfvars           # gitignored
```

### Pattern 1: KC Provider — Password Grant for Local Admin

The `admin-cli` KC client supports password grant with the bootstrap admin credentials. `tls_insecure_skip_verify = true` is required because local KC runs HTTP (not HTTPS). [VERIFIED: https://github.com/keycloak/terraform-provider-keycloak/blob/main/docs/index.md]

```hcl
# terraform/keycloak/versions.tf
terraform {
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = ">= 5.7.0"
    }
  }
}

provider "keycloak" {
  client_id               = "admin-cli"
  username                = var.kc_admin_user
  password                = var.kc_admin_pass
  url                     = var.kc_url
  tls_insecure_skip_verify = true
}
```

### Pattern 2: keycloak_realm with SMTP and WebAuthn Passwordless

Both `web_authn_policy` and `web_authn_passwordless_policy` are separate blocks. The `smtp_server` block's `auth` sub-block is entirely optional — omit it for Mailpit (no-auth SMTP). [VERIFIED: https://github.com/mrparkers/terraform-provider-keycloak/blob/master/docs/resources/realm.md]

```hcl
resource "keycloak_realm" "japan_trip" {
  realm        = "japan-trip"
  enabled      = true
  display_name = "Japan Trip"
  login_theme  = "japan-trip"

  registration_allowed       = true
  login_with_email_allowed   = true
  duplicate_emails_allowed   = false
  reset_password_allowed     = true
  edit_username_allowed      = false

  ssl_required = "external"

  access_token_lifespan             = 300
  sso_session_idle_timeout          = 1800
  sso_session_max_lifespan          = 36000
  offline_session_idle_timeout      = 2592000
  access_code_lifespan              = 60
  access_code_lifespan_user_action  = 300
  access_code_lifespan_login        = 1800

  password_policy = "length(8) and upperCase(1) and digits(1) and specialChars(1)"

  browser_flow = "browser"  # keep as-is in Phase 6; browser-passkey switch is Phase 7

  # Standard (non-passwordless) WebAuthn policy
  web_authn_policy {
    relying_party_entity_name = "japan-trip"
    relying_party_id          = ""
    signature_algorithms      = ["ES256"]
  }

  # Passwordless WebAuthn policy — webAuthnPolicyPasswordlessRpId = "localhost"
  web_authn_passwordless_policy {
    relying_party_entity_name     = "japan-trip"
    relying_party_id              = "localhost"
    signature_algorithms          = ["ES256"]
    authenticator_attachment      = "platform"
    require_resident_key          = "Yes"
    user_verification_requirement = "required"
  }

  smtp_server {
    host = "mailpit"
    port = 1025
    from = "noreply@japan-trip.local"
    ssl  = false
    # auth block omitted — Mailpit requires no authentication
  }
}
```

### Pattern 3: Public PKCE Client with Audience Mapper

`keycloak_openid_audience_protocol_mapper` is a separate resource — NOT an embedded block in `keycloak_openid_client`. [VERIFIED: https://github.com/mrparkers/terraform-provider-keycloak/blob/master/docs/resources/openid_audience_protocol_mapper.md]

```hcl
resource "keycloak_openid_client" "japan_trip_frontend" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-frontend"
  name      = "Japan Trip Frontend"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  pkce_code_challenge_method   = "S256"
  direct_access_grants_enabled = false

  valid_redirect_uris            = ["http://localhost:5173/*", "https://*.github.io/*"]
  valid_post_logout_redirect_uris = ["http://localhost:5173/*", "https://*.github.io/*"]
  web_origins                    = ["+"]

  full_scope_allowed = true
}

resource "keycloak_openid_audience_protocol_mapper" "audience" {
  realm_id                 = keycloak_realm.japan_trip.id
  client_id                = keycloak_openid_client.japan_trip_frontend.id
  name                     = "audience-mapper"
  included_client_audience = keycloak_openid_client.japan_trip_frontend.client_id
  add_to_id_token          = false
  add_to_access_token      = true
}
```

### Pattern 4: Authentication Flow + Subflow + Executions

Executions inside a subflow use the subflow's alias as `parent_flow_alias`. For KC >= 25, `priority` argument controls ordering (no `depends_on` needed). [VERIFIED: https://github.com/keycloak/terraform-provider-keycloak/blob/main/docs/resources/authentication_subflow.md + docs/resources/authentication_execution.md]

```hcl
resource "keycloak_authentication_flow" "browser_passkey" {
  realm_id = keycloak_realm.japan_trip.id
  alias    = "browser-passkey"
}

resource "keycloak_authentication_execution" "cookie" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  authenticator     = "auth-cookie"
  requirement       = "ALTERNATIVE"
  priority          = 10
}

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

resource "keycloak_authentication_execution" "webauthn_passwordless" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  authenticator     = "webauthn-authenticator-passwordless"
  requirement       = "REQUIRED"
  priority          = 20
}
```

### Pattern 5: Cloudflare Worker Secret

All four arguments are required. `secret_text` is sensitive and sourced from `.tfvars`. `script_name` is the Worker name from `wrangler.toml` (`name = "prueba-map-japan-api"`). [VERIFIED: https://github.com/cloudflare/terraform-provider-cloudflare/blob/master/docs/resources/worker_secret.md]

```hcl
resource "cloudflare_worker_secret" "resend_api_key" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "RESEND_API_KEY"
  secret_text = var.resend_api_key
}

resource "cloudflare_worker_secret" "kc_admin_client_secret" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "KC_ADMIN_CLIENT_SECRET"
  secret_text = var.kc_admin_client_secret
}
```

### Pattern 6: Mailpit in docker-compose

No auth env vars needed for Mailpit when KC connects without auth. [VERIFIED: https://mailpit.axllent.org/docs/install/docker/]

```yaml
mailpit:
  image: axllent/mailpit:v1.29
  ports:
    - "1025:1025"
    - "8025:8025"
  restart: unless-stopped
```

### Anti-Patterns to Avoid

- **Using `mrparkers/keycloak` as source string:** v5.x does not exist under this namespace. Use `keycloak/keycloak`.
- **Creating `wrangler.dev.toml`:** Not recognized by Wrangler. Use `backend/.dev.vars` instead.
- **Embedding protocol mappers inside keycloak_openid_client:** The provider does not support an inline `protocol_mappers` block; use separate `keycloak_openid_audience_protocol_mapper` resources.
- **Applying CF Terraform in Phase 6:** Phase 6 is plan-only for the CF module. Applying requires real Cloudflare credentials and is deferred.
- **Removing `--import-realm` before `terraform apply` succeeds:** Confirm TF apply works first (D-07). If TF apply fails and `--import-realm` is already removed, KC starts without a realm.
- **Setting `browser_flow = "browser-passkey"` in Phase 6:** This is Phase 7 work. The passkey flow HCL is created in Phase 6 but not activated.
- **Using `depends_on` for execution ordering:** KC >= 25 uses the `priority` argument. Since KC 26.6.1 is the target, use `priority` only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| KC realm SMTP config | Manual Admin API curl calls | `smtp_server` block in `keycloak_realm` TF resource | TF manages drift; curl scripts are not idempotent |
| KC authentication flow ordering | `depends_on` chains | `priority` argument on executions (KC >= 25) | KC 26 supports priority natively |
| Local variable override in Wrangler | Custom config loader | `.dev.vars` file | Native Wrangler mechanism, auto-loaded |
| Mailpit readiness check | Custom polling scripts | docker-compose `healthcheck` | Compose handles dependency ordering |

---

## Common Pitfalls

### Pitfall 1: KC container must be running before TF apply
**What goes wrong:** `terraform apply` fails with "connection refused" if KC isn't healthy yet.
**Why it happens:** KC 26 takes 10-30 seconds to start; the TF provider connects immediately.
**How to avoid:** Either add a KC healthcheck to docker-compose and document the boot sequence (up → wait for healthy → apply), or add a wait-for-healthy step in the apply script. The existing `apply-local-settings.sh` shows the curl poll pattern.
**Warning signs:** `Error: error connecting to Keycloak: ... connection refused`

### Pitfall 2: browser-passkey flow activated too early
**What goes wrong:** If `browser_flow = "browser-passkey"` is set in Phase 6 KC HCL, all logins require a passkey. Password-only users are locked out.
**Why it happens:** The flow switch is a single-line change but has immediate effect.
**How to avoid:** Keep `browser_flow = "browser"` in Phase 6. The passkey flow HCL is created (so it exists in KC) but the binding is not changed until Phase 7 after the password-forms ALTERNATIVE branch is added.
**Warning signs:** Users cannot log in with password after `terraform apply`.

### Pitfall 3: Protocol mappers are NOT inline in keycloak_openid_client
**What goes wrong:** Attempting to add a `protocol_mappers` block inside `keycloak_openid_client` causes a provider schema error.
**Why it happens:** The mrparkers/keycloak provider requires separate mapper resources.
**How to avoid:** Always use `keycloak_openid_audience_protocol_mapper` (or other `keycloak_openid_*_protocol_mapper`) resources referencing `client_id`.

### Pitfall 4: keycloak_realm internal_id conflict on re-import
**What goes wrong:** If KC was previously seeded with `realm-export.json` (which embeds `"id": "japan-trip"` and `"realm": "japan-trip"`), running `terraform apply` for the first time creates a second realm OR fails if the realm already exists.
**Why it happens:** `realm-export.json` was previously imported on KC startup (`--import-realm`). If `--import-realm` is not yet removed, both mechanisms try to manage the same realm.
**How to avoid:** The correct sequence is: (1) `terraform apply` creates/confirms realm; (2) only then remove `--import-realm` from docker-compose; (3) restart KC without `--import-realm`. Alternatively: `terraform import keycloak_realm.japan_trip japan-trip` to adopt the existing realm into TF state.
**Warning signs:** `Error: realm already exists`

### Pitfall 5: CF module plan requires valid account_id even for mock
**What goes wrong:** `terraform plan` against the CF module fails if `account_id` is not a plausible-looking string (UUID format), even with mock values.
**Why it happens:** Some providers validate argument format at plan time.
**How to avoid:** Use a realistic-looking fake UUID in `local.tfvars.example`: `cf_account_id = "00000000000000000000000000000000"`.

### Pitfall 6: webAuthnPolicyPasswordlessRpId = "" vs "localhost"
**What goes wrong:** Setting `relying_party_id = ""` in `web_authn_passwordless_policy` (not non-passwordless) would break passkey registration.
**Why it happens:** realm-export.json has two WebAuthn policy sections. The non-passwordless one has `webAuthnPolicyRpId = ""` (empty, correct). The passwordless one has `webAuthnPolicyPasswordlessRpId = "localhost"` (must be preserved).
**How to avoid:** `web_authn_policy` block → `relying_party_id = ""`; `web_authn_passwordless_policy` block → `relying_party_id = "localhost"`. Never mix these up.

### Pitfall 7: Mailpit service name as SMTP hostname
**What goes wrong:** Using `localhost` or `127.0.0.1` as SMTP host in the KC realm config fails inside Docker.
**Why it happens:** KC container resolves `mailpit` via docker-compose internal DNS, not host loopback.
**How to avoid:** Use the docker-compose service name `mailpit` as the host in both the TF `smtp_server` block and any `realm-export.json` `smtpServer` annotation.

---

## Runtime State Inventory

> Phase 6 creates new Terraform state files (local); it does not rename or migrate existing state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | KC realm `japan-trip` already exists in KC Postgres DB (seeded via `--import-realm`) | TF import (`terraform import keycloak_realm.japan_trip japan-trip`) before first apply, OR apply before removing --import-realm |
| Live service config | `keycloak/docker-compose.yml` currently runs `--import-realm`; removing it is a docker-compose edit | Edit file; `docker compose up -d` applies change on next restart |
| OS-registered state | None — no OS-level service registration for KC or Mailpit | None |
| Secrets/env vars | `backend/wrangler.toml [vars]` contains `KEYCLOAK_URL = ""` and `KEYCLOAK_REALM = ""`; these move to `backend/.dev.vars` | Remove from wrangler.toml; create .dev.vars |
| Build artifacts | TF state (`terraform.tfstate`) created locally in each module dir — gitignored | Add to .gitignore; not committed |

---

## Code Examples

### keycloak_required_action
[VERIFIED: https://github.com/keycloak/terraform-provider-keycloak/blob/main/docs/resources/required_action.md]

```hcl
resource "keycloak_required_action" "webauthn_register_passwordless" {
  realm_id = keycloak_realm.japan_trip.realm
  alias    = "webauthn-register-passwordless"
  enabled  = true
  name     = "Webauthn Register Passwordless"
}
```

### variables.tf (KC module)
```hcl
variable "kc_url" {
  type    = string
  default = "http://localhost:8080"
}

variable "kc_admin_user" {
  type    = string
  default = "admin"
}

variable "kc_admin_pass" {
  type      = string
  sensitive = true
}
```

### local.tfvars.example (KC module)
```hcl
kc_url        = "http://localhost:8080"
kc_admin_user = "admin"
kc_admin_pass = "REPLACE_WITH_ADMIN_PASSWORD"
```

### local.tfvars.example (CF module)
```hcl
cf_account_id          = "00000000000000000000000000000000"
cf_api_token           = "REPLACE_WITH_CF_API_TOKEN"
resend_api_key         = "REPLACE_WITH_RESEND_API_KEY"
kc_admin_client_secret = "REPLACE_WITH_KC_ADMIN_CLIENT_SECRET"
```

### realm-export.json smtpServer block (annotation target)
Add this block to realm-export.json as reference annotation (TF is authoritative):
```json
"smtpServer": {
  "host": "mailpit",
  "port": "1025",
  "from": "noreply@japan-trip.local",
  "ssl": "false",
  "starttls": "false",
  "auth": "false"
}
```

### .dev.vars (gitignored, for wrangler dev)
```
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
```

### .dev.vars.example (committed)
```
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `mrparkers/keycloak` TF provider | `keycloak/keycloak` (Keycloak-org maintained) | Dec 2024 (adoption) / Jan 2025 (v5.0) | Source string changes; resources identical |
| `depends_on` for execution ordering | `priority` argument on executions | KC 25 | Simpler, no artificial dependency chains |
| `protocol_mappers` inline in client | Separate `keycloak_openid_*_protocol_mapper` resources | Always in mrparkers provider | Separate resources are the required pattern |

**Deprecated/outdated:**
- `mrparkers/keycloak`: Still resolves on Terraform Registry (latest 4.x) but v5.x features only exist under `keycloak/keycloak`. Use `keycloak/keycloak` for new projects.
- `MailHog`: Unmaintained; no REST API. Mailpit is the active replacement.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | docker-compose (Mailpit + KC) | ✓ | 29.3.1 | — |
| Docker Compose | Local dev stack | ✓ | v5.1.1 | — |
| Terraform CLI | `terraform init/plan/apply` | ✗ | — | Must install before Phase 6 execution |
| Node.js | Existing toolchain | ✓ (assumed) | — | — |

**Missing dependencies with no fallback:**
- **Terraform CLI**: Not installed on this machine. Plan tasks must include an install step or the user must install Terraform before running apply commands. [VERIFIED: `terraform version` returned "command not found"]

**Terraform installation on Windows:**
```powershell
winget install HashiCorp.Terraform
# or via chocolatey:
choco install terraform
# verify:
terraform version
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (frontend/backend unit tests) + Playwright (E2E) |
| Config file | `vitest.config.ts` per workspace |
| Quick run command | `npm run test:run` |
| Full suite command | `npm run test:all` |

### Phase Requirements → Test Map

Phase 6 is infrastructure-only (no TypeScript code). Tests for INFRA requirements are integration/smoke tests against the running stack, not unit tests.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | `terraform apply` against local KC succeeds; realm exists | smoke (manual gate) | `terraform apply -auto-approve -var-file=local.tfvars` | ❌ Wave 0 — no TF files yet |
| INFRA-01 | `realm-export.json` has read-only annotation comment | lint (manual) | Verify by reading file | ✅ (will be edited) |
| INFRA-01 | `--import-realm` absent from docker-compose command | grep check | `grep -c "import-realm" keycloak/docker-compose.yml` should return 0 | ✅ (will be edited) |
| INFRA-02 | `terraform plan` on CF module succeeds with mock vars | smoke (local) | `cd terraform/cloudflare && terraform plan -var-file=local.tfvars` | ❌ Wave 0 — no TF files yet |
| INFRA-02 | `wrangler.toml` has no KEYCLOAK_URL / KEYCLOAK_REALM in [vars] | grep check | `grep -c "KEYCLOAK" backend/wrangler.toml` should return 0 | ✅ (will be edited) |
| INFRA-03 | Mailpit container starts; SMTP port 1025 reachable | smoke | `docker compose ps` → mailpit running; `curl -s http://localhost:8025/api/v1/messages` → 200 | ❌ Wave 0 — not in docker-compose yet |

### Sampling Rate
- **Per task commit:** `npm run typecheck && npm run test:run` (no TypeScript changes in Phase 6, so passes trivially)
- **Per wave merge:** Full suite: `npm run test:all`
- **Phase gate:** Stack health check: `docker compose ps` (all services healthy) + `curl http://localhost:8025/api/v1/messages` + `curl http://localhost:8080/health/ready`

### Wave 0 Gaps
- [ ] `terraform/keycloak/` directory and `.tf` files — covers INFRA-01
- [ ] `terraform/cloudflare/` directory and `.tf` files — covers INFRA-02
- [ ] Mailpit service in `keycloak/docker-compose.yml` — covers INFRA-03
- [ ] `backend/.dev.vars.example` — covers INFRA-02 (wrangler local config pattern)
- No new Vitest test files required — Phase 6 has no TypeScript changes

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No — KC auth config is TF-managed, no new auth endpoints | keycloak_realm manages realm auth settings |
| V3 Session Management | No — session timeouts preserved from existing config | Terraform HCL mirrors existing realm-export.json values |
| V4 Access Control | No — no new backend endpoints | — |
| V5 Input Validation | No — no new request handlers | — |
| V6 Cryptography | Partial — TF state may contain admin password | Use `.tfvars` (gitignored); never commit credentials |
| V7 Secrets Management | Yes — `cloudflare_worker_secret` prevents plaintext secrets in wrangler.toml | `secret_text` is `sensitive = true` in TF schema; gitignored `.tfvars` |

### Known Threat Patterns for Terraform + Keycloak Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| TF state file with KC admin password | Information Disclosure | gitignore `terraform.tfstate`; use remote state with encryption for production |
| KC admin credentials in local.tfvars committed to git | Information Disclosure | `.tfvars` in `.gitignore`; only `.tfvars.example` with placeholders is committed |
| CF API token in CF local.tfvars | Information Disclosure | Same gitignore pattern; mock values in Phase 6 so no real token needed |
| Mailpit accessible externally | Spoofing | Mailpit binds to `0.0.0.0:8025` by default; acceptable for local dev; add `127.0.0.1:` prefix in production-like envs |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `webauthn-authenticator-passwordless` is the correct `authenticator` string value for the passwordless execution in KC 26 | Pattern 4 | Wrong authenticator ID → KC rejects execution; must check KC admin console for exact provider ID |
| A2 | `auth-username-form` is the correct `authenticator` string for the username step | Pattern 4 | Same as A1 |
| A3 | `keycloak_realm.realm` vs `keycloak_realm.japan_trip` — the `realm` attribute (not `id`) is used as `realm_id` in `keycloak_required_action` | Code Examples | Provider may expect `id` not `realm`; check required_action docs |
| A4 | Terraform CLI >= 1.5 satisfies provider version requirements | Environment Availability | Lower TF version may lack features; install latest stable |
| A5 | `account` and `japan-trip-api` KC clients in realm-export.json do NOT need explicit TF resources (they are KC built-ins or already exist from KC seeding) | Architecture | If TF creates them anew, it may conflict with KC's built-in `account` client |

**A5 note:** The `account` client in realm-export.json is a KC built-in with custom `webOrigins`. The `japan-trip-api` client is bearer-only with no redirect URIs. Both require explicit `keycloak_openid_client` resources to be managed by TF — omitting them means TF does not manage drift on those clients.

---

## Open Questions

1. **Authenticator string for webauthn-passwordless**
   - What we know: The realm-export.json uses `"authenticator": "webauthn-authenticator-passwordless"` in the JSON; KC admin console shows this value in the network requests.
   - What's unclear: Whether the TF provider uses the same string value or a different identifier.
   - Recommendation: Verify by running `terraform apply` and checking KC admin console; if wrong, the error message will show accepted values. The KC admin API `GET /admin/realms/{realm}/authentication/authenticator-providers` lists valid authenticator IDs.

2. **Terraform import of existing KC realm**
   - What we know: KC was seeded with `realm-export.json` via `--import-realm`, so the realm already exists in KC's Postgres DB.
   - What's unclear: Whether the plan should `terraform import keycloak_realm.japan_trip japan-trip` first, or whether the plan should destroy-and-recreate.
   - Recommendation: Use `terraform import` to adopt the existing realm into TF state before `terraform apply`. Destroying the realm would delete all users.

3. **`account` and `japan-trip-api` clients in TF scope**
   - What we know: Both exist in realm-export.json with custom settings. D-05 says "all realm config that currently lives in realm-export.json moves here as HCL."
   - What's unclear: Whether `account` (KC built-in) can be safely managed by TF without conflicts.
   - Recommendation: Manage `japan-trip-frontend` and `japan-trip-api` explicitly; the built-in `account` client may need `terraform import` and should be tested carefully.

---

## Sources

### Primary (HIGH confidence)
- `keycloak/keycloak` TF provider — https://github.com/keycloak/terraform-provider-keycloak/blob/main/docs/resources/realm.md (realm schema)
- `keycloak/keycloak` TF provider — https://github.com/mrparkers/terraform-provider-keycloak/blob/master/docs/resources/openid_audience_protocol_mapper.md (audience mapper)
- `keycloak/keycloak` TF provider — https://github.com/keycloak/terraform-provider-keycloak/blob/main/docs/resources/authentication_subflow.md (subflow schema)
- `keycloak/keycloak` TF provider — https://github.com/keycloak/terraform-provider-keycloak/blob/main/docs/resources/authentication_execution.md (execution schema + priority)
- `keycloak/keycloak` TF provider — https://github.com/keycloak/terraform-provider-keycloak/blob/main/docs/resources/required_action.md (required action schema)
- `keycloak/keycloak` TF provider — https://github.com/keycloak/terraform-provider-keycloak/blob/main/CHANGELOG.md (v5.7.0 release date Feb 2026)
- `cloudflare/cloudflare` TF provider — https://github.com/cloudflare/terraform-provider-cloudflare/blob/master/docs/resources/worker_secret.md
- Mailpit — https://mailpit.axllent.org/docs/install/docker/ (Docker Compose config, ports)
- Mailpit — https://mailpit.axllent.org/docs/api-v1 (REST API at /api/v1/messages)
- Wrangler configuration — https://developers.cloudflare.com/workers/wrangler/configuration/ (.dev.vars pattern)
- Context7: `/keycloak/terraform-provider-keycloak` — realm, subflow, execution, required_action, audience_mapper docs
- Context7: `/axllent/mailpit` and `/websites/mailpit_axllent` — Docker, REST API

### Secondary (MEDIUM confidence)
- Keycloak Terraform Provider adoption blog — https://www.keycloak.org/2024/12/terraform-provider-adoption (mrparkers → keycloak/keycloak transfer)
- Keycloak Terraform Provider Release 5 — https://www.keycloak.org/2025/01/terraform-provider-release-5 (v5.x features, KC 26 support)

### Tertiary (LOW confidence — see Assumptions Log)
- Authenticator string `"webauthn-authenticator-passwordless"` — inferred from realm-export.json JSON value; not verified against TF provider accepted values [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- KC TF module schema: HIGH — verified against provider GitHub docs + Context7
- CF TF module schema: HIGH — verified against provider GitHub docs
- Mailpit Docker config: HIGH — verified against official Mailpit docs
- Wrangler `.dev.vars` pattern: HIGH — verified against Cloudflare official docs
- Authentication flow ordering (priority): HIGH — verified against provider docs
- Authenticator string values: LOW — inferred from realm-export.json, not confirmed against provider

**Research date:** 2026-05-15
**Valid until:** 2026-08-15 (provider schema stable; Terraform CLI version may change)
