# Phase 10: Design Tokens + IDP Theme - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-29
**Phase:** 10 - Design Tokens + IDP Theme
**Areas discussed:** Token prefix alignment, Theme flash prevention, KC dark mode sync, Email template styling depth

---

## Token prefix alignment

| Option | Description | Selected |
|--------|-------------|----------|
| Rename main.css to --jp-* | All ~30 tokens renamed to --jp-* prefix. Single namespace everywhere. Requires updating all references in HTML/TS. | ✓ |
| Shared token file | Extract tokens into tokens.css imported by both files. No rename needed. | |
| Eliminate hardcoded hex only | Keep current names, just remove hardcoded values. Interpret DESIGN-01 as "use CSS custom properties." | |

**User's choice:** Rename main.css to --jp-*

Follow-up — login.css independence:

| Option | Description | Selected |
|--------|-------------|----------|
| Login.css re-uses app tokens (one source) | Practical approach: login.css keeps own --jp-* values in sync | |
| Keep login.css fully independent | Login.css always defines its own --jp-* values. No import dependency. | ✓ |

**User's choice:** Keep login.css fully independent

---

## Theme flash prevention (FOUC)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add inline script to all HTML heads | Tiny inline `<script>` in `<head>` before CSS. Eliminates flash completely. Affects all 9 HTML files. | ✓ |
| No — 'persists' means setting is retained | localStorage already persists the choice. Brief FOUC acceptable. No HTML edits needed. | |

**User's choice:** Add inline anti-FOUC script to all 9 HTML heads

---

## KC dark mode sync

| Option | Description | Selected |
|--------|-------------|----------|
| Accept the mismatch | KC follows prefers-color-scheme. Users who manually override app to dark see KC in light. Accepted for transient auth flows. | ✓ |
| Cookie-based sync | App writes cookie; KC template reads it to sync preference. More code, perfect sync. | |

**User's choice:** Accept the mismatch

---

## Email template styling depth

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal — typography + colors only | Just font-family + text/link colors on KC's default email structure | |
| Branded card | Full HTML email: centered card, branded header, app font/colors, footer | ✓ |
| You decide | Claude picks depth based on DESIGN-03 and email client constraints | |

**User's choice:** Branded card

Follow-up — email header content:

| Option | Description | Selected |
|--------|-------------|----------|
| App name only — "TravelMap" text | Clean text-only header | |
| App name + subtle divider | "TravelMap" + 1px border-bottom separator | ✓ |
| You decide | | |

**User's choice:** App name + subtle divider

Follow-up — which templates:

| Option | Description | Selected |
|--------|-------------|----------|
| OTP + email verification only | Just login-otp and verify-email | |
| All login flow emails | Every email in the KC theme (OTP, verify, error, password reset, etc.) | ✓ |

**User's choice:** All login flow emails

---

## Claude's Discretion

- Token collapse decisions for near-identical tokens (e.g., --jp-shadow-glass variants)
- Whether to add `--jp-white` token or keep `#fff` as a neutral
- Exact HTML structure/padding in email card
- KC email template file names (researcher to verify for KC v26.6.1)

## Deferred Ideas

- Cookie-based KC dark mode sync — user accepted prefers-color-scheme mismatch
- Shared token file between main.css and login.css — user chose independent definitions
