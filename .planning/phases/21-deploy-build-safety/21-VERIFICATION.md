---
phase: 21-deploy-build-safety
verified: 2026-07-30T02:30:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Push the current HEAD (or merge to main) and confirm a real GitHub Actions `CI` run executes with `test-backend`/`build-backend` green and `e2e` red-but-`continue-on-error`, then confirm both `Deploy Frontend to GitHub Pages` and `Deploy Backend to Cloudflare Workers` fire via `workflow_run` and succeed, deploying the `head_sha` CI validated."
    expected: "CI workflow conclusion is `success` despite `e2e` failing (job-level continue-on-error keeps workflow conclusion green); both deploy workflows trigger only after that `success` conclusion and check out the same head_sha; deploy-backend uses `npm run deploy --workspace=backend` (visible in the run log, not `npx wrangler`)."
    why_human: "Local branch is 39 commits ahead of `origin/main` (`git log origin/main..HEAD` confirms none of the phase 21 commits are pushed). `gh run list` shows no CI or deploy run since the workflow files changed — the gating behavior has only been verified by static YAML inspection, never by an actual GitHub Actions execution. `workflow_run` triggers require the workflow file to already exist on the default branch, so the very first real exercise of this gate can only happen after a push to main."
  - test: "Manually break `build-backend` or `typecheck-backend` on a branch, open/merge to main, and confirm both deploy workflows do NOT run (workflow_run event never fires with `conclusion: success`, or the job's `if:` skips)."
    expected: "Deploy Frontend and Deploy Backend jobs show as skipped/not-triggered in the Actions tab for that commit."
    why_human: "This is the core claim of ROADMAP success criterion 2 ('a failing typecheck job blocks a frontend deploy') and cannot be observed without an actual red CI run on GitHub Actions; no red run exists yet against the new workflow files."
---

# Phase 21: Deploy & Build Safety Verification Report

**Phase Goal:** The backend build succeeds, production deploys are gated on CI passing, and runtime dependency vulnerabilities are closed
**Verified:** 2026-07-30T02:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `wrangler deploy --dry-run` exits 0, both `pg` and `neon-http` code paths bundle cleanly | ✓ VERIFIED | `npm run build --workspace=backend` → exit 0, "No bindings found. --dry-run: exiting now.", zero "Could not resolve" errors. `npx wrangler deploy --dry-run --outdir` bundle (`/tmp/wr_out/index.js`, 1.48 MB) greps positive for `node-postgres` and `neon-http` markers — both driver code paths are present in the compiled Worker. |
| 2 | Deploy workflows require typecheck/build/unit-test CI to pass; `e2e` excluded from gate; failing typecheck blocks deploy | ? UNCERTAIN (config verified, runtime not) | `deploy-frontend.yml`/`deploy-backend.yml` both use `on: workflow_run: workflows: [CI] ... types: [completed]` + `if: github.event.workflow_run.conclusion == 'success'`. `ci.yml` `e2e` job has `continue-on-error: true # ARCH-09`; `test-backend`/`build-backend`/`typecheck-backend`/`typecheck-frontend`/`test-frontend` have no such flag. **Never exercised**: local HEAD is 39 commits ahead of `origin/main` (unpushed); `gh run list` shows no CI/deploy run since these files changed. Routed to human verification. |
| 3 | `wrangler` is a pinned `devDependency`; no `npx wrangler` in any backend script | ✓ VERIFIED | `backend/package.json` `devDependencies.wrangler = "^3.101.0"`; `deploy-backend.yml` deploy step is `npm run deploy --workspace=backend` invoking `backend/package.json` `"deploy": "wrangler deploy"`. `grep -n npx.*wrangler .github/workflows/deploy-backend.yml` → empty. |
| 4 | `docker ps` shows Keycloak `healthy`; healthcheck uses `wget`/`/dev/tcp`, not `curl` | ✓ VERIFIED | `keycloak/docker-compose.yml` healthcheck is `["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 ..."]`; `grep curl keycloak/docker-compose.yml` → empty. Live test: `docker compose up -d` against the project's existing (persisted) `keycloak_postgres_data` volume → `docker inspect --format '{{.State.Health.Status}}' keycloak-keycloak-1` → `healthy` within 5s. |
| 5 | `npm audit --workspace=backend --omit=dev` shows 0 HIGH/CRITICAL; GHSA-gpj5-g38j-94v9 closed | ✓ VERIFIED | `npm audit --workspace=backend --omit=dev` → `found 0 vulnerabilities`. `backend/package.json` `drizzle-orm: ^0.45.2` (was `^0.38.3`), `hono: ^4.12.32` (was `^4.6.17`). |

