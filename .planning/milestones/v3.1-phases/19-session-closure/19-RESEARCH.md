# Phase 19: Session + Closure — Research

**Researched:** 2026-07-13
**Domain:** Playwright E2E stabilization — selector verification, config fixes, test annotations, suite closure
**Confidence:** HIGH

## Summary

Phase 19 is the closure pass for v3.1 E2E Stabilization. It has three distinct work streams: (1) confirm `session-management.spec.ts` passes with the `loginViaKcForm` helper wired in Phase 17; (2) apply the three outstanding failure dispositions locked in CONTEXT.md (D-02 fixme, D-03 config fix, D-04 webkit fixme); (3) run the full suite and write `19-CLOSURE.md`.

All code-level facts were verified by reading the current files. No new libraries are needed. The only external dependency is a live stack (KC + backend + frontend) for the D-05 run, which is a plan execution concern, not a research concern.

One open question remains: whether D-03 (adding `storageState` to firefox/webkit projects in `playwright.config.ts`) actually causes the `auth.spec.ts` real-session tests to change state on firefox/webkit, given that `auth.spec.ts` already contains a describe-level `test.use({ storageState: ... })` that was present at the time of the Phase 15 triage. See Open Questions.

**Primary recommendation:** Two-plan split mirroring Phase 15 — 19-01 applies the three code changes (D-02, D-03, D-04); 19-02 runs D-05 and writes the closure document.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `session-management.spec.ts` is structurally complete — it already imports and uses `loginViaKcForm` from `tests/e2e/fixtures/kc-login-helper.ts` across all 6 tests. SESSION-01 is satisfied at the code level. Phase 19 plan item: run the spec against a live stack and record the result. If it passes, move to closure. If it fails unexpectedly, investigate before proceeding.
- **D-02:** `trip-edit-integration.spec.ts` [all browsers] → `test.fixme(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration')`. Keep the test; mark it so it does not count as an unexplained failure.
- **D-03:** `auth.spec.ts` real-session tests [firefox, webkit] → FIX by adding `storageState: '.auth/user.json'` to the `firefox` and `webkit` project entries in `tests/playwright.config.ts`. Same line that chromium already has. This is a config-bug — one line per project, no test code changes.
- **D-04:** `new-user-trip-creation.spec.ts` [webkit only] → `test.fixme` scoped to webkit. Rationale: spec passes on chromium and firefox; webkit handles the KC redirect differently when building a fresh browser context from `new-user.json`. This is an environment constraint, not an app bug.
- **D-05:** After all fixes and fixme additions, run `npx playwright test --trace retain-on-failure --retries 1` (full suite) from the `tests/` directory. This is the authoritative final signal. Results feed directly into `19-CLOSURE.md`.
- **D-06:** Closure output lives in `19-CLOSURE.md` — standalone file with: (1) final suite summary line (X passed, Y skipped, 0 failed), (2) per-spec status table (spec | project | final status | resolution note), (3) explicit accepted deferrals list with rationale for each `test.fixme`.

### Claude's Discretion

- Exact `test.fixme` message wording beyond the rationale captured above.
- Whether `new-user-trip-creation.spec.ts` webkit fixme is placed at the `describe` block level or per-test (whichever Playwright supports cleanly for webkit-scoped skipping).
- Order of plan tasks within a single plan file.

### Deferred Ideas (OUT OF SCOPE)

