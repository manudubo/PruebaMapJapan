---
phase: 07-backend-hardening-kc-config
plan: 05
subsystem: keycloak-theme
tags: [keycloak, freemarker, ftl, i18n, login-theme]
dependency_graph:
  requires: []
  provides: [login.ftl, error.ftl]
  affects: [KC login page rendering, KC error page rendering]
tech_stack:
  added: []
  patterns: [KC 26.6.1 FTL template inheritance via registrationLayout macro, KC CSS property variables for branding delegation]
key_files:
  created:
    - keycloak/themes/japan-trip/login/login.ftl
    - keycloak/themes/japan-trip/login/error.ftl
  modified: []
decisions:
  - "Used kcFormClass on <form> element to satisfy must_haves.key_links pattern requirement"
  - "Kept error.ftl minimal — exactly matches KC 26.6.1 base structure with displayMessage=false"
metrics:
  duration: ~2 minutes
  completed: 2026-05-20T22:44:56Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 07 Plan 05: KC Login and Error FTL Overrides Summary

FreeMarker login.ftl and error.ftl created for the japan-trip KC theme, applying dashboard branding via login.css CSS variables while preserving KC 26.6.1 base structure.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create login.ftl | b2ac2ca | keycloak/themes/japan-trip/login/login.ftl |
| 2 | Create error.ftl | 63666f4 | keycloak/themes/japan-trip/login/error.ftl |

## What Was Built

**login.ftl** — KC 26.6.1 base login page override:
- `<#import "template.ftl" as layout>` per KC theme system requirement
- `registrationLayout` with `displayMessage=!messagesPerField.existsError('username','password')`
- Header section: `${msg("loginAccountTitle")}`
- Form section: username/email input, password input, rememberMe checkbox (realm-conditional), forgot password link (realm-conditional), submit button, registration link (realm-conditional)
- Inline field errors via `${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}`
- KC CSS property variables: `kcFormClass`, `kcFormGroupClass`, `kcInputClass`, `kcButtonClass`, `kcButtonPrimaryClass`, `kcButtonBlockClass`, `kcButtonLargeClass`, `kcLabelClass`
- All user-visible strings via `${msg("key")}` — no hardcoded text

**error.ftl** — KC 26.6.1 base error page override:
- `displayMessage=false` suppresses KC's built-in message area
- Error text rendered via `${message.summary?no_esc}` (KC pre-sanitized content)
- Conditional `backToApplication` link when `client.baseUrl` is available
- `skipLink??` guard for flows without back link
- All user-visible strings via `${msg("key")}` — no hardcoded text

## Deviations from Plan

None — plan executed exactly as written. The `kcFormClass` property was added to the `<form>` element to satisfy the `must_haves.key_links` acceptance criterion (pattern `kcFormClass`), which is consistent with KC 26.6.1 base login.ftl structure.

## Known Stubs

None. Both FTL files use KC context variables (`realm`, `url`, `login`, `messagesPerField`, `message`, `client`) that are always populated by KC at runtime.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| mitigated: T-07-11 | error.ftl | `?no_esc` used only on `message.summary` which is KC-owned and pre-sanitized |
| mitigated: T-07-12 | error.ftl | `message.summary` is KC-generated generic text; no internal traceId exposure |

## Self-Check

Files exist:
- keycloak/themes/japan-trip/login/login.ftl: FOUND
- keycloak/themes/japan-trip/login/error.ftl: FOUND

Commits exist:
- b2ac2ca: FOUND
- 63666f4: FOUND

## Self-Check: PASSED