**Score:** 5/5 truths have direct code/build evidence; truth #2's config is fully correct by inspection but its runtime behavior (the actual gating) is unverified — see Human Verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/wrangler.toml` | `compatibility_date = "2024-09-23"` | ✓ VERIFIED | Line 3 exact match; `nodejs_compat` flag retained. |
| `backend/package.json` | drizzle-orm ^0.45.2, hono ^4.12.32, drizzle-kit ^0.31.10 | ✓ VERIFIED | All three present exactly. |
| `frontend/package.json` | dompurify ^3.4.12 | ✓ VERIFIED | Exact match. |
| `package-lock.json` | resolved bumped versions | ✓ VERIFIED | `npm install` ran (per SUMMARY); `npm audit`/build/test all use resolved versions consistent with `package.json`. |
| `keycloak/docker-compose.yml` | bash `/dev/tcp` healthcheck, no curl | ✓ VERIFIED | See truth #4. |
| `.github/workflows/ci.yml` | `test-backend`, `build-backend`, `e2e continue-on-error` | ✓ VERIFIED | All three jobs present; `continue-on-error: true # ARCH-09` on `e2e` only. |
| `.github/workflows/deploy-frontend.yml` | `workflow_run` gate + head_sha checkout | ✓ VERIFIED | `workflow_run: workflows: [CI]`, `if: conclusion == 'success'`, `ref: head_sha`. |
| `.github/workflows/deploy-backend.yml` | `workflow_run` gate, `npm run deploy`, head_sha checkout | ✓ VERIFIED | Same gate pattern; `npm run deploy --workspace=backend`; no `working-directory: backend`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `deploy-frontend.yml` | `ci.yml` (`name: CI`) | `workflow_run.workflows: [CI]` + `conclusion == 'success'` | ✓ WIRED (config) | Exact name match confirmed; `ci.yml` line 1 is `name: CI`. Runtime firing unverified (no push yet). |
| `deploy-backend.yml` | `backend/package.json scripts.deploy` | `npm run deploy --workspace=backend` | ✓ WIRED | `deploy: "wrangler deploy"` resolves `wrangler` from `devDependencies` via npm's `node_modules/.bin` PATH injection. |
| `ci.yml` e2e | workflow conclusion | `continue-on-error: true` | ✓ WIRED (config) | GitHub Actions semantics: job-level `continue-on-error: true` makes a failed job report `success` to the workflow conclusion. Not yet observed on a real red `e2e` run against this file version. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend build (INFRA-03) | `npm run build --workspace=backend` | Exit 0, "No bindings found. --dry-run: exiting now.", no "Could not resolve" | ✓ PASS |
| Backend typecheck | `npm run typecheck --workspace=backend` | Exit 0 | ✓ PASS |
| Backend tests | `npm run test --workspace=backend` | 6 files / 34 tests passed, exit 0 | ✓ PASS |
| Backend prod-dep audit (DEP-01) | `npm audit --workspace=backend --omit=dev` | "found 0 vulnerabilities" | ✓ PASS |
| KC healthcheck on existing volume (INFRA-05) | `docker compose up -d` + `docker inspect ...Health.Status` | `healthy` at t=5s | ✓ PASS |
| KC healthcheck on a **fresh** volume (isolated `-p kc-freshtest` project, new anonymous volume) | same, watched to `retries: 15` exhaustion (~160s) | `unhealthy`, `FailingStreak: 16`; container logs show no realm-import lines at all | ⚠️ FAIL (see Anti-Patterns — pre-existing, out of INFRA-05 scope) |
| CI/deploy `workflow_run` gate actually firing | `gh run list` | No CI or deploy run exists against these workflow files; local HEAD 39 commits ahead of unpushed `origin/main` | ? SKIP → routed to human verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| INFRA-01 | 21-02 | Deploy workflows gate on typecheck/build/unit-test CI, exclude e2e | ✓ SATISFIED (config); runtime unverified | `workflow_run` + `conclusion == 'success'` + e2e `continue-on-error`, all present and internally consistent. |
| INFRA-02 | 21-02 | Backend CI unit-test job exists, runs before deploy conceptually | ✓ SATISFIED | `test-backend` job in `ci.yml` runs `npm run test --workspace=backend`; not job-chained to deploy but gated via workflow-level `workflow_run` conclusion, which is the mechanism the plan specified. |
| INFRA-03 | 21-01 | `wrangler deploy --dry-run` exits 0 | ✓ SATISFIED | Verified live, exit 0, no unresolved-builtin errors, both pg/neon-http paths bundled. |
| INFRA-04 | 21-02 | `wrangler` pinned devDependency, no `npx wrangler` | ✓ SATISFIED | Verified in `backend/package.json` and `deploy-backend.yml`. |
| INFRA-05 | 21-02 | KC healthcheck uses non-curl method, container reports healthy | ✓ SATISFIED (on this project's persisted state); ⚠️ latent gap on fresh state — see Anti-Patterns | Verified live `healthy` against the project's existing volume. |
| DEP-01 | 21-01 | drizzle-orm ^0.45.2, dompurify ^3.4.12, 0 HIGH/CRITICAL audit | ✓ SATISFIED | Verified via `npm audit` (0 vulnerabilities) and direct `package.json` inspection. |

**Docs-state finding (informational, not a code gap):** `.planning/REQUIREMENTS.md` currently checks `[x]` for INFRA-01/02/04/05 but leaves INFRA-03 and DEP-01 as `[ ]`, and the Traceability table at the bottom of the same file still lists all six of this phase's requirement IDs as "Pending." `.planning/ROADMAP.md`'s Phase 21 summary line and both plan checkboxes (`21-01-PLAN.md`, `21-02-PLAN.md`) are also still unchecked `[ ]`. This is a bookkeeping/phase-close task, not a code defect — flagging for the orchestrator to close out alongside this verification.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `keycloak/docker-compose.yml` | 35 | `command: start-dev` (no `--import-realm`) combined with the new healthcheck probing `/realms/japan-trip` | ⚠️ Warning | On any environment with a fresh/empty `postgres_data` volume (new clone, CI runner, `docker compose down -v`), the `japan-trip` realm is never created by Keycloak, the healthcheck's HTTP probe never returns 200, and the container is permanently `unhealthy` — the same end-state as before this phase's fix, just with a different root cause. Empirically confirmed: isolated `-p kc-freshtest` project run against a brand-new anonymous volume reached `FailingStreak: 16` / `unhealthy` after the full `retries: 15` × `interval: 10s` window; container logs contain zero import-related lines. This exact issue was already flagged as **WR-02** in `21-REVIEW.md` (code review, same phase) and left unaddressed — `command: start-dev` predates this phase and was not in scope for the plans' `files_modified`, so it is not treated as a phase-21 regression, but it does mean INFRA-05's "container reports healthy" guarantee only holds for environments that already have an imported realm (which is true of the current dev machine, tested and confirmed). Fix (per 21-REVIEW.md): `command: start-dev --import-realm`. |
| `.github/workflows/ci.yml` | 82 | `npm run build:frontend && npm run preview:frontend &` in the `e2e` job — `&` has lower precedence than `&&`, backgrounding the whole `build && preview` compound rather than just `preview`, so Playwright can start before the build finishes and before any server is listening | ℹ️ Info (pre-existing, flagged as WR-01 in `21-REVIEW.md`, not addressed) | Likely a root cause of e2e's 100% historical failure rate (ARCH-09) — informational for Phase 24, not blocking for Phase 21 since e2e is now non-blocking (`continue-on-error: true`) regardless of why it fails. |
| `.github/workflows/deploy-backend.yml` | 9 | No `concurrency:` group on the `deploy` job (frontend has `concurrency: group: pages`) | ℹ️ Info (flagged as WR-03 in `21-REVIEW.md`, not addressed) | Two rapid pushes to main could run two concurrent `wrangler deploy` invocations with no ordering guarantee; low risk for a personal, low-frequency project. |

None of the three items above are regressions introduced by this phase's commits — all three are pre-existing conditions surfaced/reviewed during this phase (WR-01/02/03 in `21-REVIEW.md`) and knowingly left unaddressed as out-of-scope. They do not block phase 21's own success criteria, which are about the healthcheck *mechanism* (curl → non-curl) and the CI *gate* (push → workflow_run), not about realm-import lifecycle or e2e test correctness.

### Human Verification Required

### 1. Confirm the CI→deploy gate fires correctly on a real push

**Test:** Push the current HEAD (or merge this work) to `origin/main`, then watch the Actions tab.
**Expected:** A `CI` workflow run completes with `test-backend`, `build-backend`, `typecheck-backend`, `typecheck-frontend`, `test-frontend` all green; `e2e` is red but the overall run conclusion is `success` (continue-on-error). `Deploy Frontend to GitHub Pages` and `Deploy Backend to Cloudflare Workers` both trigger afterward via `workflow_run`, checkout the same `head_sha`, and complete successfully — `deploy-backend`'s log shows `npm run deploy --workspace=backend`, not `npx wrangler`.
**Why human:** No such run has ever executed against these workflow files — local `HEAD` is 39 commits ahead of `origin/main` (unpushed), and `gh run list` shows the most recent CI/deploy runs predate all of phase 21's commits. `workflow_run` only fires once the triggering workflow file exists on the default branch, so this can only be exercised by an actual push.

### 2. Confirm a failing gate job actually blocks both deploys

**Test:** On a throwaway branch, introduce a deliberate `build-backend` or `typecheck-backend` failure, merge/push to main, observe Actions.
**Expected:** `CI` run conclusion is `failure`; neither `Deploy Frontend to GitHub Pages` nor `Deploy Backend to Cloudflare Workers` runs for that commit (workflow_run event's `if:` gate skips the job, or the event doesn't carry `conclusion: success`).
**Why human:** This is the literal claim in ROADMAP success criterion 2 ("a failing typecheck job blocks a frontend deploy") and is unverifiable by static file inspection — it requires observing GitHub Actions' actual event-dispatch behavior.

### Gaps Summary

No code-level gaps found — all five roadmap success criteria have direct, verified evidence in the codebase and via live command execution (build, typecheck, tests, audit, and a live Docker healthcheck against the project's real volume). Status is `human_needed` rather than `passed` solely because the CI-gating mechanism (success criterion 2 / INFRA-01) has never been exercised against a real GitHub Actions run — the relevant commits are unpushed and no `workflow_run`-triggered deploy has ever occurred. The YAML configuration is internally consistent and matches the plan's interfaces exactly, but "gating works" is a runtime claim about GitHub's event system that only a real push can confirm.

One latent (pre-existing, phase-21-adjacent) issue is documented under Anti-Patterns: the Keycloak `command: start-dev` (missing `--import-realm`) means the new healthcheck, while mechanically correct, only reports `healthy` on environments that already have an imported realm in their Postgres volume — a fresh clone or CI runner would see the container `unhealthy` forever. This was already caught and documented in this phase's own code review (`21-REVIEW.md`, WR-02) and is out of INFRA-05's stated scope (fixing the probe *method*, not the realm *lifecycle*).

---

*Verified: 2026-07-30T02:30:00Z*
*Verifier: Claude (gsd-verifier)*
