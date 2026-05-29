# Phase 6: Local Infrastructure — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up Terraform IaC for KC realm config and Cloudflare Worker secrets; add Mailpit as local SMTP and wire it into KC realm; remove `--import-realm` from docker-compose. No UI changes. No backend code changes. No production deployment.

</domain>

<decisions>
## Implementation Decisions

### Terraform directory structure
- **D-01:** `terraform/` directory at project root (not nested under `keycloak/`).
- **D-02:** Two separate child modules: `terraform/keycloak/` and `terraform/cloudflare/`. Each has its own provider, variables, and outputs. They are applied independently — KC changes don't force a CF plan.
- **D-03:** Local vars supplied via a `.tfvars` file per module (`terraform/keycloak/local.tfvars`, `terraform/cloudflare/local.tfvars`), both gitignored. Template `.tfvars.example` files committed with placeholder values.
- **D-04:** KC provider: `mrparkers/keycloak >= 5.7.0`. CF provider: `cloudflare/cloudflare`. Versions pinned in a root `terraform/versions.tf` or per-module `versions.tf`.

### Terraform KC module scope (INFRA-01)
- **D-05:** `terraform/keycloak/` manages: `keycloak_realm`, `keycloak_openid_client` (the `japan-trip-frontend` client), `keycloak_required_action` resources, auth flow executions, and `webAuthnPolicyPasswordlessRpId`. All realm config that currently lives in `realm-export.json` moves here as HCL.
- **D-06:** `realm-export.json` becomes a read-only reference snapshot. Add a comment block at the top of the file marking it: `// READ-ONLY REFERENCE — managed by terraform/keycloak/. Do not edit manually.`
- **D-07:** `--import-realm` is removed from the `command:` line in `keycloak/docker-compose.yml` once local `terraform apply` is confirmed working.
- **D-08:** Terraform connects to local Docker KC at `http://localhost:8080` using the admin credentials from `local.tfvars`. The KC container must be running before `terraform apply` — document the order: `docker compose up -d keycloak` → `terraform apply`.

### Terraform CF module scope (INFRA-02)
- **D-09:** `terraform/cloudflare/` defines `cloudflare_worker_secret` resources for `RESEND_API_KEY` and `KC_ADMIN_CLIENT_SECRET`. HCL is written and committed but **not applied** in Phase 6 — actual apply deferred to the production deployment phase.
- **D-10:** Phase 6 validates the HCL via `terraform init` + `terraform plan` using mock `.tfvars` values. This ensures the module is syntactically correct and the resource schema is right without touching real Cloudflare.
- **D-11:** `wrangler.toml` is updated: `KEYCLOAK_URL` and `KEYCLOAK_REALM` vars are **removed** from `wrangler.toml` and moved to `wrangler.dev.toml` (local dev overrides). `wrangler.toml` keeps only non-sensitive, deployment-time-neutral config. `wrangler.dev.toml` is gitignored.

