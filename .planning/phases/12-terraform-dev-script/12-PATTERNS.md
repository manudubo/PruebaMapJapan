# Phase 12: Terraform Expansion + Dev Script — Pattern Map

**Mapped:** 2026-06-01
**Files analyzed:** 5 (2 new files, 3 modifications)
**Analogs found:** 4 / 5 (scripts/dev.js has no codebase analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/dev.js` | utility/script | event-driven (process orchestration) | None | no analog |
| `terraform/keycloak/main.tf` (add 3 users) | config (IaC) | CRUD | `terraform/keycloak/main.tf` lines 140-169 | exact (same file) |
| `terraform/keycloak/main.tf` (harden client) | config (IaC) | CRUD | `terraform/keycloak/main.tf` lines 55-71 | exact (same block) |
| `terraform/keycloak/variables.tf` | config (IaC) | config | `terraform/keycloak/variables.tf` lines 16-28 | exact (same file) |
| `package.json` (root) | config | config | `package.json` lines 8-21 | exact (same file) |

---

## Pattern Assignments

### `scripts/dev.js` (utility/script, process orchestration)

**Analog:** None — no `scripts/` directory exists, no orchestration script exists anywhere in the codebase.

**Use RESEARCH.md Patterns 1–3 directly.** The planner should reference the code examples in RESEARCH.md lines 188-271 (Patterns 1, 2, 3) as the template for this file.

Key constraints from codebase verification:
- Root `package.json` has **no `"type"` field** — Node treats `.js` files as CommonJS. Use `require()` not `import`. (Verified: `package.json` lines 1-23.)
- The docker-compose file lives at `keycloak/docker-compose.yml`, **not** project root. (Verified: `keycloak/docker-compose.yml` exists; no `docker-compose.yml` at root.)
- KC health-check URL is `http://localhost:8080/realms/japan-trip` (confirmed in `keycloak/docker-compose.yml` line 40).
- Backend dev command: `npm run dev --workspace=backend` (from root `package.json` line 10).
- Frontend dev command: `npm run dev --workspace=frontend` (from root `package.json` line 9).

**Module format** (root `package.json`, lines 1-23 — no `"type"` key present):
```json
{
  "name": "prueba-map-japan",
  "private": true,
  "workspaces": ["frontend", "backend"]
}
```
No `"type": "module"` → CommonJS default → use `require()` in `scripts/dev.js`.

---

### `terraform/keycloak/main.tf` — add `keycloak_user.new_user_test` and `keycloak_user.trip_edit_test_user` (INFRA-02, INFRA-03)

**Analog:** `terraform/keycloak/main.tf` lines 140-153 (`keycloak_user.e2e_test_user`)

**Copy this block exactly** (lines 140-153):
```hcl
resource "keycloak_user" "e2e_test_user" {
  realm_id       = keycloak_realm.japan_trip.id
  username       = "e2e-test@local"
  enabled        = true
  email          = "e2e-test@local"
  email_verified = true
  first_name     = "E2E"
  last_name      = "Test"

  initial_password {
    value     = var.e2e_test_password
    temporary = false
  }
}
```

**Substitute for INFRA-02** (`new_user_test`):
- `username = "new_user_test"`
- `email = "new_user_test@local"`
- `first_name = "New"`, `last_name = "UserTest"`
- `value = var.new_user_test_password`

**Substitute for INFRA-03** (`trip_edit_test_user`):
- `username = "trip_edit_test_user"`
- `email = "trip_edit_test_user@local"`
- `first_name = "TripEdit"`, `last_name = "TestUser"`
- `value = var.trip_edit_test_user_password`

**CRITICAL: `first_name` and `last_name` are required for INFRA-02 and INFRA-03.** Their absence triggers KC's "Update Profile" required-action prompt at first browser login. The `e2e_test_user` analog sets them to prevent this.

---

### `terraform/keycloak/main.tf` — add `keycloak_user.testuser` (INFRA-01)

**Analog:** `terraform/keycloak/main.tf` lines 140-153 (`keycloak_user.e2e_test_user`) — but with **deliberate divergences**.

**INFRA-01 diverges from the analog in two important ways:**

1. **Add `import = true`** — testuser was created manually in KC before IaC adoption. Without this attribute Terraform destroys and recreates it, invalidating any registered passkeys and breaking `trip-edit-integration.spec.ts`.

2. **Omit `first_name` and `last_name`** — with `import = true`, Terraform adopts existing KC state. Adding `first_name`/`last_name` would force-write them over the user's existing profile and could trigger a "Update Profile" required action. Intentionally different from INFRA-02/INFRA-03.

**INFRA-01 HCL pattern:**
```hcl
resource "keycloak_user" "testuser" {
  realm_id       = keycloak_realm.japan_trip.id
  username       = "testuser"
  enabled        = true
  email          = "testuser@local"
  email_verified = true

  import = true

  initial_password {
    value     = var.testuser_password
    temporary = false
  }
}
```

Note: `initial_password` on an `import = true` user is cosmetic — the provider does not reset the password. The default `"Test1234!"` documents the expected existing password for `trip-edit-integration.spec.ts`.

---

### `terraform/keycloak/main.tf` — harden `keycloak_openid_client.japan_trip_frontend` redirect URIs (SEC-03)

**Analog:** `terraform/keycloak/main.tf` lines 55-71 — this is an **in-place modification** of the existing block.

**Current state** (lines 55-71):
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

  valid_redirect_uris             = ["http://localhost:5173/*", "https://*.github.io/*"]
  valid_post_logout_redirect_uris = ["http://localhost:5173/*", "https://*.github.io/*"]
  web_origins                     = ["+"]

  full_scope_allowed = true
}
```

**Replace lines 66-67 only.** All other attributes remain unchanged. The two wildcard lines become explicit URI lists.

Port confirmed as **5173** (`frontend/vite.config.ts` line 46: `port: 5173`). RESEARCH.md redirect URI list is correct.

**Replacement for `valid_redirect_uris` and `valid_post_logout_redirect_uris`:**
```hcl
  valid_redirect_uris = [
    "http://localhost:5173/PruebaMapJapan/dashboard.html",
    "http://localhost:5173/PruebaMapJapan/profile.html",
    "http://localhost:5173/PruebaMapJapan/index.html",
    "http://localhost:5173/PruebaMapJapan/silent-check-sso.html",
    "https://manud.github.io/PruebaMapJapan/dashboard.html",
    "https://manud.github.io/PruebaMapJapan/profile.html",
    "https://manud.github.io/PruebaMapJapan/index.html",
    "https://manud.github.io/PruebaMapJapan/silent-check-sso.html",
  ]

  valid_post_logout_redirect_uris = [
    "http://localhost:5173/PruebaMapJapan/index.html",
    "http://localhost:5173/",
    "https://manud.github.io/PruebaMapJapan/index.html",
    "https://manud.github.io/",
  ]
