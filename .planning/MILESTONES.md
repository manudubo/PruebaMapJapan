# Milestones

## v2.0 — Auth Infrastructure & Hardening

**Shipped:** 2026-05-28
**Phases:** 1–9 (v2.0 requirements: phases 6–9)
**Plans:** 62 total
**Timeline:** 2026-05-15 → 2026-05-28 (13 days, v2.0 phases)
**Stats:** 168 files changed, +20,147 / -1,583 lines (v2.0 range)

### Delivered

Full-stack trip planning web app with hardened auth infrastructure: Terraform IaC for Keycloak realm management, email OTP fallback, post-login passkey campaign, and complete Playwright real-auth E2E coverage.

### Key Accomplishments

1. Terraform KC realm IaC — 16 KC resources managed as HCL; `terraform apply` idempotent; `--import-realm` removed; Mailpit replaces MailHog
2. Backend hardening — `VALID_AUDIENCES` env var, `email?: string` relaxation, `email_otp_codes` migration, KC Admin client operational
3. KC auth flows + theme i18n — `browser-passkey` as default flow (password ALTERNATIVE), VERIFY_EMAIL + Mailpit SMTP, FreeMarker overrides (es/en)
4. Email OTP fallback — HMAC-SHA256 timing-safe, 10-min TTL, 5-attempt lockout via Mailpit/Resend
5. Passkey campaign — WebAuthn detection, per-device cookie, last-credential guard, UPDATE_PASSWORD gated
6. Playwright real-auth E2E — OIDC PKCE globalSetup, CDP Virtual Authenticator passkeys, Mailpit REST OTP tests

### Known Deferred Items at Close: 4 (see STATE.md Deferred Items)

- Verification docs for phases 02–04 marked human_needed (pre-v2.0 era)
- Phase 03 UAT flagged by audit (status: resolved, 0 pending scenarios)

### Archive

- Roadmap: `.planning/milestones/v2.0-ROADMAP.md`
- Requirements: `.planning/milestones/v2.0-REQUIREMENTS.md`
