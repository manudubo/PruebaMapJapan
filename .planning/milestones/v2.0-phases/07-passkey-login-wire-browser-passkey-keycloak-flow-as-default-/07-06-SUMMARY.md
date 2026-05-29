---
phase: 07-backend-hardening-kc-config
plan: "06"
subsystem: keycloak-theme
tags: [keycloak, freemarker, i18n, otp, email-verification]
dependency_graph:
  requires: [07-04, 07-05]
  provides: [login-otp-ftl, verify-email-ftl]
  affects: [keycloak-theme-login]
tech_stack:
  added: []
  patterns: [freemarker-layout-inheritance, kc-property-class-variables, msg-i18n-lookup]
key_files:
  created:
    - keycloak/themes/japan-trip/login/login-otp.ftl
    - keycloak/themes/japan-trip/login/verify-email.ftl
  modified: []
decisions:
  - "No credential selector in login-otp.ftl — multi-device OTP is not a use case in this realm"
  - "AIA cancel button added to verify-email.ftl form section as conditional block"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-20"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 07 Plan 06: OTP and Email Verification FTL Overrides Summary

**One-liner:** FreeMarker overrides for OTP code entry (login-otp.ftl) and email verification (verify-email.ftl) using KC 26.6.1 base structure with msg() i18n and KC property CSS variables.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create login-otp.ftl (KC-04 D-04) | 6c36dc0 | keycloak/themes/japan-trip/login/login-otp.ftl |
| 2 | Create verify-email.ftl (KC-04 D-04) | c7f3994 | keycloak/themes/japan-trip/login/verify-email.ftl |

## What Was Built

**login-otp.ftl** — OTP code entry page override:
- KC 26.6.1 base structure with `<#import "template.ftl" as layout>`
- `displayMessage=!messagesPerField.existsError('totp')` suppresses layout-level message on field errors
- `autocomplete="one-time-code"` enables browser OTP autofill
- `dir="ltr"` on input for LTR code rendering regardless of locale
- Inline field error via `kcSanitize(messagesPerField.get('totp'))?no_esc`
- No credential selector — multi-device OTP not in scope for this realm

**verify-email.ftl** — Email verification page override:
- `displayInfo=true` enables the info section for the resend link
- `user.email` interpolated into `emailVerifyInstruction1` as `{0}` placeholder
- `doClickHere` link at `url.loginAction` for the resend flow (info section)
- AIA cancel button conditional on `isAppInitiatedAction??` in form section

## Deviations from Plan

None — plan executed exactly as written.

## Parallel Execution Context

This plan ran in parallel with 07-04 (which creates messages_es.properties, login.ftl, theme.properties locales) and 07-05 (error.ftl). The `messages_es.properties` file does not yet exist in this worktree — msg() lookups resolve at Keycloak runtime. All acceptance criteria are satisfied by the FTL file content alone.

## Known Stubs

None — these are complete FTL overrides with no hardcoded placeholder text.

## Threat Flags

No new security surface introduced. Both threats in the plan's threat_model were accepted:
- T-07-13: user.email from KC session (already validated); FreeMarker auto-escapes
- T-07-14: url.loginAction embeds KC session-scoped action token; no CSRF/replay risk

## Self-Check: PASSED

- keycloak/themes/japan-trip/login/login-otp.ftl — FOUND
- keycloak/themes/japan-trip/login/verify-email.ftl — FOUND
- Commit 6c36dc0 — task 1 feat commit
- Commit c7f3994 — task 2 feat commit
