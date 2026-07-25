---
phase: 20-critical-security
plan: "01"
subsystem: backend-security, infra-terraform
tags: [security, csprng, otp, terraform, cloudflare]
dependency_graph:
  requires: ["20-00"]
  provides: ["SEC-01-fix", "SEC-14-fix"]
  affects: ["backend/src/routes/auth.ts", "terraform/cloudflare/"]
tech_stack:
  added: []
  patterns: ["crypto.getRandomValues for CSPRNG", "Terraform resource deletion"]
key_files:
  modified:
    - backend/src/routes/auth.ts
    - terraform/cloudflare/main.tf
    - terraform/cloudflare/variables.tf
    - terraform/cloudflare/local.tfvars.example
decisions:
  - "D-01: crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000 with inline bias comment"
  - "D-11/D-12/D-13: Remove Terraform binding only; backend Env type and local .dev.vars unaffected"
metrics:
  duration: "4 minutes"
  completed: "2026-07-24T23:50:19Z"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 20 Plan 01: SEC-01 CSPRNG + SEC-14 Terraform Cleanup Summary

CSPRNG fix replaces predictable Math.random OTP with crypto.getRandomValues; Terraform cleanup removes unused KC_ADMIN_CLIENT_SECRET Worker binding.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Replace Math.random with crypto.getRandomValues (SEC-01) | 68a9837 | backend/src/routes/auth.ts |
| 2 | Remove kc_admin_client_secret from Terraform files (SEC-14) | 2d326a8 | terraform/cloudflare/main.tf, variables.tf, local.tfvars.example |

## Verification

- `grep -n "Math.random" backend/src/routes/auth.ts` returned 0 matches
- `grep -n "getRandomValues" backend/src/routes/auth.ts` returned 1 match at line 124 (shifted +1 by comment insertion)
- `cd backend && npm run typecheck` exited 0
- `cd backend && npm run test` 34/34 tests pass; otp-csprng.test.ts source-audit test GREEN
- `grep -rn "kc_admin_client_secret" terraform/cloudflare/` returned 0 matches
- `grep -c "resend_api_key" terraform/cloudflare/main.tf` returned 2 (block retained)
- main.tf line count: 6 (within 7-line limit per acceptance criteria)

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

No new threat surface introduced. Both changes reduce attack surface:
- T-20-01-01/T-20-01-02: OTP now uses CSPRNG — mitigated
- T-20-01-03: KC_ADMIN_CLIENT_SECRET no longer bound in Worker environment — mitigated
- T-20-01-04: Modulo bias accepted per threat register

## Self-Check: PASSED

- backend/src/routes/auth.ts modified correctly (getRandomValues present, Math.random absent)
- terraform/cloudflare/main.tf: kc_admin_client_secret absent, resend_api_key present
- terraform/cloudflare/variables.tf: kc_admin_client_secret absent
- terraform/cloudflare/local.tfvars.example: kc_admin_client_secret absent
- Commit 68a9837: exists
- Commit 2d326a8: exists
