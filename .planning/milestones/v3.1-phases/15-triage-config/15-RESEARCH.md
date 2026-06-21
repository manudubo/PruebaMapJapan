# Phase 15: Triage + Config — Research

**Researched:** 2026-06-21
**Domain:** Playwright E2E test configuration + triage methodology
**Confidence:** HIGH — all claims verified against codebase (playwright.config.ts, global-setup.ts, passkeys.spec.ts) and Context7 Playwright docs

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Passkeys project scoping (SETUP-02)**
- Add `testIgnore: ['**/passkeys.spec.ts']` to the `chromium`, `firefox`, `webkit` project entries in `tests/playwright.config.ts`
- The `chromium-passkeys` entry is already correct — leave it unchanged
- Root cause: `page.context().newCDPSession()` is CDP-only; firefox/webkit cannot expose it
- Commit this fix alone before running triage

**D-02: Triage run configuration (SETUP-01)**
- Method: CLI flags only — `npx playwright test --trace retain-on-failure --retries 1`
- Do NOT edit `playwright.config.ts` for trace or retry settings
- `retries: 1` is diagnostic only — pass-on-retry = `flaky`, not fixed

**D-03: Failure list output (SETUP-01)**
- File: `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md`
- Columns: `| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |`
- Failure mode categories: `config-bug`, `contract-mismatch`, `missing-fixture`, `env`, `flaky`, `unknown`
- Supersedes the stale v3.0 list in `.planning/research/SUMMARY.md`

**D-04: Order of operations**
1. Apply SETUP-02 (add `testIgnore`) and commit with message `fix(e2e): scope passkeys spec to chromium-passkeys project only`
2. Run: `npx playwright test --trace retain-on-failure --retries 1`
3. Write `15-TRIAGE.md` from triage output
4. Commit `15-TRIAGE.md`

### Claude's Discretion

None declared.

### Deferred Ideas (OUT OF SCOPE)

- Fixing any failing spec — Phases 16–19
- OTP route auth-gating product decision — Phase 17 discuss
- Extracting shared `loginViaKcForm()` helper — Phase 17
- Moving `WebAuthn.removeVirtualAuthenticator` to `afterEach` — Phase 18 (PASS-01)
- `public-sharing.spec.ts` seed data — Phase 16
- `idp-theme.spec.ts` PKCE challenge and storageState pre-emptive fixes — Phase 18
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SETUP-02 | `passkeys.spec.ts` scoped to Chromium-only projects via `testIgnore` on `chromium`, `firefox`, `webkit` project entries | testIgnore at project level confirmed by Context7; exact syntax matches `testMatch` already used on `chromium-passkeys` |
| SETUP-01 | Fresh full-suite triage run with `--trace retain-on-failure --retries 1` produces `15-TRIAGE.md` superseding stale v3.0 list | Requires full env stack up + SKIP_REAL_AUTH unset; triage methodology documented below |
</phase_requirements>

---

## Summary

Phase 15 has two tasks. SETUP-02 is a 3-line mechanical edit to `tests/playwright.config.ts` — fully specified, no research ambiguity. SETUP-01 is a human-executed triage run that requires the full dev stack (KC + Mailpit + Postgres + frontend + backend) to produce authoritative signal.

The key planning constraint is that `global-setup.ts` throws if KC is unavailable when `SKIP_REAL_AUTH` is not set — it calls `waitForServer` (30 retries × 1s) and then navigates to `dashboard.html` and waits for the KC login redirect. A KC-down run with `SKIP_REAL_AUTH` unset does not produce partial triage output: it aborts entirely at global-setup, before any spec runs. This means SETUP-01 cannot be executed by an automated agent; it requires the user to bring up the dev stack first.

The stale baseline from `.planning/research/SUMMARY.md` provides the pre-existing failure set for criterion #3 (distinguishing pre-existing vs. newly introduced): passkeys×3 (resolved by SETUP-02, absent from post-fix run), otp 1–3 (contract-mismatch), public-sharing (missing-fixture), idp-theme (unconfirmed), session-management (unconfirmed).

**Primary recommendation:** Plan SETUP-02 as an automated task (edit + commit). Plan SETUP-01 as a user-executed task with explicit pre-conditions (stack up, SKIP_REAL_AUTH unset) and a post-run document task (write 15-TRIAGE.md from output).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| passkeys testIgnore config edit | Test config (playwright.config.ts) | — | 3-line change to project array entries |
| Full-suite triage run | User / local dev machine | — | Requires live KC, Mailpit, Postgres — cannot be run by automated executor with env down |
| 15-TRIAGE.md authoring | Plan executor (post-run) | — | Document from stdout/reporter output after user runs triage |

