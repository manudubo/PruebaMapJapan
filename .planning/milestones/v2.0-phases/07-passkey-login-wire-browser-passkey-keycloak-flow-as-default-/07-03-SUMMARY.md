---
phase: 07-backend-hardening-kc-config
plan: 03
subsystem: terraform-keycloak
tags: [terraform, keycloak, passkey, authentication, worker-client]
dependency_graph:
  requires: []
  provides: [password-forms-subflow, browser-passkey-flow, worker-client, verify-email-action]
  affects: [terraform/keycloak/flows.tf, terraform/keycloak/main.tf]
tech_stack:
  added: []
  patterns: [keycloak_authentication_subflow, keycloak_openid_client_service_account_role, keycloak_required_action]
key_files:
  modified:
    - terraform/keycloak/flows.tf
    - terraform/keycloak/main.tf
decisions:
  - password-forms ALTERNATIVE declared at priority 30 (after passkey-forms priority 20) as required KC-02 prerequisite
  - keycloak_openid_client_service_account_role used (not _realm_role) because manage-users is a CLIENT role on realm-management
  - worker_client_secret output declared sensitive=true so plan/apply masks value; retrieved via terraform output -raw
metrics:
  duration: "15 minutes"
  completed: "2026-05-20"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 07 Plan 03: Passkey Browser Flow + Worker Client Terraform Summary

**One-liner:** Terraform IaC — password-forms ALTERNATIVE subflow added to flows.tf, browserFlow flipped to browser-passkey, japan-trip-worker CONFIDENTIAL client with manage-users service account role and VERIFY_EMAIL required action wired in main.tf.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add password-forms subflow to flows.tf | 9690d1b | terraform/keycloak/flows.tf |
| 2 | Add worker client + VERIFY_EMAIL + browserFlow flip to main.tf | b24b41c | terraform/keycloak/main.tf |

## Changes Made

### Task 1 — flows.tf

Added two new resource blocks between `webauthn_passwordless` and `webauthn_register_passwordless`:

- `keycloak_authentication_subflow.password_forms` — ALTERNATIVE, priority 30, parent: browser-passkey flow
- `keycloak_authentication_execution.username_password_form` — auth-username-password-form, REQUIRED, priority 10

KC-03 resource (`webauthn_register_passwordless`) at lines 42-48 was preserved unchanged — no duplicate added.

### Task 2 — main.tf

Three changes + three new resources:

1. `access_code_lifespan_user_action`: `"5m"` → `"20m"` (KC-01: mitigates KC bug #41171 — email verification link expires too quickly)
2. `browser_flow`: `"browser"` → `"browser-passkey"` (KC-02: safe because password-forms ALTERNATIVE is pre-declared in Task 1)
3. New `keycloak_openid_client.japan_trip_worker` — CONFIDENTIAL, service_accounts_enabled=true, no standard/direct-access flows (BACK-04 D-01)
4. New `data.keycloak_openid_client.realm_management` — data source for manage-users CLIENT role lookup
5. New `keycloak_openid_client_service_account_role.worker_manage_users` — assigns manage-users role to worker service account (BACK-04 D-02)
6. New `keycloak_required_action.verify_email` — VERIFY_EMAIL, default_action=true (KC-01)
7. New `output.worker_client_secret` — sensitive output for post-apply retrieval in Plan 07-08

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

All new surfaces were covered by the plan's threat model:

| Flag | File | Description |
|------|------|-------------|
| T-07-06 mitigated | terraform/keycloak/main.tf | Worker service account granted only manage-users CLIENT role (not realm-admin); no standard/direct-access flows |
| T-07-07 mitigated | terraform/keycloak/flows.tf | password-forms ALTERNATIVE declared at priority 30 before browserFlow flip — password users retain login access |
| T-07-08 mitigated | terraform/keycloak/main.tf | worker_client_secret output declared sensitive=true; masked in plan/apply stdout |

## Verification Results

- `rg "password-forms" flows.tf` — 2+ matches (alias + parent_flow_alias reference)
- `rg "auth-username-password-form" flows.tf` — 1 match
- `rg "priority.*= 30" flows.tf` — 1 match
- `rg "webauthn_register_passwordless" flows.tf` — 1 match (existing resource preserved)
- `rg "access_code_lifespan_user_action.*= \"20m\"" main.tf` — 1 match
- `rg "browser_flow.*= \"browser-passkey\"" main.tf` — 1 match
- `rg "japan-trip-worker" main.tf` — 1 match
- `rg "service_accounts_enabled.*= true" main.tf` — 1 match
- `rg "realm_management" main.tf` — 2 matches (data source declaration + client_id reference)
- `rg "worker_manage_users" main.tf` — 1 match
- `rg "VERIFY_EMAIL" main.tf` — 2 matches (comment + alias)
- `rg "default_action.*= true" main.tf` — 1 match
- `rg "worker_client_secret" main.tf` — 2 matches (comment + output name)
- No duplicate `webauthn_register_passwordless` in main.tf — confirmed absent

Note: `terraform validate` could not be executed in this environment (permission restriction on cd-based Bash commands). HCL syntax verified by visual inspection and plan acceptance criteria via rg. Full validation expected as part of the `terraform apply` step in Plan 07-08.

## Requirements Addressed

- BACK-04: japan-trip-worker client with service_accounts_enabled=true; manage-users CLIENT role via keycloak_openid_client_service_account_role; worker_client_secret output
- KC-01: VERIFY_EMAIL required action with default_action=true; access_code_lifespan_user_action changed to 20m
- KC-02: browser_flow=browser-passkey; password-forms ALTERNATIVE subflow pre-declared in flows.tf
- KC-03: NOT duplicated — existing webauthn_register_passwordless resource verified and untouched

## Known Stubs

None — all resources are complete HCL declarations ready for terraform apply.

## Self-Check: PASSED

Files exist:
- terraform/keycloak/flows.tf — FOUND (modified)
- terraform/keycloak/main.tf — FOUND (modified)
- .planning/phases/07-passkey-login-wire-browser-passkey-keycloak-flow-as-default-/07-03-SUMMARY.md — FOUND

Commits exist:
- 9690d1b — feat(07-03): add password-forms ALTERNATIVE subflow to flows.tf — FOUND
- b24b41c — feat(07-03): add worker client, VERIFY_EMAIL, browserFlow flip to main.tf — FOUND
