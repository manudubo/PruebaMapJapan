---
phase: 10-design-tokens-idp-theme
plan: "04"
subsystem: keycloak-email-theme
tags: [keycloak, email, freemarker, i18n, design-tokens]
dependency_graph:
  requires: []
  provides: [keycloak-email-theme-DESIGN-03]
  affects: [keycloak/themes/japan-trip/email/]
tech_stack:
  added: []
  patterns:
    - KC 26.6.1 email FTL delegation (template.ftl macro + #nested + kcSanitize)
    - Table-based HTML email layout (email client compatibility)
    - KC message property files with inline-styled HTML body keys
key_files:
  created:
    - keycloak/themes/japan-trip/email/theme.properties
    - keycloak/themes/japan-trip/email/html/template.ftl
    - keycloak/themes/japan-trip/email/html/email-verification.ftl
    - keycloak/themes/japan-trip/email/html/email-verification-with-code.ftl
    - keycloak/themes/japan-trip/email/html/password-reset.ftl
    - keycloak/themes/japan-trip/email/html/executeActions.ftl
    - keycloak/themes/japan-trip/email/text/email-verification.ftl
    - keycloak/themes/japan-trip/email/text/email-verification-with-code.ftl
    - keycloak/themes/japan-trip/email/text/password-reset.ftl
    - keycloak/themes/japan-trip/email/text/executeActions.ftl
    - keycloak/themes/japan-trip/email/messages/messages_es.properties
    - keycloak/themes/japan-trip/email/messages/messages_en.properties
  modified: []
decisions:
  - "table-based layout in template.ftl (required for email client compatibility — no divs for layout)"
  - "body HTML in .properties files (not in .ftl) — KC two-layer delegation pattern for KC 26.6.1"
  - "kcSanitize()?no_esc on every html/*.ftl body call — XSS guard T-10-08"
  - "executeActions keys use {4} for formatted expiration (5-arg signature, not 4)"
  - "Spanish phrasing not cross-checked against live KC base bundle (KC not running)"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-30"
  tasks_completed: 3
  tasks_total: 4
  files_created: 12
  files_modified: 0
---

# Phase 10 Plan 04: KC Email Theme (DESIGN-03) Summary

KC email theme with D-07 branded card layout for all 4 login-flow email types — TravelMap header, white card, Inter font, #0071e3 accent links, #f5f5f7 background — using KC 26.6.1 two-layer FTL delegation + inline-styled message property keys.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create email theme scaffold | 6b3bf4d | theme.properties, html/template.ftl |
| 2 | Create 8 delegation FTL files | 1d8cdfd | html/*.ftl (4), text/*.ftl (4) |
| 3 | Create email message property files | 67fbd3a | messages_es.properties, messages_en.properties |
| 4 | Visual Mailpit verification | — | (checkpoint — awaiting human verify) |

## What Was Built

12 new files in `keycloak/themes/japan-trip/email/` covering DESIGN-03:

- **theme.properties**: `parent=keycloak`, locales `es,en`, no styles/kcHtmlClass (email has no interactive shell)
- **html/template.ftl**: `<#macro emailLayout>` wrapping `<#nested>` in a table-based branded card — "TravelMap" header, horizontal divider, white card body, footer "TravelMap — this is an automated message"
- **4 html/*.ftl**: Delegation files; each imports template.ftl and delegates body via `kcSanitize(msg(...))?no_esc`
- **4 text/*.ftl**: Plain-text fallbacks; each starts with `<#ftl output_format="plainText">` on line 1
- **messages_es.properties**: 8 keys (4 HTML + 4 plain text), Argentine vos register, inline D-07 styles in HTML values
- **messages_en.properties**: 8 keys (4 HTML + 4 plain text), standard English, same inline D-07 styles

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria passed for all 3 automated tasks.

**Note on Research Assumption A5:** Spanish translations not cross-checked against the live KC 26.6.1 base `messages_es.properties` (KC not running — Docker verification is part of the human checkpoint). The vos-register copy in the plan is the approved source; adapt if KC base differs on phrasing.

## Security

All threat model mitigations applied:

| Threat | Status |
|--------|--------|
| T-10-08: XSS via html/*.ftl body | Mitigated — `kcSanitize(...)?no_esc` in all 4 html delegation files, verified by rg |
| T-10-09: Script injection in messages/*.properties | Mitigated — `rg "<script\|javascript:\|on[a-z]+="` returns empty in both message files |
| T-10-10: Inline styles in template.ftl | Accepted — literal color/font values only, no user input |
| T-10-11: PII in email body | Accepted — parameterized placeholders only ({0}–{4}) |

## Checkpoint State (Task 4: human-verify)

**Status: pending-human-verify**

All 12 files are committed. The visual Mailpit verification (Task 4) requires Docker/KC running and cannot be automated. The user must:

1. `docker compose up -d` (from the keycloak/ directory or project root)
2. Wait for Keycloak healthy at http://localhost:8080
3. In KC Admin (http://localhost:8080/admin) → Realm Settings → Email → set SMTP to localhost:1025
4. Trigger a test email (create user with email verification, or use "Send test email")
5. Open Mailpit at http://localhost:8025 and verify:
   - "TravelMap" header at top
   - Horizontal divider below header
   - White card body (#ffffff)
   - Body text at 15px, color #1d1d1f
   - CTA link in blue (#0071e3)
   - "TravelMap — this is an automated message" footer
   - Background is light gray (#f5f5f7)
6. Switch to "Source" view — confirm no `<script>` tags
7. Check plain text version — should show readable text, not HTML entities

**Resume signal:** Type "approved" if the branded email renders correctly, or describe visual issues.

**Deferred (requires KC running):** `passkeys.spec.ts` regression check — email templates do not touch passkey AIA FTL files; regression risk is low.

## Known Stubs

None — all 12 files are complete and wired. The email body HTML is in message property files and will render on first KC email send after theme registration.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary crossings introduced. All changes are static FTL/properties files loaded by KC at render time.

## Self-Check: PASSED

Files exist:
- keycloak/themes/japan-trip/email/theme.properties — FOUND
- keycloak/themes/japan-trip/email/html/template.ftl — FOUND
- keycloak/themes/japan-trip/email/html/email-verification.ftl — FOUND
- keycloak/themes/japan-trip/email/html/email-verification-with-code.ftl — FOUND
- keycloak/themes/japan-trip/email/html/password-reset.ftl — FOUND
- keycloak/themes/japan-trip/email/html/executeActions.ftl — FOUND
- keycloak/themes/japan-trip/email/text/email-verification.ftl — FOUND
- keycloak/themes/japan-trip/email/text/email-verification-with-code.ftl — FOUND
- keycloak/themes/japan-trip/email/text/password-reset.ftl — FOUND
- keycloak/themes/japan-trip/email/text/executeActions.ftl — FOUND
- keycloak/themes/japan-trip/email/messages/messages_es.properties — FOUND
- keycloak/themes/japan-trip/email/messages/messages_en.properties — FOUND

Commits verified:
- 6b3bf4d (Task 1 — theme scaffold)
- 1d8cdfd (Task 2 — 8 FTL delegation files)
- 67fbd3a (Task 3 — message property files)