```

`pkce_code_challenge_method = "S256"` is already present at line 63 — no change needed (INFRA-04 is verified-in-place).

---

### `terraform/keycloak/variables.tf` — add 3 new password variables (INFRA-01, INFRA-02, INFRA-03)

**Analog:** `terraform/keycloak/variables.tf` lines 16-28 — the existing `e2e_test_password` and `e2e_otp_password` variables.

**Exact pattern** (lines 16-21):
```hcl
variable "e2e_test_password" {
  description = "Password for e2e-test@local Playwright test user"
  type        = string
  sensitive   = true
  default     = "E2e-Test-Password-1!"
}
```

All fields are required: `description`, `type = string`, `sensitive = true`, `default`. Defaults must satisfy the realm password policy: `length(8) and upperCase(1) and digits(1) and specialChars(1)` (confirmed: `main.tf` line 23).

**Three new variables to append:**
```hcl
variable "testuser_password" {
  description = "Password for testuser Playwright test user"
  type        = string
  sensitive   = true
  default     = "Test1234!"
}

variable "new_user_test_password" {
  description = "Password for new_user_test Playwright test user"
  type        = string
  sensitive   = true
  default     = "New-User-Test-1!"
}

variable "trip_edit_test_user_password" {
  description = "Password for trip_edit_test_user Playwright test user"
  type        = string
  sensitive   = true
  default     = "Trip-Edit-Test-1!"
}
```

Note: `testuser_password` default is `"Test1234!"` (not the pattern default format) — this must match the hardcoded credential in `tests/e2e/trip-edit-integration.spec.ts`.

---

### `package.json` (root) — add `"dev"` script and `concurrently` devDependency

**Analog:** `package.json` lines 8-21 — existing scripts block and devDependencies block.

**Current scripts block** (lines 8-18):
```json
"scripts": {
  "dev:frontend": "npm run dev --workspace=frontend",
  "dev:backend": "npm run dev --workspace=backend",
  "build:frontend": "npm run build --workspace=frontend",
  "build:backend": "npm run build --workspace=backend",
  "preview:frontend": "npm run preview --workspace=frontend",
  "test": "npm run test --workspaces",
  "test:e2e": "cd tests && npm test",
  "test:all": "npm run test --workspaces && npm run test:e2e",
  "install:all": "npm install && npm install --prefix tests"
}
```

**Add one entry** to `"scripts"`:
```json
"dev": "node scripts/dev.js"
```

**Current devDependencies block** (lines 19-21):
```json
"devDependencies": {
  "@playwright/test": "^1.59.1"
}
```

**Add one entry** to `"devDependencies"`:
```json
"concurrently": "10.0.1"
```

Pin exact version (not `^`) — concurrently 10.0.1 was published the day of this research (2026-06-01). Exact pin avoids picking up a potentially broken 10.0.x patch during `npm install`. RESEARCH.md recommends this explicitly (Pitfall 2).

---

## Shared Patterns

### Terraform Resource Reference Pattern
**Source:** `terraform/keycloak/main.tf` lines 140-153
**Apply to:** All three new `keycloak_user` resources
```hcl
realm_id = keycloak_realm.japan_trip.id
```
All resources reference the realm via `keycloak_realm.japan_trip.id`, not a hard-coded string. New user resources must follow this same reference.

### Terraform Sensitive Variable Pattern
**Source:** `terraform/keycloak/variables.tf` lines 16-28
**Apply to:** All three new password variables
```hcl
type      = string
sensitive = true
default   = "..."
```
Every credential variable uses `sensitive = true`. The `kc_admin_pass` variable on lines 12-14 omits `description` and `default` (it's an operator secret), but all test-user password variables consistently have both.

### Node.js CommonJS Module Pattern
**Source:** root `package.json` (absence of `"type"` field)
**Apply to:** `scripts/dev.js`

Root workspace has no `"type"` field — default is CommonJS. Use `require()` for all imports in `scripts/dev.js`. If the author prefers ESM, rename to `scripts/dev.mjs` instead (no package.json change needed for a `.mjs` extension). Do not add `"type": "module"` to root `package.json` — it would break the `backend/` workspace which has its own `"type": "module"` already.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/dev.js` | utility/script | event-driven (process orchestration) | No `scripts/` directory exists. No orchestration or multi-process scripts anywhere in the codebase. Use RESEARCH.md Patterns 1–3 (lines 188–271) as the template. |

---

## Port Verification Note

`CLAUDE.md` states dev server runs on `localhost:3000`. `frontend/vite.config.ts` line 46 explicitly sets `server.port = 5173`. RESEARCH.md uses `localhost:5173` throughout the redirect URI list. **Port 5173 is correct.** The CLAUDE.md reference to 3000 reflects the original Japan itinerary app configuration — the frontend Vite config is authoritative.

---

## Metadata

**Analog search scope:** `terraform/keycloak/`, root `package.json`, `frontend/package.json`, `backend/package.json`, `frontend/vite.config.ts`, `keycloak/docker-compose.yml`
**Files scanned:** 9
**Pattern extraction date:** 2026-06-01
