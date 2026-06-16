# Phase 12: Terraform Expansion + Dev Script — Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

---

<domain>
## Phase Boundary

This phase delivers two independent tracks:

1. **Dev script** — Replace the split `dev:frontend` / `dev:backend` scripts with a single `npm run dev` at the project root that starts the entire local stack in the correct order: Docker Compose (KC + postgres + mailpit) → backend → frontend. Uses `concurrently` for multiplexed, color-labeled terminal output. Cross-platform: works on Windows and macOS/Linux.

2. **Terraform expansion** — Add the three missing KC test users as managed Terraform resources (`testuser`, `new_user_test`, `trip_edit_test_user`) and harden the KC client HCL by removing wildcard redirect URIs (SEC-03). Verify PKCE S256 is enforced server-side (INFRA-04 — already present in HCL but needs confirmation in running KC).

**Out of scope:** Documentation updates (Phase 13), E2E spec migration away from ROPC (Phase 14 UX-06), production deployment (post-v3.0), KC theme changes (Phase 10 shipped).

</domain>

<decisions>
## Implementation Decisions

### Dev Script: Tooling

**Locked:** Node.js script at project root — `scripts/dev.js` (or `devscript.js`). Uses `child_process` + `concurrently`. No shell scripts — Node.js is cross-platform without requiring bash on Windows.

**Root package.json** gets `"dev": "node scripts/dev.js"` (new entry). Existing `dev:frontend` and `dev:backend` remain unchanged.

### Dev Script: Docker Desktop Detection

**Locked:** Detect via `docker info` exit code — exit 0 means running, non-zero means not. Opening Docker Desktop per-platform:
- macOS: `open -a "Docker Desktop"`
- Windows: `start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"`
- Linux: no GUI Docker Desktop — warn user and continue (or just skip launch attempt)

Wait loop: poll `docker info` until exit 0 (with timeout ~60s). Then `docker compose up` from `keycloak/` directory.

### Dev Script: Service Startup Order

**Locked:** Sequential — must wait for Keycloak to be healthy before starting backend:
1. `docker compose up -d` in `keycloak/` (detached)
2. Poll `http://localhost:8080/realms/japan-trip` until 200 (with timeout ~90s)
3. Start backend (`npm run dev --workspace=backend`) via concurrently
4. Start frontend (`npm run dev --workspace=frontend`) via concurrently

**Concurrently prefixes (DEVENV-02):** Color-labeled per process:
- `[keycloak]` — docker compose logs follow (or just omit if too noisy)
- `[backend]` — backend dev output
- `[frontend]` — Vite dev server output

### Dev Script: Compose File Location

**Locked:** `docker-compose.yml` is in `keycloak/` subdirectory. The dev script must run `docker compose` from that directory (not from project root).

### Terraform: New Test Users (INFRA-01, INFRA-02, INFRA-03)

**Locked — follow existing naming conventions from `trip-edit-integration.spec.ts`:**

| Resource | Username | Email | Password variable |
|----------|----------|-------|-------------------|
| INFRA-01: `keycloak_user.testuser` | `testuser` | `testuser@local` | `var.testuser_password` (default: `Test1234!`) |
| INFRA-02: `keycloak_user.new_user_test` | `new_user_test` | `new_user_test@local` | `var.new_user_test_password` (default follows password policy) |
| INFRA-03: `keycloak_user.trip_edit_test_user` | `trip_edit_test_user` | `trip_edit_test_user@local` | `var.trip_edit_test_user_password` (default follows policy) |

All users: `email_verified = true`, `enabled = true`, `temporary = false`.

**INFRA-01 note:** `testuser` currently exists in KC (used by `trip-edit-integration.spec.ts`) but was created manually — it must be imported into Terraform state or recreated. The plan must include a `terraform import` step or use `lifecycle { ignore_changes = [initial_password] }` to avoid password conflicts.

### Terraform: Redirect URIs (SEC-03)

