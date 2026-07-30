---
phase: 21
slug: deploy-build-safety
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-07-25
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 (backend + frontend) |
| **Config file** | `backend/vitest.config.*` (or package.json vitest key) |
| **Quick run command** | `npm run test --workspace=backend` |
| **Full suite command** | `npm run test:run --workspace=frontend && npm run test --workspace=backend` |
| **Estimated runtime** | ~10 seconds (backend vitest only) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test --workspace=backend`
- **After every plan wave:** Run `npm run test:run --workspace=frontend && npm run test --workspace=backend`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-*-INFRA-03 | TBD | 1 | INFRA-03 | — | Backend build exits 0 | smoke | `cd backend && npx wrangler deploy --dry-run` | ✅ | ⬜ pending |
| 21-*-INFRA-04 | TBD | 1 | INFRA-04 | — | No npx wrangler in workflows | static | `grep -r 'npx wrangler' .github/` | N/A | ⬜ pending |
| 21-*-INFRA-05 | TBD | 1 | INFRA-05 | — | KC container shows healthy | smoke | `docker ps --format '{{.Names}}\t{{.Status}}' \| grep keycloak` | N/A | ⬜ pending |
| 21-*-DEP-01a | TBD | 1 | DEP-01 | Supply chain | 0 HIGH/CRITICAL prod deps | smoke | `npm audit --workspace=backend --omit=dev` | ✅ | ⬜ pending |
| 21-*-DEP-01b | TBD | 1 | DEP-01 | — | Relational queries work after drizzle bump | integration | Local stack: `GET /trips/:id`, `GET /destinations/:id` | N/A | ⬜ pending |
| 21-*-INFRA-01 | TBD | 2 | INFRA-01 | — | Deploy workflow gates on CI | manual | Inspect Actions: failing typecheck → no deploy triggered | N/A | ⬜ pending |
| 21-*-INFRA-02 | TBD | 2 | INFRA-02 | — | test-backend job green in CI | manual | Inspect CI run in Actions after push to main | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

No new test files are required — all verification is configuration-level (workflow YAML, wrangler.toml) and tool-level (npm audit, wrangler dry-run, docker ps). The backend vitest suite exists and is already wired into CI plans.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deploy workflow gates on CI failure | INFRA-01 | GitHub Actions behavior — cannot be tested locally | Trigger a push with a failing typecheck; verify no deploy workflow runs or it exits early |
| test-backend job green in CI | INFRA-02 | CI job — only verifiable via GitHub Actions run | Push to main; inspect Actions UI for `test-backend` job green status |
| KC container shows `healthy` | INFRA-05 | Docker runtime state | Run `docker ps` after 30s start period; confirm `healthy` status for keycloak container |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