- OTP brute-force lockout: `attackDetection.del` in `otp.spec.ts` `beforeEach` — deferred, not needed for current test isolation.
- Per-recipient Mailpit isolation: `GET /api/v1/search?query=to:...` in `fetchLatestOtp()` — deferred until OTP coverage expands to multiple personas.
- Real-auth E2E in CI: Requires KC in CI environment; `SKIP_REAL_AUTH` removal deferred to future milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESSION-01 | `session-management.spec.ts` `loginViaBrowser()` uses stable selectors matching the current KC browser-flow shape | VERIFIED: all 6 tests call `loginViaKcForm(page, TEST_USER, TEST_PASS)` — code satisfies requirement; live run confirms runtime pass |
| DOC-01 | Any spec with genuine environment constraints is marked `test.fixme(condition, reason)` with an explicit rationale | D-02 (trip-edit-integration unconditional), D-04 (new-user webkit-scoped) — both covered by verified Playwright API |
| DOC-02 | v3.1 closes with zero unexplained test failures | D-05 full suite run + 19-CLOSURE.md covering all Phase 15 triage failures |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Test annotations (`test.fixme`) | E2E test layer | — | Playwright API call in spec files; no app code touched |
| Project config (`storageState`) | E2E config layer | — | `playwright.config.ts` sets browser context options |
| Session verification | E2E test layer + KC server | Backend API | `loginViaKcForm` drives the browser; `kcAdmin.getUserSessions` queries KC directly |
| Closure documentation | Planning artifact | — | `19-CLOSURE.md` is a markdown file, not runtime code |

## Standard Stack

### Core (no new installs required)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| Playwright | 1.60.0 | E2E test runner, browser automation | [VERIFIED: `npx playwright --version` → `Version 1.60.0`] |
| Node.js | 24.15.0 | Runtime | [VERIFIED: `node --version`] |

All work is test annotation and config editing. No packages need to be added.

**Installation:** None required.

## Architecture Patterns

### System Architecture Diagram

```
  Playwright CLI (npx playwright test)
         |
         v
  playwright.config.ts  ←── D-03: add storageState to firefox/webkit projects
         |
    ┌────┴──────────────────────────────┐
    │ globalSetup (global-setup.ts)     │
    │  creates .auth/user.json          │
    │  creates .auth/new-user.json      │
    └────┬──────────────────────────────┘
         |
    ┌────┴──────────────────────────────────────────────────────┐
    │ Per-project browser contexts (chromium / firefox / webkit) │
    │  storageState → .auth/user.json (after D-03)              │
    └────┬──────────────────────────────────────────────────────┘
         |
    ┌────┴─────────────────────────────────────────────────────────────┐
    │ Spec files                                                        │
    │  session-management.spec.ts  → loginViaKcForm() [VERIFIED wired] │
    │  auth.spec.ts (real-session) → test.use storageState override     │
    │  trip-edit-integration.spec.ts → test.fixme(true, ...) [D-02]    │
    │  new-user-trip-creation.spec.ts → test.fixme(webkit, ...) [D-04] │
    └──────────────────────────────────────────────────────────────────┘
         |
         v
  Live stack: KC:8080 + backend:8787 + frontend:5173
```

### Recommended Project Structure

No structural changes. All edits are in-place in existing files:
```
tests/
├── playwright.config.ts        # D-03: add storageState to firefox/webkit projects
├── e2e/
│   ├── session-management.spec.ts       # D-01: verify only (no edit expected)
│   ├── trip-edit-integration.spec.ts    # D-02: add test.fixme(true, ...)
│   ├── new-user-trip-creation.spec.ts   # D-04: add webkit-scoped test.fixme
│   └── auth.spec.ts                     # D-03: no code change needed
└── .planning/milestones/v3.1-phases/19-session-closure/
    └── 19-CLOSURE.md                    # D-06: write after D-05 run
```

### Pattern 1: D-03 — Adding storageState to firefox/webkit projects

**Current state** (`playwright.config.ts` lines 29–35 as read):
```typescript
// firefox — NO storageState
{
  name: 'firefox',
  use: { ...devices['Desktop Firefox'] },
  testIgnore: ['**/passkeys.spec.ts'],
},
// webkit — NO storageState
{
  name: 'webkit',
  use: { ...devices['Desktop Safari'] },
  testIgnore: ['**/passkeys.spec.ts'],
},
```

