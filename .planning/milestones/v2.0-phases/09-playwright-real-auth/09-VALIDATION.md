---
phase: 9
slug: playwright-real-auth
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.60.0 (upgrade from ^1.48.0) |
| **Config file** | `tests/playwright.config.ts` |
| **Quick run command** | `cd tests && npx playwright test --project chromium <spec-file> -x` |
| **Full suite command** | `cd tests && npx playwright test` |
| **Estimated runtime** | ~60 seconds (local, KC running) |

---

## Sampling Rate

- **After every task commit:** Run `cd tests && npx playwright test --project chromium <relevant-spec-file> -x`
- **After every plan wave:** Run `cd tests && npx playwright test --project chromium`
- **Before `/gsd-verify-work`:** Full suite must be green (or SKIP_REAL_AUTH=true mocked suite green for CI)
- **Max feedback latency:** ~30 seconds (single file, chromium only)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-T1 | 01 | 1 | E2E-01 | `.auth/` not committed | tests/.auth/ and tests/.env.test gitignored | setup | `git check-ignore -v tests/.auth/user.json` | ✅ (after Wave 1) | ⬜ pending |
| 09-01-T2 | 01 | 1 | E2E-04 | — | Mailpit spike captures actual JSON field names | spike | `cd tests && SKIP_REAL_AUTH=true npx playwright test --list 2>&1 | tail -3` | ✅ (after Wave 1) | ⬜ pending |
| 09-02-T1 | 02 | 1 | E2E-01 | — | KC test users seeded via Terraform (manual checkpoint) | manual | See manual verifications | ❌ manual step | ⬜ pending |
| 09-03-T1 | 03 | 2 | E2E-01 | — | globalSetup writes .auth/user.json without ROPC | integration | `ls tests/.auth/user.json` (after local run) | ❌ Wave 2 extends | ⬜ pending |
| 09-03-T2 | 03 | 2 | E2E-01 | — | playwright.config.ts adds chromium-passkeys project + storageState | config | `grep "chromium-passkeys" tests/playwright.config.ts` | ✅ (after Wave 2) | ⬜ pending |
| 09-04-T1 | 04 | 2 | E2E-02 | — | kcAdmin fixture: resetCredentials, clearOtpCodes, expireOtpCodes exported | integration | `grep "resetCredentials\|clearOtpCodes\|expireOtpCodes" tests/e2e/fixtures/kc-admin.ts` | ❌ Wave 2 | ⬜ pending |
| 09-05-T1 | 05 | 3 | E2E-01 | — | auth.spec.ts real-auth describe block added with SKIP_REAL_AUTH guard | e2e | `cd tests && SKIP_REAL_AUTH=true npx playwright test --project chromium auth.spec.ts` | ✅ (after Wave 3) | ⬜ pending |
| 09-05-T2 | 05 | 3 | E2E-01 | — | CI workflow adds SKIP_REAL_AUTH: true to Playwright step | CI | `grep "SKIP_REAL_AUTH" .github/workflows/ci.yml` | ✅ (after Wave 3) | ⬜ pending |
| 09-06-T1 | 06 | 3 | E2E-03 | — | CDP VirtualAuthenticator: register, login, delete-guard tests | e2e | `cd tests && npx playwright test --project chromium-passkeys passkeys.spec.ts` | ❌ Wave 3 | ⬜ pending |
| 09-07-T1 | 07 | 3 | E2E-04 | — | OTP request → Mailpit fetch → verify; expired + lockout cases | e2e (serial) | `cd tests && npx playwright test --project chromium otp.spec.ts` | ❌ Wave 3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 1 Requirements (Infrastructure scaffolding — Plan 01)

- [ ] Root `.gitignore` updated: adds `tests/.auth/` and `tests/.env.test`
- [ ] `tests/.auth/.gitkeep` — directory scaffold so `.auth/` exists in the repo tree
- [ ] `tests/.env.test.example` — documents all required env vars (E2E_TEST_USERNAME, E2E_TEST_PASSWORD, E2E_OTP_USERNAME, E2E_OTP_PASSWORD, KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET, MAILPIT_URL, KEYCLOAK_URL, BACKEND_URL, FRONTEND_URL, POSTGRES_URL)
- [ ] `npm install @keycloak/keycloak-admin-client@26.6.2 --prefix tests` — KC Admin client
- [ ] Mailpit response shape spike completed and field names recorded in `tests/e2e/fixtures/mailpit-helpers.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `tests/.auth/user.json` contains valid KC access token after globalSetup | E2E-01 | Token content inspection | Run `npx playwright test` once locally with KC running; inspect `.auth/user.json` for `kc-token` or equivalent sessionStorage key |
| Passkey test user `e2e-test@local` pre-seeded in local KC | E2E-03 | Requires manual KC console or Terraform action once | Log into KC admin console, create user with username `e2e-test@local`, set password, verify email |
| OTP test user `otp-test@local` pre-seeded with no passkeys | E2E-04 | Requires manual KC setup | Create `otp-test@local` in KC with password; confirm no WebAuthn credentials registered |
| Mailpit receiving OTP emails from backend during OTP tests | E2E-04 | Depends on docker-compose SMTP wiring | Trigger OTP request, check `http://localhost:8025` UI shows email |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
