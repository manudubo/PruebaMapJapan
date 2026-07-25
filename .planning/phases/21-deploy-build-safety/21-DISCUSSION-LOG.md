# Phase 21: Deploy & Build Safety - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-25
**Phase:** 21-deploy-build-safety
**Areas discussed:** CI gate architecture, drizzle-orm bump timing, KC healthcheck method, compatibility_date target

---

## CI Gate Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| workflow_run trigger | Deploy workflows trigger on: workflow_run: [CI] types: [completed]. Clean separation — CI and deploy stay independent. Standard GHA pattern. | ✓ |
| Inline checks in deploy | Copy typecheck/build/test steps into deploy workflow. Self-contained but duplicates logic. | |

**User's choice:** workflow_run trigger

---

### e2e job / CI conclusion

| Option | Description | Selected |
|--------|-------------|----------|
| continue-on-error: true on e2e | CI workflow conclusion becomes 'success' based on other jobs; e2e failures don't block deploys. | ✓ |
| Separate gate job per deploy workflow | Each deploy workflow adds needs: on specific jobs. More surgical but more YAML. | |

**User's choice:** continue-on-error: true on e2e job in ci.yml

---

### Backend CI test job (INFRA-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Run existing suite as-is | Add test-backend to ci.yml running npm run test --workspace=backend. Tests pass today (vacuous until Phase 24). | ✓ |
| Skip backend tests in CI for now | Add job but mark continue-on-error. | |

**User's choice:** Run existing suite as-is

---

## drizzle-orm Bump Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Bump now in Phase 21 | 2 HIGH vulns open. Minor bump not RQBv2 rewrite. Risk covered by --dry-run + E2E suite. | ✓ |
| Defer to Phase 24 | Wait for real test DB (ARCH-06). Leaves vulns open ~4 more phases. | |

**User's choice:** Bump now in Phase 21

---

## KC Healthcheck Method

| Option | Description | Selected |
|--------|-------------|----------|
| wget on /health/ready | KC 26+ built-in health endpoint. wget available in image. Checks actual readiness. | ✓ |
| /dev/tcp port check | Checks port open only. False-positive risk if KC listening but not serving. | |
| curl sidecar | Over-engineered for local dev docker-compose. | |

**User's choice:** wget -q --spider http://localhost:8080/health/ready

---

## compatibility_date Target

| Option | Description | Selected |
|--------|-------------|----------|
| 2024-09-23 — minimum fix | Exact minimum to resolve string_decoder gap. Surgical, low risk. | ✓ |
| 2025-01-01 — stable recent | ~6 months more behavior flags. | |
| Today (2026-07-25) — latest | All finalized CF Workers behavior flags. Maximum diff. | |

**User's choice:** 2024-09-23 — minimum fix
**Notes:** User asked about best practice. Recommendation: use minimum date, not latest — each compatibility_date activates all behavior flags finalized before that date; jumping to today risks unexpected regressions from unrelated changes.

---

## Claude's Discretion

- Exact CI yaml structure within the workflow_run pattern (job names, caching)
- Whether deploy-backend.yml should also run wrangler dry-run inline as extra gate step

## Deferred Ideas

- None