**After D-03 fix** (mirror the chromium pattern):
```typescript
// Source: playwright.config.ts chromium project (line 22-28) — same pattern
{
  name: 'firefox',
  use: {
    ...devices['Desktop Firefox'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
  testIgnore: ['**/passkeys.spec.ts'],
},
{
  name: 'webkit',
  use: {
    ...devices['Desktop Safari'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
  testIgnore: ['**/passkeys.spec.ts'],
},
```
[VERIFIED: chromium pattern read from `tests/playwright.config.ts` line 25]

**D-03 safety check — idp-theme.spec.ts:** Adding storageState to firefox/webkit projects makes them match chromium's starting state. `idp-theme.spec.ts` passes on firefox/webkit specifically because they currently lack storageState (KC does not skip the login page). D-03 would regress idp-theme on firefox/webkit IF that spec did not carry its own empty-storageState override.

Verified: `tests/e2e/idp-theme.spec.ts` line 25 contains `test.use({ storageState: { cookies: [], origins: [] } })` unconditionally inside its describe block. The comment even says 'This is a no-op on firefox and webkit (they have no project storageState).' After D-03, it becomes an active override on firefox/webkit — correct behavior, no regression. [VERIFIED: file read]

### Pattern 2: D-02 — Unconditional test.fixme at file scope

`trip-edit-integration.spec.ts` has 5 tests at file root with no wrapping `test.describe`. File-scope `test.fixme(condition, description)` marks ALL tests in the file.

```typescript
// Source: Context7 /microsoft/playwright — test.fixme(condition, description) at file/describe scope
// Place BEFORE any test declarations (after imports and configure)
test.describe.configure({ mode: 'serial' });
test.setTimeout(90000);

test.fixme(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration');
```
[VERIFIED: Context7 /microsoft/playwright — `test.fixme(condition, description)` is valid at file scope]

### Pattern 3: D-04 — webkit-scoped test.fixme

`new-user-trip-creation.spec.ts` has a single test (`NU-01`) inside one `test.describe`. Two valid placements per Playwright API:

**Option A — callback form at file scope** (marks all tests in file matching condition):
```typescript
// Source: Context7 /microsoft/playwright — test.fixme(callback, description)
test.fixme(({ browserName }) => browserName === 'webkit',
  'webkit handles KC redirect differently when building a fresh browser context from new-user.json — environment constraint');
```

**Option B — inside the single test body** (simpler for a single-test file):
```typescript
test('NU-01: full trip creation flow — empty dashboard to delete', async ({ page, browserName }) => {
  test.fixme(browserName === 'webkit',
    'webkit handles KC redirect differently when building a fresh browser context from new-user.json — environment constraint');
  // ... rest of test unchanged
});
```

**Recommendation:** Option A (file-scope callback) is preferred — matches the "describe block level" guidance in CONTEXT.md and makes the scope of the fixme immediately visible without reading the test body. Both forms are verified valid per Context7.

[VERIFIED: Context7 /microsoft/playwright — `test.fixme(({ browserName }) => browserName === 'webkit', reason)` at file scope is documented and valid]

### Anti-Patterns to Avoid

- **`test.skip` instead of `test.fixme`**: DOC-01 explicitly requires `test.fixme`. `test.skip` signals "intentionally excluded"; `test.fixme` signals "known broken, will fix". The distinction matters for milestone closure semantics.
- **`test.fixme()` with no reason string**: The description parameter is required for DOC-01 — it must state why, not just that the test is broken.
- **Applying fixme only to one test in trip-edit-integration**: All 5 tests in that file are affected by the same missing backend integration. The file-scope form is more maintainable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| webkit-scoped test marking | Custom skip logic / process.env parsing | `test.fixme(({ browserName }) => browserName === 'webkit', reason)` | Playwright's fixture injection is more reliable than env vars |
| KC browser login | Custom page interaction helpers | `loginViaKcForm` from `tests/e2e/fixtures/kc-login-helper.ts` | Already handles WebAuthn-first flow, try-another-way branch, and required-action pages |

