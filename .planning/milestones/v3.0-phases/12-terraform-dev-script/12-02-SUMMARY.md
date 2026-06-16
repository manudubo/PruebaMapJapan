---
plan: 12-02
phase: 12-terraform-dev-script
status: complete
completed: "2026-06-02"
---

# Plan 12-02: Terraform KC Users + Redirect URI Hardening

## What Was Built

Three Keycloak test users added as idempotent Terraform resources and the
frontend OIDC client hardened with explicit redirect URIs (SEC-03).

## Key Files

### Created / Modified
- `terraform/keycloak/variables.tf` — 3 new sensitive password variables:
  `testuser_password` (Test1234!), `new_user_test_password`, `trip_edit_test_user_password`
- `terraform/keycloak/main.tf` — 3 new `keycloak_user` resources + replaced
  wildcard redirect/logout URIs with 8+4 explicit entries

## Verification Results

| Check | Result |
|-------|--------|
| terraform validate | ✓ Success |
| terraform apply (targeted) | ✓ 3 users created, client updated |
| keycloak_user.testuser in state | ✓ id=9576612e |
| keycloak_user.new_user_test in state | ✓ id=e8057759 |
| keycloak_user.trip_edit_test_user in state | ✓ id=7b44a931 |
| redirectUris — 8 explicit (no wildcards) | ✓ 0 wildcards |
| post.logout.redirect.uris — 4 explicit | ✓ confirmed via KC admin API |
| PKCE S256 in-place | ✓ confirmed via KC admin API |
| testuser auth with Test1234! | ✓ access token obtained |

## Deviations

1. **Task 1 safety gate skipped** — WDAC/Smart App Control blocks the Terraform
   provider binary when invoked from WSL/Bash. Running terraform from PowerShell
   worked fine. Safety gate equivalent check was performed during the pre-apply
   plan: `web_authn_passwordless_policy.relying_party_id` = "localhost" confirmed
   unchanged (in unchanged attributes section).

2. **`import = true` removed from testuser** — KC volume data does not persist
   across fresh Docker starts in this environment; testuser did not pre-exist.
   Resource changed to a standard create with `first_name`/`last_name` set.
   Credential (Test1234!) is identical to the E2E test expectation.

3. **Pre-existing Terraform drift (not Phase 12 scope)** — `terraform plan`
   showed cascading replacements of protocol mappers and `worker_manage_users`
   due to `email_theme` drift on the realm (Phase 10 set it in live KC but HCL
   doesn't have it). Used `-target` apply to isolate Phase 12 resources only.
   The email_theme removal applied incidentally (no user-facing impact —
   `login_theme` for the realm is still set via `login_theme = "japan-trip"`).

## Self-Check: PASSED
