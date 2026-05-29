# Phase 6: Local Infrastructure — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 14
**Analogs found:** 5 / 14 (9 greenfield or self-modification with no prior analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `terraform/keycloak/main.tf` | config | CRUD | none — RESEARCH.md Patterns 1-7 | no analog (greenfield TF) |
| `terraform/keycloak/variables.tf` | config | — | `keycloak/apply-local-settings.sh` lines 11-15 | partial (env-default values) |
| `terraform/keycloak/outputs.tf` | config | — | none | no analog |
| `terraform/keycloak/versions.tf` | config | — | none — RESEARCH.md Pattern 1 | no analog (greenfield TF) |
| `terraform/keycloak/local.tfvars.example` | config | — | none — RESEARCH.md Code Examples | no analog |
| `terraform/cloudflare/main.tf` | config | CRUD | none — RESEARCH.md Pattern 5 | no analog (greenfield TF) |
| `terraform/cloudflare/variables.tf` | config | — | none — RESEARCH.md Code Examples | no analog |
| `terraform/cloudflare/versions.tf` | config | — | none — RESEARCH.md Pattern 1 | no analog (greenfield TF) |
| `terraform/cloudflare/local.tfvars.example` | config | — | none — RESEARCH.md Code Examples | no analog |
| `keycloak/docker-compose.yml` | config | — | self (lines 4-18, postgres service block) | self-modification |
| `keycloak/realm-export.json` | config | — | self (lines 1-2 root object, lines 336-338 end) | self-modification |
| `backend/wrangler.toml` | config | — | self (lines 6-8) | self-modification |
| `backend/.dev.vars` | config | — | none — RESEARCH.md Code Examples | no analog |
| `backend/.dev.vars.example` | config | — | none — RESEARCH.md Code Examples | no analog |

---

## Pattern Assignments

### `terraform/keycloak/variables.tf` (config)

**Analog:** `keycloak/apply-local-settings.sh` lines 11-15

The shell script establishes the canonical local default values for KC admin credentials and URL. The `variables.tf` defaults MUST match these exactly.

**Credential defaults pattern** (`keycloak/apply-local-settings.sh` lines 11-15):
```bash
KC_URL="${KC_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-japan-trip}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
```

**Direct translation to HCL** (use RESEARCH.md Code Examples "variables.tf (KC module)"):
- `var.kc_url` default: `"http://localhost:8080"`
- `var.kc_admin_user` default: `"admin"`
- `var.kc_admin_pass`: sensitive, no default
- Mark `kc_admin_pass` as `sensitive = true`

---

### `terraform/keycloak/main.tf` (config, CRUD)

**Analog:** none — greenfield. Use RESEARCH.md Patterns 1-7 exclusively.

**Pattern references by resource type:**

| Resource | RESEARCH.md Pattern |
|---|---|
| `provider "keycloak"` | Pattern 1 — password grant, `tls_insecure_skip_verify = true` |
| `keycloak_realm` | Pattern 2 — realm settings, `web_authn_passwordless_policy`, `smtp_server` |
| `keycloak_openid_client` (japan-trip-frontend) | Pattern 3 — PUBLIC PKCE client |
| `keycloak_openid_audience_protocol_mapper` | Pattern 3 — separate resource, not inline |
| `keycloak_openid_client` (japan-trip-api) | Pattern 3 — bearer-only variant |
| `keycloak_openid_client` (account) | Pattern 3 — KC built-in; requires `terraform import` |
| `keycloak_authentication_flow` + subflow + executions | Pattern 4 — use `priority`, not `depends_on` |
| `keycloak_required_action` | RESEARCH.md Code Examples "keycloak_required_action" |
| `data "keycloak_openid_client_scope"` (profile, email) | Pattern 7 — data source for built-in scopes |
| `keycloak_openid_user_attribute_protocol_mapper` (avatar_url, preferences) | Pattern 7 — `client_scope_id` not `client_id` |
| `keycloak_openid_user_property_protocol_mapper` (preferred_username, email, email_verified) | Pattern 7 |
| `keycloak_openid_full_name_protocol_mapper` (full name) | Pattern 7 |

**Critical values sourced from `keycloak/realm-export.json`** (read-only reference):
- `webAuthnPolicyPasswordlessRpId` = `"localhost"` (line 42) — goes into `web_authn_passwordless_policy { relying_party_id }`
- `browserFlow` = `"browser"` (line 197) — keep as `"browser"` in Phase 6; passkey switch is Phase 7
- Six custom mappers: lines 232-333 define the exact `user_attribute`, `claim_name`, `jsonType.label`, and add_to_* flags to reproduce in HCL
- Authenticator strings confirmed in realm-export.json: `"auth-cookie"` (line 156), `"auth-username-form"` (line 181), `"webauthn-authenticator-passwordless"` (line 187)

---

### `terraform/keycloak/versions.tf` (config)

**Analog:** none. Use RESEARCH.md Pattern 1 `required_providers` block verbatim.

Key constraint: source MUST be `"keycloak/keycloak"`, NOT `"mrparkers/keycloak"`. Version `>= 5.7.0`.

---

### `terraform/keycloak/local.tfvars.example` (config)

**Analog:** none. Use RESEARCH.md Code Examples "local.tfvars.example (KC module)" verbatim.

Three vars: `kc_url`, `kc_admin_user`, `kc_admin_pass = "REPLACE_WITH_ADMIN_PASSWORD"`.

---

### `terraform/keycloak/outputs.tf` (config)

**Analog:** none. Expose `keycloak_realm.japan_trip.id` as `realm_id` output. No other outputs required for Phase 6.

---

### `terraform/cloudflare/main.tf` (config, CRUD)

**Analog:** none — greenfield. Use RESEARCH.md Pattern 5 verbatim.

Two resources: `cloudflare_worker_secret.resend_api_key` and `cloudflare_worker_secret.kc_admin_client_secret`. `script_name` = `"prueba-map-japan-api"` (confirmed from `backend/wrangler.toml` line 1).

Phase 6: written and committed but NOT applied. Validated via `terraform init && terraform plan` with mock vars only.

---

### `terraform/cloudflare/variables.tf` (config)

**Analog:** none. Use RESEARCH.md Code Examples "local.tfvars.example (CF module)" to derive four variables: `cf_account_id`, `cf_api_token`, `resend_api_key`, `kc_admin_client_secret`. Mark last two `sensitive = true`.

---

### `terraform/cloudflare/versions.tf` (config)

**Analog:** none. Use RESEARCH.md Pattern 1 structure; substitute `cloudflare/cloudflare >= 4.0` for the keycloak provider.

---

### `terraform/cloudflare/local.tfvars.example` (config)

**Analog:** none. Use RESEARCH.md Code Examples "local.tfvars.example (CF module)" verbatim.

Use `cf_account_id = "00000000000000000000000000000000"` (32-char hex) to satisfy UUID format validation at plan time (RESEARCH.md Pitfall 5).

---

### `keycloak/docker-compose.yml` (self-modification)

**Analog:** self — `keycloak/docker-compose.yml` lines 4-18 (postgres service block)

**Postgres service block as structural pattern** (`keycloak/docker-compose.yml` lines 4-18):
```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
    POSTGRES_DB: japan_trip
  ports:
    - "5432:5432"
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 10
```

**Changes required:**

1. Add Mailpit service using postgres as structural template (RESEARCH.md Pattern 6). Mailpit needs no environment vars or volumes:
```yaml
mailpit:
  image: axllent/mailpit:v1.29
  ports:
    - "1025:1025"
    - "8025:8025"
  restart: unless-stopped
```

2. Strip ` --import-realm` from line 31:
```yaml
# Before:
command: start-dev --import-realm
# After:
command: start-dev
```
   Note: D-07 says remove `--import-realm` only after `terraform apply` succeeds. The planner must sequence this as a separate step, not alongside the initial TF file creation.

3. Consider adding a healthcheck to the `keycloak` service mirroring the postgres healthcheck pattern (RESEARCH.md Pitfall 1). The script `keycloak/apply-local-settings.sh` lines 17-20 shows the poll condition (`/health/ready`):
```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -sf http://localhost:8080/health/ready"]
  interval: 10s
  timeout: 5s
  retries: 15
```

---

### `keycloak/realm-export.json` (self-modification)

**Analog:** self

**Two targeted edits:**

1. Insert `_comment` key as first key in root object (after opening `{` on line 1, before `"id"` on line 2). This is the CONFLICT-03 resolution — `//` comments are invalid JSON:
```json
{
  "_comment": "READ-ONLY REFERENCE — managed by terraform/keycloak/. Do not edit manually.",
  "id": "japan-trip",
```

2. Insert `smtpServer` block inside the root object (before the closing `}` on line 338, after `"defaultOptionalClientScopes"` on line 337). SMTP values from D-14:
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

**Assumption A7 flag:** KC's `--import-realm` may reject unknown root-level keys like `_comment`. If KC fails to start after this edit, fall back to a sibling `keycloak/REALM-EXPORT-README.md` instead.

---

### `backend/wrangler.toml` (self-modification)

**Analog:** self — `backend/wrangler.toml` lines 6-8

**Current state** (lines 6-8):
```toml
[vars]
KEYCLOAK_URL = ""
KEYCLOAK_REALM = ""
```

**Change:** Delete lines 6-8 entirely (the `[vars]` section header and both vars). The comment on line 10 about `DATABASE_URL` is unrelated and stays.

**Result file:**
```toml
name = "prueba-map-japan-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# Neon database connection string is provided via secret:
# wrangler secret put DATABASE_URL
```

---

### `backend/.dev.vars` (new, gitignored)

**Analog:** none. Use RESEARCH.md Code Examples ".dev.vars" content verbatim.

```
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
```

This file MUST be added to `.gitignore`. The root `.gitignore` does not currently cover `.dev.vars` — the planner must add the entry (e.g., `backend/.dev.vars`).

---

### `backend/.dev.vars.example` (new, committed)

**Analog:** none. Use RESEARCH.md Code Examples ".dev.vars.example" content verbatim. Same content as `.dev.vars` — placeholder values are not sensitive.

---

## Shared Patterns

### Keycloak Admin Credential Defaults
**Source:** `keycloak/apply-local-settings.sh` lines 11-15
**Apply to:** `terraform/keycloak/variables.tf` defaults, `terraform/keycloak/local.tfvars.example`

All three places must agree: URL `http://localhost:8080`, user `admin`, password `admin` (local dev only — gitignored).

### Docker Service Block Structure
**Source:** `keycloak/docker-compose.yml` lines 4-18 (postgres service)
**Apply to:** Mailpit service addition in `keycloak/docker-compose.yml`

Follow the same key ordering: `image` → `ports` → `restart`. Mailpit needs no `environment`, `volumes`, or `depends_on`.

### .gitignore Additions Required
No new .gitignore files exist for these paths. The planner must add these entries to the root `.gitignore`:
```
# Terraform
terraform/keycloak/local.tfvars
terraform/keycloak/terraform.tfstate
terraform/keycloak/terraform.tfstate.backup
terraform/keycloak/.terraform/
terraform/cloudflare/local.tfvars
terraform/cloudflare/terraform.tfstate
terraform/cloudflare/terraform.tfstate.backup
terraform/cloudflare/.terraform/

# Wrangler local dev
backend/.dev.vars
```

### Worker Script Name
**Source:** `backend/wrangler.toml` line 1
**Apply to:** `terraform/cloudflare/main.tf` `cloudflare_worker_secret.script_name`

Exact value: `"prueba-map-japan-api"` — copy verbatim; must not be parameterized differently.

---

## No Analog Found

Files with no close match in the codebase — planner uses RESEARCH.md patterns:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `terraform/keycloak/main.tf` | config | CRUD | No Terraform code exists anywhere in the repo |
| `terraform/keycloak/outputs.tf` | config | — | No Terraform code exists anywhere in the repo |
| `terraform/keycloak/versions.tf` | config | — | No Terraform code exists anywhere in the repo |
| `terraform/keycloak/local.tfvars.example` | config | — | No Terraform code exists anywhere in the repo |
| `terraform/cloudflare/main.tf` | config | CRUD | No Terraform code exists anywhere in the repo |
| `terraform/cloudflare/variables.tf` | config | — | No Terraform code exists anywhere in the repo |
| `terraform/cloudflare/versions.tf` | config | — | No Terraform code exists anywhere in the repo |
| `terraform/cloudflare/local.tfvars.example` | config | — | No Terraform code exists anywhere in the repo |
| `backend/.dev.vars` | config | — | No dotenv-format local override files exist in repo |
| `backend/.dev.vars.example` | config | — | No dotenv-format local override files exist in repo |

---

## Metadata

**Analog search scope:** `keycloak/`, `backend/`, project root
**Files scanned:** `keycloak/docker-compose.yml`, `keycloak/apply-local-settings.sh`, `keycloak/realm-export.json`, `backend/wrangler.toml`, `.gitignore`
**Pattern extraction date:** 2026-05-15
