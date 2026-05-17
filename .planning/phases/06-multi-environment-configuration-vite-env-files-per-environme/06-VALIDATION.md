---
phase: 6
slug: local-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (frontend/backend unit tests) — no new test files needed for Phase 6 (infrastructure-only) |
| **Config file** | `vitest.config.ts` per workspace |
| **Quick run command** | `npm run typecheck && npm run test:run` |
| **Full suite command** | `npm run test:all` |
| **Estimated runtime** | ~30 seconds (no new TS code — trivially passes) |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck && npm run test:run` (passes trivially; ensures no TS regressions)
- **After every plan wave:** Run `npm run test:all` + stack health check
- **Before `/gsd-verify-work`:** Full suite must be green + all smoke checks pass
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01 | KC TF module scaffold | 1 | INFRA-01 | — | N/A | smoke (manual) | `cd terraform/keycloak && terraform init` | ❌ Wave 0 | ⬜ pending |
| 06-02 | KC TF module resources | 1 | INFRA-01 | — | N/A | smoke (manual) | `cd terraform/keycloak && terraform plan -var-file=local.tfvars` | ❌ Wave 0 | ⬜ pending |
| 06-03 | `terraform apply` + `--import-realm` removal | 2 | INFRA-01 | — | N/A | smoke (manual) | `grep -c "import-realm" keycloak/docker-compose.yml` → 0 | ✅ (will be edited) | ⬜ pending |
| 06-04 | CF TF module | 1 | INFRA-02 | T-06-01 | No plaintext secrets in wrangler.toml | smoke + grep | `grep -c "KEYCLOAK" backend/wrangler.toml` → 0; `cd terraform/cloudflare && terraform plan -var-file=local.tfvars` | ❌ Wave 0 | ⬜ pending |
| 06-05 | Mailpit docker-compose | 1 | INFRA-03 | — | N/A | smoke | `docker compose ps` mailpit running; `curl -s http://localhost:8025/api/v1/messages` → 200 | ❌ Wave 0 | ⬜ pending |
| 06-06 | wrangler.toml cleanup + .dev.vars | 2 | INFRA-02 | T-06-01 | No env vars committed as plaintext in wrangler.toml | grep | `grep -c "KEYCLOAK_URL\|KEYCLOAK_REALM" backend/wrangler.toml` → 0 | ✅ (will be edited) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 6 is infrastructure-only — no new Vitest test files required. Wave 0 creates the Terraform directory scaffolding and Mailpit docker-compose entry:

- [ ] `terraform/keycloak/versions.tf` — provider source `keycloak/keycloak >= 5.7.0`
- [ ] `terraform/keycloak/variables.tf` — kc_url, kc_admin_user, kc_admin_pass
- [ ] `terraform/cloudflare/versions.tf` — provider source `cloudflare/cloudflare >= 4.0`
- [ ] `terraform/cloudflare/variables.tf` — cf_account_id, cf_api_token, resend_api_key, kc_admin_client_secret
- [ ] Mailpit service in `keycloak/docker-compose.yml` (ports 1025:1025, 8025:8025)

*Terraform CLI must be installed (`winget install HashiCorp.Terraform`) before any `terraform` commands.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `terraform apply` against running local KC succeeds | INFRA-01 | Requires live KC container + local TF credentials | `docker compose -f keycloak/docker-compose.yml up -d keycloak` → wait for healthy → `cd terraform/keycloak && terraform apply -var-file=local.tfvars -auto-approve` → exit 0 |
| KC realm is identical to realm-export.json after TF apply | INFRA-01 | Requires KC Admin API diff inspection | `GET http://localhost:8080/admin/realms/japan-trip` → compare key fields with realm-export.json |
| `realm-export.json` has `_comment` read-only annotation | INFRA-01 | Visual JSON inspection | Read first key of realm-export.json — must be `_comment: "READ-ONLY REFERENCE..."` |
| Mailpit receives test email from KC | INFRA-03 | Requires live KC + Mailpit stack | KC admin → Realm Settings → Email → Test connection → `curl http://localhost:8025/api/v1/messages` → messages array non-empty |
| `docker compose up` brings all services healthy | Phase gate | Requires running Docker | `docker compose -f keycloak/docker-compose.yml up -d` → all 3 services (postgres, keycloak, mailpit) healthy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