---

## SETUP-02: testIgnore Verification

### Confirmed API

`testProject.testIgnore` is a first-class Playwright TestProject property.
[VERIFIED: Context7 /microsoft/playwright.dev — testProject.testIgnore]

- **Type:** `string | RegExp | Array<string | RegExp>`
- **Matching:** Performed against the **absolute file path** — strings treated as glob patterns
- **Scope:** Project-level — overrides nothing at global level; additive with global `testIgnore` if set
- `'**/passkeys.spec.ts'` glob matches the absolute path because `**` matches any prefix, including the full directory path up to the filename

### Exact Change Required

```typescript
// tests/playwright.config.ts — current:
{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }) } },
{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
{ name: 'chromium-passkeys', use: { ...devices['Desktop Chrome'] }, testMatch: ['**/passkeys.spec.ts'] },

// After SETUP-02:
{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }) }, testIgnore: ['**/passkeys.spec.ts'] },
{ name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: ['**/passkeys.spec.ts'] },
{ name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: ['**/passkeys.spec.ts'] },
{ name: 'chromium-passkeys', use: { ...devices['Desktop Chrome'] }, testMatch: ['**/passkeys.spec.ts'] },
```

[VERIFIED: tests/playwright.config.ts read directly]

### No Edge Cases with This Pattern

The `chromium-passkeys` project has an explicit `testMatch: ['**/passkeys.spec.ts']`. After SETUP-02, the three general projects have `testIgnore: ['**/passkeys.spec.ts']`. Playwright evaluates `testMatch` and `testIgnore` independently per project — there is no interaction between project entries. The result is that `passkeys.spec.ts` runs under exactly one project: `chromium-passkeys`.

---

## SETUP-01: Triage Run Methodology

### Environment Pre-Conditions (CRITICAL)

**All four services must be running before the triage command:**

| Service | Port | Start Command | What Breaks Without It |
|---------|------|---------------|----------------------|
| Keycloak 26.6.1 (via Docker) | 8080 | `npm run dev` (from repo root) | global-setup throws after 30s; entire run aborts |
| Mailpit | 1025 (SMTP), 8025 (API) | same Docker Compose | OTP specs fail immediately |
| Postgres 16 | 5432 | same Docker Compose | OTP spec `postgres()` connection throws in beforeEach |
| Vite frontend dev server | 5173 | same `npm run dev` | `waitForServer` if `WAIT_FOR_FRONTEND=true`; otherwise specs fail on navigation |

`npm run dev` (from repo root) executes `scripts/dev.js` which: opens Docker Desktop if needed, runs `docker compose up -d` in `keycloak/`, waits for KC health, then starts backend + frontend via `concurrently`.
[VERIFIED: package.json scripts, scripts/dev.js, keycloak/docker-compose.yml read directly]

**Environment variable requirement:** `SKIP_REAL_AUTH` must be unset (or empty). If set, `global-setup.ts` skips the KC login entirely, and all real-auth specs skip silently — producing a partial run that cannot supersede the stale list per success criterion #1.
[VERIFIED: global-setup.ts:176 `if (!process.env.SKIP_REAL_AUTH)`]

### What Happens When KC is Down with SKIP_REAL_AUTH Unset

`global-setup.ts` calls `waitForServer(FRONTEND_URL)` only when `WAIT_FOR_FRONTEND=true`. It does NOT call `waitForServer` for KC unless that env var is set. However, `kcLogin()` navigates to `dashboard.html` and then `waitForURL(/localhost:8080/, { timeout: 15_000 })` — if KC is not running this times out and throws, aborting the entire global-setup. Result: **zero spec output**. A KC-down run produces no triage data.
[VERIFIED: global-setup.ts:55–62 read directly]

### Triage Command

Run from `tests/` directory:
```bash
cd tests
npx playwright test --trace retain-on-failure --retries 1
```

CLI flags override config: `playwright.config.ts` has `trace: 'on-first-retry'` and `retries: 0` locally. The CLI flags make trace `retain-on-failure` and `retries: 1` for this diagnostic run only. No config file edits needed.
[VERIFIED: tests/playwright.config.ts; Context7 Playwright CLI flag behavior]