**Locked:** Remove wildcards from `valid_redirect_uris` on `keycloak_openid_client.japan_trip_frontend`. Replace with explicit URIs. Dev and prod separated as two separate lists in variables or as a concat in HCL.

**GitHub Pages URL:** `https://manud.github.io/PruebaMapJapan/` (from Vite `base: '/PruebaMapJapan/'` and GitHub username `manud`). Researcher must confirm exact redirect URIs needed (Keycloak.js sends the full page URL as redirect_uri — likely need per-page URIs or a single callback page pattern).

**Dev URIs (no wildcards):**
- `http://localhost:5173/PruebaMapJapan/dashboard.html`
- `http://localhost:5173/PruebaMapJapan/trip.html`
- `http://localhost:5173/PruebaMapJapan/trip-edit.html`
- `http://localhost:5173/PruebaMapJapan/profile.html`
- `http://localhost:5173/PruebaMapJapan/index.html`

**Prod URIs (same pages, GitHub Pages base):**
- `https://manud.github.io/PruebaMapJapan/dashboard.html`
- `https://manud.github.io/PruebaMapJapan/trip.html`
- etc.

**Researcher must confirm:** The exact set of pages keycloak-js uses as redirect_uri — check `keycloak.ts` init call and `login()` usage to enumerate all redirect targets.

### Terraform: PKCE S256 (INFRA-04)

**Locked:** `pkce_code_challenge_method = "S256"` already exists in `terraform/keycloak/main.tf` line ~62. Researcher must run `terraform plan` to confirm zero drift. If drift exists, plan includes a targeted `terraform apply -target` step. If no drift: INFRA-04 is already satisfied and the plan documents it as verified-in-place.

### Claude's Discretion

- Whether to use `concurrently` npm package or roll a custom Node.js spawn manager — prefer `concurrently` (well-tested, already referenced in requirements)
- Exact timeout values for health checks (suggest Docker ~60s, KC ~90s)
- Whether to add `concurrently` as a root-level devDependency or bundle it in the dev script
- Variable naming in `terraform/keycloak/variables.tf` for the three new password variables
- Whether to add a `terraform.tfvars.example` file showing the new variables

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Terraform
- `terraform/keycloak/main.tf` — existing KC resources (realm, clients, existing test users, mappers)
- `terraform/keycloak/variables.tf` — existing variables pattern to follow
- `terraform/keycloak/versions.tf` — provider versions and constraints

### Existing Dev Infrastructure
- `keycloak/docker-compose.yml` — local KC + postgres + mailpit Compose setup (in `keycloak/` subdir)
- `package.json` (root) — existing workspace scripts to extend

### E2E Specs (for testuser references)
- `tests/e2e/trip-edit-integration.spec.ts` — uses `testuser`/`Test1234!` and `loginAndGetToken()`
- `tests/playwright.config.ts` — globalSetup, storageState configuration

### Auth Flow (for redirect URI enumeration)
- `frontend/src/auth/keycloak.ts` — all `login()` and `init()` calls that produce redirect_uri values
- `frontend/vite.config.ts` — base URL `/PruebaMapJapan/` confirming GitHub Pages path

</canonical_refs>

<specifics>
## Specific Details

- `concurrently` must produce distinct color-labeled process prefixes per DEVENV-02: `[keycloak]`, `[backend]`, `[frontend]`
- `testuser` with password `Test1234!` is the exact value already hardcoded in `trip-edit-integration.spec.ts` — the Terraform variable default must match
- The docker-compose file does NOT live at project root — it lives in `keycloak/` — the dev script must `cd keycloak` or pass `-f keycloak/docker-compose.yml`
- KC health check URL is `http://localhost:8080/realms/japan-trip` (already used in docker-compose healthcheck)
- Terraform provider: `mrparkers/keycloak` (see `terraform/keycloak/versions.tf`)

</specifics>

<deferred>
## Deferred Ideas

None raised during discussion.

</deferred>

---

*Phase: 12-terraform-dev-script*
*Context gathered: 2026-06-01 via discuss-phase*