## Phase 15 Triage → Phase 19 Closure Map

This is the authoritative list of every failure from 15-TRIAGE.md with its resolution phase. 19-CLOSURE.md must cover every entry.

| Spec | Project(s) | Phase 15 Failure | Resolution Phase | Resolution |
|------|-----------|-----------------|-----------------|------------|
| otp.spec.ts | chromium, firefox, webkit | contract-mismatch (auth-gated route) | Phase 17 | Fixed: OTP-01/02/03 (commits 75b873f, d042197) |
| idp-theme.spec.ts | chromium | storageState skip / PKCE reject | Phase 16 | Fixed: THEME-01/02/03 (commit 04c6a04) |
| passkeys.spec.ts | chromium-passkeys | missing UI (register button) | Phase 18 | Fixed: PASS-01/02/03 (commit 86281e9, STATE confirmed green) |
| session-management.spec.ts | chromium, firefox, webkit | contract-mismatch (KC flow shape) | Phase 17 + 19 | Partially fixed Phase 17 (loginViaKcForm wired); D-05 run confirms |
| auth.spec.ts (real-session) | firefox, webkit | config-bug (missing storageState) | Phase 19 | D-03 config fix + D-05 confirms |
| trip-edit-integration.spec.ts | chromium, firefox, webkit | missing-fixture (no backend integration) | Phase 19 | D-02: test.fixme(true, ...) — accepted deferral |
| new-user-trip-creation.spec.ts | webkit | missing-fixture (webkit KC redirect) | Phase 19 | D-04: webkit-scoped test.fixme — accepted deferral |

## Common Pitfalls

### Pitfall 1: auth.spec.ts real-session failure root cause may differ from triage diagnosis

**What goes wrong:** The Phase 15 triage attributed the firefox/webkit failure to "missing storageState at project level." But `auth.spec.ts` already has `test.use({ storageState: path.join(__dirname, '../.auth/user.json') })` inside the real-session describe block — and git log confirms this was present at the time of the triage (commit b259d7e, 2026-05-28, predates the triage).

**Why it happens:** Triage writers may have checked `playwright.config.ts` without inspecting describe-level `test.use` overrides in the spec file itself.

**How to avoid:** D-05 run is authoritative. If auth.spec.ts real-session passes on firefox/webkit WITH the current `test.use` but WITHOUT D-03, then D-03 is a consistency fix rather than a functional fix. Either way D-03 is correct to apply (it makes all three non-passkeys projects consistent). Record the actual outcome in 19-CLOSURE.md.

**Warning signs:** If D-03 is applied and auth.spec.ts still fails on firefox/webkit, the root cause is elsewhere (KC cookie format incompatibility, session.json missing for non-chromium, or `test.use` interaction with project-level options).

### Pitfall 2: test.fixme placement relative to test.describe.configure

**What goes wrong:** `test.fixme(true, reason)` placed AFTER `test.describe.configure({ mode: 'serial' })` and `test.setTimeout(90000)` in `trip-edit-integration.spec.ts` is the intended order. If placed inside a test body instead of at file scope, only that one test gets marked.

**How to avoid:** Place `test.fixme(true, reason)` at file scope before any `test(...)` declarations. Verify by running the file with `--list` and confirming all 5 tests show as "fixme".

### Pitfall 3: 19-CLOSURE.md written before D-05 run completes

**What goes wrong:** Closure document written with assumed pass/fail counts rather than actual run output.

**How to avoid:** D-06 depends on D-05. Run the full suite first, capture the summary line (`X passed, Y skipped, 0 failed`), then write the document. These are sequentially dependent — they must be separate tasks.

### Pitfall 4: Stale .auth/user.json from a previous session

**What goes wrong:** `user.json` with expired KC tokens causes session tests to fail with silent auth redirects.

