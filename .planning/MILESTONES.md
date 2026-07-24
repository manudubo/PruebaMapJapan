# Milestones

## v3.1 — E2E Stabilization

**Shipped:** 2026-07-23
**Phases:** 15–19
**Plans:** 11 total
**Timeline:** 2026-06-21 → 2026-07-23 (32 days)
**Stats:** 68 files changed, +8,837 / -343 lines (79 commits)

### Delivered

Pure stabilization milestone — no new product features. Took the E2E suite from a stale, several-commits-old failure list to a fresh authoritative triage, root-caused and fixed every real bug found (test and app), and closed with zero unexplained failures: 242 passed, 25 skipped (all documented deferrals), 0 failed.

### Key Accomplishments

1. Fresh full-suite triage established an authoritative, current failure list, and passkeys Chromium-scoping was corrected so cross-browser config bugs no longer polluted signal from subsequent fixes
2. Fixed `public-sharing.spec.ts` and `idp-theme.spec.ts` independently — self-contained `beforeAll` fixtures, valid PKCE S256 challenge, current KC 26 template assertions
3. Extracted a single shared `loginViaKcForm` helper replacing four independent, fragile KC-navigation implementations; fixed OTP route-contract mismatches and SMTP-lag false failures
4. Fixed `passkeys.spec.ts` reliability — `afterEach` authenticator cleanup, `resetCredentials` clearing stale `webauthn-register-passwordless` required actions
5. Root-caused and fixed the passkeyCampaign-driven session flakiness across multiple specs (per-device cookie pre-seed), found and fixed a real production bug (`tripDetail.ts` trip title never set for zero-destination trips), and closed the milestone with a clean 242 passed / 25 skipped / 0 failed full-suite run
6. Every environment-specific deferral documented via `test.fixme(condition, reason)` with explicit rationale — no silent skips; all 25 deferrals trace to two known, documented root causes

### Known Gaps at Close

- None — all 17 v3.1 requirements complete, 0 unexplained test failures

### Archive

- Roadmap: `.planning/milestones/v3.1-ROADMAP.md`
- Requirements: `.planning/milestones/v3.1-REQUIREMENTS.md`

## v3.0 — Quality, Polish & DevX

**Shipped:** 2026-06-15
**Phases:** 10–14
**Plans:** 19 total
**Timeline:** 2026-05-28 → 2026-06-15 (18 days)
**Stats:** 141 files changed, +20,819 / -1,325 lines

### Delivered

Brought the app from feature-complete (v2.0) to a solid, consistent state: unified design language between the app and Keycloak IDP, centralized error handling with no raw browser errors reaching users, single-command local dev environment, all KC test users as Terraform IaC, an RFC 9700 OAuth/OIDC security audit, and full new-user trip-creation E2E parity with ROPC eliminated from all test files.

### Key Accomplishments

1. Design system unification — all colors via `--jp-*` CSS custom properties; KC login page and email templates match app visual identity; theme persists across MPA navigations including Leaflet tile switching
2. Centralized error handling — `toast.ts` + global `unhandledrejection` handler across all 4 entry points; typed `ApiError` with automatic 401 → KC login redirect
3. One-command local dev + IaC-managed test users — `npm run dev` orchestrates Docker → KC health-check → backend → frontend; all 3 KC test users and strict redirect URIs Terraform-managed
4. Security hardening + audit trail — RFC 9700 checklist, JWKS retry-on-failure, CSP/HSTS/X-Frame-Options headers, E2E audience-rejection proof
5. Full new-user E2E parity — UI-driven trip-creation flow covered end-to-end; ROPC eliminated from all specs; caught and fixed 2 real production bugs (lat/lng Zod coercion, KC token-refresh throw)
6. 30/30 v3.0 requirements verified complete, with 1 documented and accepted deviation (Phase 12 `import=true`)

### Known Gaps at Close

- Phase 11 has no `11-VERIFICATION.md` file — corroborated by live codebase evidence instead; not blocking
- 7 pre-existing failing E2E specs (idp-theme, otp, passkeys ×3, public-sharing, session-management) — out of v3.0 scope, not investigated

### Archive

- Roadmap: `.planning/milestones/v3.0-ROADMAP.md`
- Requirements: `.planning/milestones/v3.0-REQUIREMENTS.md`

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