### HTML Reporter Blocking Concern

`playwright.config.ts` configures `reporter: [['html'], ...]`. In non-CI environments the HTML reporter opens a local server and waits for user input on test completion (when tests fail). This can block an automated executor.

**Mitigation:** Append `--reporter=list` to override, or set `PLAYWRIGHT_HTML_OPEN=never` as an env var before running. The `--reporter=list` flag is a CLI flag consistent with D-02 (CLI flags only, no config edits).

Recommended triage command:
```bash
cd tests
npx playwright test --trace retain-on-failure --retries 1 --reporter=list
```
[ASSUMED — HTML reporter blocking is a known Playwright behavior; `PLAYWRIGHT_HTML_OPEN=never` env var documented in Playwright docs but not verified in this session via Context7]

### What Trace Files Are Retained

With `--trace retain-on-failure --retries 1`:
- Tests that **fail on both attempt 0 and attempt 1**: trace is retained for attempt 1
- Tests that **fail on attempt 0 but pass on attempt 1** (flaky): the final status is "passed" — `retain-on-failure` does NOT keep trace for these because the final attempt passed
- Tests that **pass on both**: no trace

Implication: flaky tests will have no trace artifact. Classification must come from stdout output showing "1 passed (retry)".

### 15-TRIAGE.md Output Format

```markdown
# Phase 15 Triage — Full Suite Run

**Date:** YYYY-MM-DD
**Config:** Post-SETUP-02 (passkeys scoped to chromium-passkeys)
**Command:** `npx playwright test --trace retain-on-failure --retries 1 --reporter=list`
**Traces:** `tests/test-results/` (not committed)

## Failure Table

| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |
|------|-----------|-----------------|--------------|-----------------|
| ... | ... | ... | ... | ... |

## Notes

[Any env anomalies observed during run]
```

**Status values:**
- `Pass` — all retries green
- `Fail` — failed on all retries
- `Flaky` — failed attempt 0, passed attempt 1
- `Skip(reason)` — skipped by guard (e.g. `SKIP_REAL_AUTH`, `test.skip()`, `beforeEach` `test.skip()`)

Adding `Skip(reason)` ensures the list is complete — without it, env-gated specs that silently skip would be absent from the table, making the list misleading.

**Pre-existing baseline** (from `.planning/research/SUMMARY.md` — to diff against):
- `passkeys.spec.ts` under `firefox`, `webkit`: resolved by SETUP-02, should not appear
- `otp.spec.ts` tests 1–3: expected `Fail` — `contract-mismatch`
- `public-sharing.spec.ts`: expected `Fail` — `missing-fixture`
- `idp-theme.spec.ts`: unconfirmed — triage will classify
- `session-management.spec.ts`: unconfirmed — triage will classify

Any failing spec **not in this baseline** is newly introduced by recent commits and must be noted in 15-TRIAGE.md.

---

## Common Pitfalls

### Pitfall 1: Stale `.auth/user.json` causes global-setup re-login attempt
**What goes wrong:** `.auth/user.json` has a 20-minute freshness window. If it is > 20 minutes old and KC is running, global-setup runs `kcLogin()` again before the spec suite starts. This is expected and correct. If `.auth/user.json` is fresh but stale tokens have expired (KC idle timeout is 30 min), real-auth specs fail mid-run with redirect to KC login.
**How to avoid:** Delete `.auth/user.json` before a triage run that starts more than 20 minutes after the last login.
[VERIFIED: global-setup.ts:37–42, MAX_AGE_MS = 20 * 60 * 1000]

### Pitfall 2: HTML reporter blocks automated executor on failure
**What goes wrong:** Default `html` reporter opens a local webserver and waits, blocking the process from exiting.
**How to avoid:** Use `--reporter=list` CLI flag or set `PLAYWRIGHT_HTML_OPEN=never`.
[ASSUMED — well-known Playwright behavior]

### Pitfall 3: `retries: 1` masks env instability vs. genuine flakiness
**What goes wrong:** A test that passes on retry due to a transient Docker networking issue is classified as `flaky` and deferred, when the real cause is env health. This inflates the flaky count.
**How to avoid:** Run the triage after confirming Docker and KC are stable (check KC health endpoint: `curl http://localhost:8080/realms/japan-trip`). Note any env anomalies in the 15-TRIAGE.md Notes section.

