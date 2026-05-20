---
phase: 7
slug: backend-hardening-kc-config
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing) |
| **Config file** | `backend/vitest.config.ts` |
| **Quick run command** | `cd backend && npm run test:run` |
| **Full suite command** | `cd backend && npm run test:run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && npm run test:run`
- **After every plan wave:** Run `cd backend && npm run test:run`
- **Before `/gsd-verify-work`:** Full suite must be green + typecheck passes
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 0 | BACK-01 | audience confusion | `VALID_AUDIENCES` read from env, not hardcode | unit | `cd backend && npm run test:run -- keycloak.test` | ✅ keycloak.test.ts (needs update) | ⬜ pending |
| 7-02-01 | 02 | 1 | BACK-02 | — | `email?: string` accepted without TypeScript error | typecheck | `cd backend && npm run typecheck` | ✅ | ⬜ pending |
| 7-03-01 | 03 | 1 | BACK-03 | — | `email_otp_codes` SQL produced by drizzle-kit generate | migration check | `cd backend && npx drizzle-kit generate` | ❌ W0 | ⬜ pending |
| 7-04-01 | 04 | 2 | BACK-04 | secret leak | KC Admin client credentials accepted by KC token endpoint | smoke (manual) | `curl -s ... /token` against local KC | ❌ Manual after terraform apply | ⬜ pending |
| 7-05-01 | 05 | 2 | KC-01 | — | `VERIFY_EMAIL` required action in KC realm; `access_code_lifespan_user_action = 1200s` | terraform plan | `terraform -chdir=terraform/keycloak plan` | ✅ main.tf | ⬜ pending |
| 7-06-01 | 06 | 3 | KC-02 | — | `browser_flow = "browser-passkey"` + password-forms subflow | terraform plan | `terraform -chdir=terraform/keycloak plan` | ✅ flows.tf | ⬜ pending |
| 7-07-01 | 07 | 2 | KC-03 | — | `webauthn-register-passwordless` required action with `defaultAction = false` | terraform plan | `terraform -chdir=terraform/keycloak plan` | ✅ flows.tf (already exists) | ⬜ pending |
| 7-08-01 | 08 | 3 | KC-04 | — | FTL files present; `messages_es.properties` has all keys; `locales=es,en` in theme.properties | file check | `ls keycloak/themes/japan-trip/login/*.ftl && cat theme.properties` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/auth/keycloak.test.ts` — add tests for `VALID_AUDIENCES` env var extraction (BACK-01); existing tests must continue passing
- [ ] `backend/src/db/migrations/0003_add_email_otp_codes.sql` — produced by `drizzle-kit generate` after schema.ts update (BACK-03)

*FTL theme files and messages_es.properties are new files with no automated test; verified via file-existence check and terraform plan.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| KC Admin client credentials grant succeeds | BACK-04 | KC token endpoint requires running Docker KC; no unit test for live credentials | `curl -s -X POST http://localhost:8080/realms/japan-trip/protocol/openid-connect/token -d "grant_type=client_credentials&client_id=japan-trip-worker&client_secret=<secret>"` → expect `access_token` in response |
| `VERIFY_EMAIL` email delivered via Mailpit | KC-01 | Requires running KC + Mailpit; E2E only | Register new user → check Mailpit UI at http://localhost:8025 for verification email |
| `browser-passkey` flow accessible to passkey users | KC-02 | Requires running KC + browser | Log in with passkey → expect no fallback to password form |
| Password-only users can still log in after KC-02 switch | KC-02 | Requires running KC + browser | Log in with username/password → expect success |
| KC theme FTL overrides render in Spanish | KC-04 | Requires running KC + browser locale=es | Set browser locale to es → KC login page shows Spanish strings |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