### Mailpit (INFRA-03)
- **D-12:** Add Mailpit v1.29 to `keycloak/docker-compose.yml` (ports `1025:1025` SMTP, `8025:8025` web UI). No MailHog to remove — it was never added.
- **D-13:** Wire Mailpit as KC realm SMTP in Phase 6 (don't defer to Phase 7). Add `smtpServer` block to `realm-export.json` pointing to `mailpit:1025` (using the docker-compose service name as hostname). This enables local email testing before Phase 7 introduces VERIFY_EMAIL.
- **D-14:** Mailpit SMTP config: `host: mailpit`, `port: 1025`, `from: noreply@japan-trip.local`, `ssl: false`, `auth: false`. No authentication needed for Mailpit.

### Claude's Discretion
- Exact HCL resource structure inside `terraform/keycloak/` (file layout, resource naming conventions) — follow `mrparkers/keycloak` provider documentation
- Whether to use `terraform/keycloak/main.tf` + `variables.tf` + `outputs.tf` split or a single file — split is preferred for readability
- KC module provider config (timeout, TLS skip verify for local) — use `tls_insecure_skip_verify = true` for local HTTP
- Whether `terraform plan` mock-apply in CI runs in the Phase 6 verification or is left as a local validation step — local is fine for Phase 6
- Local dev bootstrap order documentation format (DEVELOPMENT.md update vs README vs inline docker-compose comments)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §INFRA-01, INFRA-02, INFRA-03 — full requirement definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 6 — five success criteria that define done

### Files to modify
- `keycloak/docker-compose.yml` — add Mailpit service; remove `--import-realm` from KC command
- `keycloak/realm-export.json` — add `smtpServer` block; add read-only annotation comment
- `backend/wrangler.toml` — remove KEYCLOAK_URL and KEYCLOAK_REALM vars (move to wrangler.dev.toml)

### Files to create
- `terraform/` — new directory at project root
- `terraform/keycloak/` — KC realm module (main.tf, variables.tf, outputs.tf, versions.tf)
- `terraform/keycloak/local.tfvars.example` — committed template
- `terraform/cloudflare/` — CF Worker secrets module (main.tf, variables.tf, versions.tf)
- `terraform/cloudflare/local.tfvars.example` — committed template
- `backend/wrangler.dev.toml` — local dev env overrides (gitignored)

### Prior phase context
- `.planning/phases/04-passkeys/04-CONTEXT.md` — D-01 (KC 26.6.1 image) and D-02 (webAuthnPolicyPasswordlessRpId: localhost) — both must be preserved in the TF KC module
- `.planning/STATE.md` — v2.0 IaC decisions: mrparkers/keycloak >= 5.7.0; realm-export.json read-only; --import-realm removal; Mailpit for local email

### Terraform provider docs
- `mrparkers/keycloak` provider: keycloak_realm, keycloak_openid_client, keycloak_required_action, keycloak_authentication_flow resources
- Cloudflare provider: cloudflare_worker_secret resource

</canonical_refs>

<code_context>
## Existing Code Insights

### Files to understand before editing
- `keycloak/docker-compose.yml` — current KC + Postgres stack; `command: start-dev --import-realm` is what gets removed
- `keycloak/realm-export.json` — full realm JSON; all top-level realm fields, clients, auth flows, and WebAuthn policies need to be replicated in HCL; `smtpServer` block is currently absent
- `backend/wrangler.toml` — minimal: `name`, `main`, `compatibility_date`, `compatibility_flags`, `[vars]` with KEYCLOAK_URL + KEYCLOAK_REALM
- `keycloak/apply-local-settings.sh` — existing admin API helper script; reference pattern for KC admin credentials and URL

### Integration points
- KC container must be up and healthy before `terraform apply` — docker-compose healthcheck on KC (or a wait script) is needed
- `webAuthnPolicyPasswordlessRpId: "localhost"` (from realm-export.json line 42) must be reproduced in the TF KC module — it was set in Phase 4
- Mailpit docker service name `mailpit` is used as the SMTP hostname inside the KC realm config (docker internal DNS)

### No reusable assets
- No existing Terraform code anywhere in the repo — this is a greenfield TF setup

</code_context>

<specifics>
## Specific Ideas

- Mailpit REST API at `/api/v1/messages` (port 8025) is needed for Phase 9 OTP E2E tests — ensure port 8025 is exposed in docker-compose
- `terraform plan` with mock `.tfvars` as the Phase 6 validation gate for the CF module (no real apply)
- `wrangler.dev.toml` follows the standard Wrangler override pattern — auto-loaded by `wrangler dev` when present

</specifics>

<deferred>
## Deferred Ideas

- Actual `terraform apply` against real Cloudflare — deferred to production deployment phase
- Terraform Neon module (Neon provisioned manually per PROJECT.md) — out of scope per REQUIREMENTS.md
- `VERIFY_EMAIL` Required Action enablement — Phase 7 (KC-01)
- Production SMTP (Resend API key) wiring — deferred; Mailpit is local-only in Phase 6
- KC admin UI browser flow changes (browser-passkey flow) — Phase 7 (KC-02)

</deferred>

---

*Phase: 06-local-infrastructure*
*Context gathered: 2026-05-15*