### Pitfall 4: Workers 2 + fullyParallel can produce cross-spec pollution
**What goes wrong:** `playwright.config.ts` has `workers: 2` and `fullyParallel: true`. Auth state pollution (AS-04: OTP spec inherits KC SSO cookie) can produce failures that only appear when two specs run in the same worker concurrently.
**How to avoid:** For any ambiguous failure in the triage, re-run that single spec in isolation (`npx playwright test tests/e2e/failing.spec.ts --reporter=list`) to confirm the failure is real and not a parallelism artifact. Note the isolation result in 15-TRIAGE.md.
[VERIFIED: playwright.config.ts workers:2 fullyParallel:true; PITFALLS.md AS-04]

---

## Environment Availability

| Dependency | Required By | Available Now | Version | Bring-Up |
|------------|------------|---------------|---------|----------|
| Docker / Docker Desktop | KC + Mailpit + Postgres | Not probed (env not running) | — | `npm run dev` from repo root |
| Keycloak 26.6.1 | global-setup + real-auth specs | Not running (port 8080 down) | — | `npm run dev` |
| Mailpit | `otp.spec.ts` `fetchLatestOtp` | Not running (port 8025 down) | — | `npm run dev` |
| Postgres 16 | `otp.spec.ts` `postgres()` | Not running (port 5432 down) | — | `npm run dev` |
| Vite frontend (5173) | All browser-navigation specs | Not running | — | `npm run dev` |
| Playwright 1.60.0 | SETUP-02 + SETUP-01 | Available | 1.60.0 | Already installed |

[VERIFIED: env probe — all services down at research time; Playwright version `npx playwright --version` → 1.60.0]

**All services start via a single command: `npm run dev` from repo root.**
This command: opens Docker Desktop if needed, runs `docker compose up -d` (KC 26.6.1 + Mailpit + Postgres), waits for KC health (`/realms/japan-trip`), then starts backend + frontend via concurrently.

**SETUP-01 cannot be run by an automated executor with services down.** The user must execute the triage run after bringing up the full stack.

---

## Validation Architecture

SETUP-02 verification is structural: after the edit, `npx playwright test tests/e2e/passkeys.spec.ts --project=firefox --reporter=list` should exit with "0 tests" (testIgnore excludes the file). This is a 1-command smoke check, not a full suite run.

SETUP-01 is itself the validation artifact — the `15-TRIAGE.md` it produces is the test output.

No new test files needed. No Wave 0 gaps.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Project-level test exclusion | Custom test.skip() logic inside the spec | `testIgnore` at project config level |
| Triage output parsing | Custom reporter or script | `--reporter=list` stdout — human-readable, captures pass/fail/flaky per spec |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `--reporter=list` overrides the configured `html` reporter in Playwright CLI | SETUP-01 Triage Command | If CLI reporter appends rather than overrides, HTML reporter still opens; add `PLAYWRIGHT_HTML_OPEN=never` as fallback |
| A2 | `PLAYWRIGHT_HTML_OPEN=never` prevents HTML reporter from opening a server | Pitfall 2 | Minor — worst case user Ctrl+C and re-run with `--reporter=list` |

---

## Sources

### Primary (HIGH confidence)
- Context7 `/microsoft/playwright.dev` — `testProject.testIgnore` API, type, and glob behavior
- `tests/playwright.config.ts` — current project entries verified directly
- `tests/global-setup.ts` — KC dependency chain and SKIP_REAL_AUTH behavior verified directly
- `tests/e2e/passkeys.spec.ts:46–48` — `newCDPSession()` + `WebAuthn.enable` CDP-only calls confirmed
- `keycloak/docker-compose.yml` — service definitions (KC 26.6.1, Mailpit, Postgres 16)
- `scripts/dev.js` + `package.json` — dev stack bring-up command (`npm run dev`)
- `.planning/research/SUMMARY.md` — stale baseline failure list
- `.planning/research/PITFALLS.md` — cross-spec pollution patterns (AS-04, TD-03)

### Tertiary (LOW confidence)
- A1: `--reporter=list` overrides vs. appends configured reporters — not verified via Context7 in this session

---

## Metadata

**Confidence breakdown:**
- SETUP-02 (testIgnore edit): HIGH — API confirmed via Context7, exact file state verified
- SETUP-01 (triage methodology): HIGH — global-setup behavior verified from source; env bring-up command verified
- Environment availability: HIGH — services probed and confirmed down; bring-up path verified from scripts

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable Playwright 1.x config API)