**How to avoid:** The Phase 15 triage note is authoritative: delete `.auth/user.json` before the D-05 run so global-setup creates fresh KC auth. Include this as a pre-run step in 19-02-PLAN.md.

### Pitfall 5: D-03 regresses idp-theme on firefox/webkit

**What goes wrong:** D-03 adds storageState to firefox and webkit projects. Any spec that relies on the absence of project storageState to see the KC login page would regress. `idp-theme.spec.ts` is the only such spec in the suite.

**Why it doesn't happen:** `idp-theme.spec.ts` already has `test.use({ storageState: { cookies: [], origins: [] } })` at describe scope — unconditionally. This override was added in Phase 16 (THEME-01) to fix the chromium failure. It protects firefox/webkit after D-03 by overriding the newly-added project storageState with an empty one. [VERIFIED: file read]

**Warning signs:** If idp-theme.spec.ts fails on firefox/webkit after D-03, the empty-storageState override is either missing or misplaced.

## Code Examples

Verified patterns from official sources:

### File-scope unconditional fixme (D-02)
```typescript
// Source: Context7 /microsoft/playwright — test.fixme(condition, description)
test.fixme(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration');
```

### File-scope browser-conditional fixme (D-04)
```typescript
// Source: Context7 /microsoft/playwright — test.fixme(callback, description)
test.fixme(({ browserName }) => browserName === 'webkit',
  'webkit handles KC redirect differently when building a fresh browser context from new-user.json — environment constraint');
```

### playwright.config.ts storageState pattern (D-03)
```typescript
// Source: tests/playwright.config.ts chromium project (line 25) [VERIFIED: file read]
...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
```

