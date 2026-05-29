---
plan: 06-06
phase: 06-local-infrastructure
status: complete
completed: 2026-05-19
---

# Plan 06-06: Terraform Import + Apply + Config Cleanup — Summary

## What was built

- Ran `terraform init` + iterative `terraform import` for all 16 KC resources
- Fixed `terraform apply` errors discovered during import (see Deviations)
- Final apply: "No changes. Your infrastructure matches the configuration."
- Cleaned up docker-compose.yml, wrangler.toml; created `.dev.vars` / `.dev.vars.example`

## Key decisions

- KC postgres persistence: added `KC_DB`, `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD` to docker-compose.yml — without these, KC `start-dev` defaults to H2 in-memory and loses the realm on restart
- KC healthcheck: changed from `/health/ready` (returns non-2xx in KC 26.x) to `/realms/japan-trip` which reliably returns 200
- Removed `--import-realm` from KC command — realm is now managed by Terraform, not file import
- CF provider pinned to `>= 4.0, < 5.0` — v5 removed `cloudflare_worker_secret`; v4.52.7 installed

## Deviations

### 1. `access_type = "BEARER_ONLY"` → `"BEARER-ONLY"`
Provider rejected underscore; expects hyphen.

### 2. Duration fields as Go strings
KC provider requires `"5m"`, `"30m"`, `"10h"`, `"720h"` — not raw integer seconds. Fixed all lifespan fields.

### 3. Audience mapper import format
Correct: `{realm}/client/{clientUUID}/{mapperId}` (not `{realm}/{clientId}/{mapperId}`).

### 4. Subflow import format
Correct: `{realm}/{parentFlowAlias}/{subflowAlias}` = `japan-trip/browser-passkey/passkey-forms` (not just `japan-trip/passkey-forms`).

### 5. Execution import format
Correct: `{realm}/{parentFlowAlias}/{executionId}`.
- `cookie`: `japan-trip/browser-passkey/{id}`
- `username_form`: `japan-trip/passkey-forms/{id}`
- `webauthn_passwordless`: `japan-trip/passkey-forms/{id}`

### 6. Built-in KC mappers conflict
Fresh KC realm auto-creates "username", "full name", "email", "email verified" mappers. TF tried to create them; KC rejected as duplicates. Fix: imported all 4 into TF state before final apply.

### 7. CF provider binary blocked (Windows App Control)
`terraform plan` for cloudflare module couldn't execute the v4 provider binary due to Windows App Control policy. CF module could not be fully applied locally; deferred to CI/CD environment.

## Acceptance criteria

- `terraform apply` exits 0 with "No changes" ✓
- KC realm issuer `http://localhost:8080/realms/japan-trip` returns 200 ✓
- Mailpit responds on port 8025 ✓
- `wrangler.toml` has no `[vars]` section ✓
- `backend/.dev.vars` contains `KEYCLOAK_URL` and `KEYCLOAK_REALM` ✓
- `backend/.dev.vars.example` committed ✓
- `realm-export.json` is valid JSON with `_comment` first key and `smtpServer` block ✓
- `import.sh` has correct formats for all resource types ✓
