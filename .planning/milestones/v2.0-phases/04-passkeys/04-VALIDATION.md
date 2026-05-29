---
phase: 4
slug: passkeys
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-07
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 |
| **Config file** | `frontend/vite.config.ts` (vitest config inline) |
| **Quick run command** | `cd frontend && npm run test:run` |
| **Full suite command** | `cd frontend && npm run test:run -- --coverage` |
| **Typecheck command** | `cd frontend && npm run typecheck` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test:run`
- **After every plan wave:** Run `cd frontend && npm run test:run -- --coverage`
- **Before `/gsd-verify-work`:** Full suite must be green; typecheck must pass
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PASS-02 | T-04-01 | RP ID set to exact domain match (not wildcard) | config check | `grep "keycloak:26.6.1" keycloak/docker-compose.yml && node -e "const r=require('./keycloak/realm-export.json'); process.exit(r.webAuthnPolicyPasswordlessRpId==='localhost'?0:1);"` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | PASS-02 | — | N/A | typecheck | `cd frontend && npm run typecheck` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | PASS-01 | — | N/A | config check | `grep "type=webauthn-passwordless" frontend/src/pages/profile.ts && grep "c.type === 'webauthn-passwordless'" frontend/src/pages/profile.ts` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 2 | PASS-01 | — | N/A | config check | `grep "action: 'webauthn-register-passwordless'" frontend/src/pages/profile.ts` | ✅ | ⬜ pending |
| 04-02-03 | 02 | 2 | PASS-03 | T-04-04, T-04-08 | DELETE uses Bearer token; credId validated non-empty; button disabled during request | unit + config | `grep "method: 'DELETE'" frontend/src/pages/profile.ts && grep "data-passkey-delete" frontend/src/pages/profile.ts && cd frontend && npm run test:run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files needed — changes are configuration and DOM-wiring. Optional unit test for `loadPasskeys()` and `deletePasskey()` may be added in the plan.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Passkey registration flow end-to-end | PASS-01 | Requires live Keycloak + WebAuthn API (browser biometric) | `docker compose down -v && docker compose up -d`, navigate to `http://localhost:5173/profile.html`, click "Add passkey", complete biometric prompt, verify passkey appears in list |
| Passkey delete end-to-end | PASS-03 | Requires live Keycloak + registered passkey | Click delete button next to a passkey, confirm in modal, verify passkey no longer appears in list |
| "Webauthn Register Passwordless" required action enabled | PASS-01 | Must be verified in Keycloak Admin UI post-import | After `docker compose up`, open `http://localhost:8080/admin` → japan-trip realm → Authentication → Required Actions → confirm "Webauthn Register Passwordless" is enabled |
| webAuthnPolicyPasswordlessRpId applied after fresh import | PASS-02 | Requires `docker compose down -v` (not just restart) | After full down-v + up, curl the realm: `curl http://localhost:8080/realms/japan-trip/.well-known/openid-configuration` and check `webAuthnPolicyPasswordlessRpId` via admin API |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-07
