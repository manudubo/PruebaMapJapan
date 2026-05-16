# Phase 6: Local Infrastructure — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 06-local-infrastructure
**Areas discussed:** Terraform layout, Cloudflare Terraform scope, Mailpit + KC SMTP wiring

---

## Terraform Layout

| Option | Description | Selected |
|--------|-------------|----------|
| terraform/ at project root | One top-level terraform/ dir with subdirs for keycloak/ and cloudflare/ modules | ✓ |
| keycloak/terraform/ nested | TF lives inside the keycloak/ directory, co-located with Dockerfile/themes | |
| Single flat module | All .tf files flat in terraform/, no submodules | |

**User's choice:** `terraform/` at project root

---

| Option | Description | Selected |
|--------|-------------|----------|
| Separate modules: terraform/keycloak/ + terraform/cloudflare/ | Each module has its own provider, vars, outputs; applied independently | ✓ |
| Single root module with all resources | All .tf files in terraform/ root; apply always touches both KC and CF | |

**User's choice:** Separate modules

---

| Option | Description | Selected |
|--------|-------------|----------|
| .tfvars file (gitignored) per module | local.tfvars per module in .gitignore; .tfvars.example committed | ✓ |
| TF_VAR_* environment variables only | No files; developer sets vars in shell | |
| terraform.tfvars auto-loaded | Auto-loaded by TF; risk of accidental commit | |

**User's choice:** .tfvars file (gitignored) per module

---

## Cloudflare Terraform Scope

| Option | Description | Selected |
|--------|-------------|----------|
| HCL stubs only — no apply yet | Write cloudflare_worker_secret resources; validate via terraform validate/plan; defer apply | |
| Full apply against real Cloudflare | Requires CF API token, deployed Worker, real secret values | |
| HCL + local plan validation | Same as stubs but also run terraform plan with mock vars to catch HCL errors | ✓ |

**User's choice:** HCL + local plan validation (no actual apply)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add wrangler.dev.toml with local KC URL + realm | wrangler.toml stays clean; wrangler.dev.toml gitignored for local dev values | ✓ |
| No — keep values in wrangler.toml | KEYCLOAK_URL and KEYCLOAK_REALM stay hardcoded in wrangler.toml | |

**User's choice:** Add wrangler.dev.toml

---

## Mailpit + KC SMTP Wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — wire Mailpit SMTP into realm-export.json now | Add smtpServer config to realm-export.json for mailpit:1025; enables email testing before Phase 7 | ✓ |
| No — Mailpit container only, SMTP wired in Phase 7 | Phase 6 just adds container; Phase 7 (KC-01) wires SMTP | |

**User's choice:** Wire Mailpit SMTP into realm-export.json in Phase 6

---

## Claude's Discretion

- Local dev bootstrap flow (startup sequence after --import-realm removal)
- Exact HCL file layout inside terraform/keycloak/ and terraform/cloudflare/
- KC provider TLS config for local HTTP endpoint
- Whether terraform plan validation runs in CI or locally only

## Deferred Ideas

- Actual terraform apply against real Cloudflare — deferred to production phase
- Terraform Neon module — out of scope per REQUIREMENTS.md
- VERIFY_EMAIL and Resend SMTP — Phase 7
- KC browser-passkey flow — Phase 7