### 19-CLOSURE.md structure (D-06)
```markdown
# Phase 19 Closure — v3.1 E2E Stabilization

**Date:** YYYY-MM-DD
**Suite run:** `npx playwright test --trace retain-on-failure --retries 1` (from tests/)
**Result:** X passed, Y skipped, 0 failed

## Per-Spec Status Table

| Spec | Project(s) | Status | Resolution |
|------|-----------|--------|------------|
| ... | ... | GREEN / FIXME (accepted) | ... |

## Accepted Deferrals

| Spec | Condition | Rationale |
|------|-----------|-----------|
| trip-edit-integration.spec.ts | unconditional | ... |
| new-user-trip-creation.spec.ts | webkit only | ... |
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D-03 project-level storageState fix causes auth.spec.ts real-session tests to pass on firefox/webkit | Common Pitfalls, Closure Map | auth.spec.ts describe already has test.use override — D-03 may be a consistency fix rather than a functional fix; D-05 run determines actual state |
| A2 | session-management.spec.ts passes on a live stack with loginViaKcForm | Phase Requirements (SESSION-01) | Code is correct; runtime pass requires live KC+backend+frontend — confirmed only by D-05 run |

## Open Questions (RESOLVED)

1. **Does D-03 actually change auth.spec.ts real-session behavior on firefox/webkit?**
   - What we know: `auth.spec.ts` real-session describe has `test.use({ storageState: path.join(__dirname, '../.auth/user.json') })` at describe scope (commit b259d7e, 2026-05-28, predates Phase 15 triage). In Playwright, describe-level `test.use` overrides project-level config. If this was active at triage time, the project-level config gap may not have been the real cause.
   - What's unclear: Whether describe-level `test.use` in Playwright 1.60 fully overrides missing project storageState, or whether there's a subtle interaction.
   - RESOLVED: Apply D-03 as a consistency fix regardless of auth.spec.ts describe-level override — it makes all three non-passkeys projects consistent with chromium. D-05 run is authoritative for actual behavior change. If auth.spec.ts real-session was already passing before D-03, note in 19-CLOSURE.md as "config-bug resolved; tests were already passing due to describe-level override."

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Playwright, test runner | Yes | v24.15.0 | — |
| Playwright | E2E suite (D-05) | Yes | 1.60.0 | — |
| Keycloak (localhost:8080) | D-05 live run, session-management | Not verified (runtime) | — | Set SKIP_REAL_AUTH=1 to skip real-auth tests |
| Backend (localhost:8787) | D-05 live run | Not verified (runtime) | — | Set SKIP_REAL_AUTH=1 |
| Frontend (localhost:5173) | D-05 live run | Not verified (runtime) | — | — |
| .auth/user.json | auth.spec.ts real-session, new-user-trip-creation | Created by global-setup | — | Delete stale file; let global-setup recreate |

**Missing dependencies with no fallback:**
- Live stack (KC + backend + frontend) is required for the D-05 authoritative run. The plan must include a pre-run checklist: start all services, delete `.auth/user.json`.

**Missing dependencies with fallback:**
- All real-auth specs (`SKIP_REAL_AUTH=1`) can be skipped if the live stack is unavailable; however the D-05 run is the milestone gate — this fallback would block closure.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright 1.60.0 |
| Config file | `tests/playwright.config.ts` |
| Quick run command | `npx playwright test session-management.spec.ts --project=chromium --trace retain-on-failure` |
| Full suite command | `npx playwright test --trace retain-on-failure --retries 1` (from `tests/`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESSION-01 | session-management.spec.ts uses loginViaKcForm and passes | E2E (live stack) | `npx playwright test session-management.spec.ts --trace retain-on-failure` | Yes |
| DOC-01 | trip-edit-integration + new-user webkit have test.fixme with rationale | Code inspection + `--list` | `npx playwright test --list` (verify fixme annotations visible) | Yes |
| DOC-02 | Full suite: zero unexplained failures | Full E2E (live stack) | `npx playwright test --trace retain-on-failure --retries 1` | Yes |

### Sampling Rate

- **Per task commit:** `npx playwright test --list` to verify fixme annotations; `tsc --noEmit` for type safety
- **Per wave merge:** Full suite run (D-05) — this is also the phase gate
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. All spec files exist; no new test files are needed for this phase.

## Sources

### Primary (HIGH confidence)
- `tests/e2e/session-management.spec.ts` — read directly; confirms loginViaKcForm used in all 6 tests [VERIFIED: file read]
- `tests/playwright.config.ts` — read directly; confirms firefox/webkit lack storageState [VERIFIED: file read]
- `tests/e2e/trip-edit-integration.spec.ts` — read directly; 5 tests at file root, no wrapping describe [VERIFIED: file read]
- `tests/e2e/new-user-trip-creation.spec.ts` — read directly; single test in describe, webkit failure confirmed [VERIFIED: file read]
- `tests/e2e/fixtures/kc-login-helper.ts` — read directly; confirms loginViaKcForm signature [VERIFIED: file read]
- `tests/e2e/auth.spec.ts` — read directly; confirms test.use storageState inside real-session describe [VERIFIED: file read]
- Context7 `/microsoft/playwright` — `test.fixme(condition, description)` and `test.fixme(callback, description)` APIs at file/describe scope [VERIFIED: Context7]
- `git log tests/e2e/auth.spec.ts` — confirms test.use was present at commit b259d7e (2026-05-28), predating Phase 15 triage [VERIFIED: git log]

### Secondary (MEDIUM confidence)
- `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md` — authoritative failure table; triage diagnosis for auth.spec.ts may not account for describe-level test.use [CITED: 15-TRIAGE.md]

## Metadata

**Confidence breakdown:**
- Code edits (D-02, D-03, D-04): HIGH — file contents verified, API verified
- SESSION-01 pass (runtime): MEDIUM — code is correct, runtime outcome pending D-05 run
- auth.spec.ts D-03 effect: LOW — describe-level test.use interaction with missing project storageState is ambiguous; D-05 is authoritative

**Research date:** 2026-07-13
**Valid until:** 2026-08-13 (stable: Playwright 1.60.0 is pinned, no dependency churn)
