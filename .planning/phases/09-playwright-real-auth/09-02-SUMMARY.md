---
phase: 09-playwright-real-auth
plan: "02"
subsystem: infra
tags: [terraform, keycloak, e2e, playwright]

requires:
  - phase: 07-passkey-login-wire-browser-passkey-keycloak-flow-as-default
    provides: "keycloak_realm.japan_trip and mrparkers/keycloak Terraform provider established"

provides:
  - "keycloak_user.e2e_test_user (e2e-test@local) defined in Terraform — created by terraform apply"
  - "keycloak_user.otp_test_user (otp-test@local) defined in Terraform — created by terraform apply"
  - "e2e_test_password and e2e_otp_password Terraform variables with safe defaults and sensitive=true"

affects: [09-03-globalSetup, 09-07-otp-tests]

tech-stack:
  added: []
  patterns:
    - "Test user provisioning via Terraform keycloak_user resources (not manual KC console)"
    - "Sensitive variables with defaults — overridable via local.tfvars without code change"

key-files:
  created: []
  modified:
    - terraform/keycloak/main.tf
    - terraform/keycloak/variables.tf

key-decisions:
  - "Password variables placed in variables.tf (consistent with existing kc_admin_pass pattern), user resources placed in main.tf"
  - "Realm reference updated to keycloak_realm.japan_trip.id (not .realm.id as shown in plan template — actual resource name differs)"
  - "Default passwords satisfy KC password policy: length(8) + upperCase(1) + digits(1) + specialChars(1)"

patterns-established:
  - "Test fixture users defined in Terraform, not created manually — reproducible, version-controlled"

requirements-completed:
  - E2E-01
  - E2E-04

duration: 10min
completed: 2026-05-27
---

# Phase 09 Plan 02: Keycloak Test User Terraform Resources Summary

**Two pre-seeded KC test users (e2e-test@local, otp-test@local) defined as keycloak_user Terraform resources — pending terraform apply to create in local KC realm**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-27T00:00:00Z
- **Completed:** 2026-05-27T00:10:00Z
- **Tasks:** 1 of 2 complete (Task 2 awaiting human action — terraform apply)
- **Files modified:** 2

## Accomplishments
- Two `keycloak_user` Terraform resources added to `terraform/keycloak/main.tf`
- Two sensitive password variables with defaults added to `terraform/keycloak/variables.tf`
- Both users have `email_verified = true`, no passkeys (passkeys registered via browser during tests)
- Default passwords satisfy the realm's `password_policy = "length(8) and upperCase(1) and digits(1) and specialChars(1)"`

## Task Commits

1. **Task 1: Add Terraform keycloak_user resources for both test users** - `c15ceea` (feat)
2. **Task 2: Apply Terraform and verify both users exist in KC** - AWAITING HUMAN ACTION

## Files Created/Modified
- `terraform/keycloak/main.tf` - Added `keycloak_user.e2e_test_user` and `keycloak_user.otp_test_user` resources
- `terraform/keycloak/variables.tf` - Added `e2e_test_password` and `e2e_otp_password` variables

## Decisions Made
- Password variables placed in `variables.tf` (consistent with existing `kc_admin_pass` pattern) rather than inline in `main.tf` as shown in the plan template
- Realm ID reference is `keycloak_realm.japan_trip.id` — the plan template showed `keycloak_realm.realm.id` but the actual resource name in this codebase is `japan_trip`
- No role assignments on either test user — threat model T-09-05 explicitly rules out elevated privileges for test users

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Deviation] Password variables placed in variables.tf, not inline in main.tf**
- **Found during:** Task 1
- **Issue:** Plan template showed variables inlined at the top of main.tf, but existing project convention is variables.tf for all variable declarations
- **Fix:** Added password variables to variables.tf alongside existing `kc_admin_pass`
- **Files modified:** terraform/keycloak/variables.tf
- **Committed in:** c15ceea (Task 1 commit)

**2. [Rule 1 - Deviation] Realm reference corrected to keycloak_realm.japan_trip.id**
- **Found during:** Task 1 (reading main.tf)
- **Issue:** Plan template showed `keycloak_realm.realm.id` but actual resource is named `keycloak_realm.japan_trip`
- **Fix:** Used correct resource name from main.tf
- **Files modified:** terraform/keycloak/main.tf
- **Committed in:** c15ceea (Task 1 commit)

---

**Total deviations:** 2 minor auto-corrections (corrected resource name, followed file organization convention)
**Impact on plan:** No scope creep. Both corrections required for functional HCL.

## Issues Encountered
- `keycloak/main.tf` path in the plan does not exist — Terraform files are at `terraform/keycloak/`. Updated path accordingly.

## User Setup Required

**Task 2 requires manual execution** — terraform apply cannot be automated (requires running Docker stack):

1. Start local stack: `docker-compose up` (from project root)
2. Apply Terraform:
   ```
   cd terraform/keycloak
   terraform plan -var-file=local.tfvars
   terraform apply -var-file=local.tfvars
   ```
3. Verify in KC Admin console (http://localhost:8080) → japan-trip realm → Users:
   - `e2e-test@local` — Email Verified: Yes
   - `otp-test@local` — Email Verified: Yes
4. Populate `tests/.env.test` (copy from `tests/.env.test.example`, fill all 12 vars including):
   ```
   E2E_TEST_USERNAME=e2e-test@local
   E2E_TEST_PASSWORD=E2e-Test-Password-1!
   E2E_OTP_USERNAME=otp-test@local
   E2E_OTP_PASSWORD=Otp-Test-Password-1!
   ```
5. Type "users created" to resume execution at Plan 03.

## Next Phase Readiness
- Plan 03 (globalSetup OIDC login) BLOCKED until `terraform apply` creates both users and `tests/.env.test` is populated
- Once users exist in KC and env vars are set, Plan 03 can proceed immediately

---
*Phase: 09-playwright-real-auth*
*Completed: 2026-05-27*
