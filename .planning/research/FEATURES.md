# Feature Landscape: E2E Suite Stabilization

**Domain:** Playwright E2E suite stabilization — Keycloak OIDC PKCE + WebAuthn CDP + OTP + MPA
**Researched:** 2026-06-16
**Confidence:** HIGH for all findings grounded directly in repo code (file:line citations); MEDIUM for general Playwright ecosystem patterns used to corroborate, flagged inline.

---

## Overview

v3.1 is a pure stabilization milestone — no new product features. The goal is a fully green E2E suite against the existing codebase. The 18-spec suite (`tests/e2e/`) covers two fundamentally different environments: specs that can run anywhere (mocked auth, no external services) and specs that require a live KC + backend + Mailpit stack. The existing harness has a well-built foundation (`global-setup.ts`, `kc-admin.ts` fixture, serial-mode OTP, CDP passkeys, SKIP_REAL_AUTH CI guard) — the gaps are specific and fixable.

Three confirmed root causes established by direct code inspection before this milestone's live triage run:

1. **`passkeys.spec.ts` — test config bug.** `playwright.config.ts` has no `testIgnore` on the `chromium`/`firefox`/`webkit` projects, so the passkeys spec (which calls `page.context().newCDPSession()`, a Chromium-only CDP API) runs under all 4 projects. Firefox/WebKit throw. This is almost certainly the entire "passkeys ×3" stale-failure entry.

2. **`otp.spec.ts` — spec calls auth-gated routes without a JWT.** `backend/src/routes/auth.ts:92` applies `authMiddleware` to all routes in the auth router via `authRoute.use('*', authMiddleware, ensureUserProvisioned)`. Both `/otp-request` and `/otp-verify` are behind this gate. This is **confirmed intentional design**: `otp-request` reads the requester's email from `c.get('user').email` (JWT claim, line 103) — it takes no body email field. The spec (`otp.spec.ts:22-35`) calls these routes via Playwright's `request` fixture with no Bearer token, and passes `{ email, code }` in the body. The routes receive unauthenticated requests; they 401. This is a spec bug — the spec models OTP as a public login-fallback route, but the implementation is a step-up-auth service for already-authenticated users.

3. **`public-sharing.spec.ts` — stale fixture values.** `PUBLIC_SLUG`, `PRIVATE_SLUG`, and `PUBLIC_TRIP_ID = '1'` are hardcoded; the assertion `body.data.name === 'Japan 2026'` is string-exact. The spec has no `beforeAll`/`afterAll` creating or restoring this data. Whether these rows exist in the current dev DB is unknown until triage — but this is a structural fixture-ownership gap regardless.

These are a test-config bug, a spec-vs-contract mismatch, and a missing data fixture — none are flaky tests in the retry-and-pray sense.

---

## Table Stakes

Features every stable E2E suite must have. Missing = suite is unreliable or uninterpretable.

| Feature | Why Expected | Present in Repo? | Gaps / Notes |
|---------|--------------|-----------------|--------------|
| **Retries on CI** | Distinguishes genuine failures from infra noise | Yes — `retries: process.env.CI ? 2 : 0` (`playwright.config.ts:8`) | 0 retries locally by design. Correct. |
| **Trace + video on first retry** | Makes post-mortem possible without re-running | Yes — `trace: 'on-first-retry'`, `video: 'on-first-retry'` (`playwright.config.ts:17-18`) | Artifacts uploaded on CI failure via `actions/upload-artifact@v4` (`ci.yml:71-76`). Correct. |
| **`forbidOnly` in CI** | Prevents accidental `.only()` from silencing failures | Yes — `forbidOnly: !!process.env.CI` (`playwright.config.ts:7`) | Correct. |
| **Test isolation: each test owns its state** | Flakiness from shared state is the #1 cause of irreproducible failures | Partial | `otp.spec.ts` and `session-management.spec.ts` use `serial` mode + `beforeEach` cleanup — correct for their use case. `passkeys.spec.ts` resets credentials in `beforeEach` via `kcAdmin.resetCredentials()`. `public-sharing.spec.ts` has no setup/teardown and depends on implicit DB seed state — structural gap. |
| **Environment guard at suite entry** | Specs requiring live KC must self-skip cleanly, not error confusingly | Partial | Three strategies coexist: `test.skip(!!SKIP_REAL_AUTH)` (otp, passkeys, session-management), live health-probe-then-skip (idp-theme, public-sharing), and no guard (auth.spec.ts mocked tests). All three work, but inconsistency complicates triage — a spec using the live-probe pattern that connection-errors rather than skipping suggests a misconfigured probe port/URL, not a feature regression. |
| **Stable auth fixture** | All KC-authenticated specs share a single trusted login that doesn't race or expire mid-run | Yes — `global-setup.ts` produces `.auth/user.json` + `.auth/session.json`, 20-min freshness guard, `addInitScript` workaround for Playwright bug #31108 | Freshness window (20 min) is sound. The `kcLogin()` function's "Try Another Way → Password" branching must match the current KC browser-flow shape — this is a known fragility shared with `session-management.spec.ts` and `otp.spec.ts`. |
| **`SKIP_REAL_AUTH` CI escape hatch** | CI has no KC — suite must pass in CI without real auth | Yes — guards present in otp, passkeys, session-management; CI workflow sets `SKIP_REAL_AUTH: 'true'` (`ci.yml:69`) | idp-theme and public-sharing use live health-probes instead — their CI behavior depends on whether the probe URLs happen to respond (coincidental), not on a structured env-var gate. |
| **Browser-engine scoping for engine-specific APIs** | CDP is Chromium-only; WebAuthn Virtual Authenticator via CDP must not run on Firefox/WebKit | NO — critical gap | `playwright.config.ts` scopes `chromium-passkeys` to `passkeys.spec.ts` via `testMatch`, but the `chromium`, `firefox`, `webkit` projects have no `testIgnore`. Result: the spec runs under all 4 projects; firefox/webkit throw on `newCDPSession()`. Fix: add `testIgnore: ['**/passkeys.spec.ts']` to `chromium`, `firefox`, `webkit` projects. After this fix, passkeys are covered locally by `chromium-passkeys` only; they do not appear in CI at all (CI runs `--project=chromium` which will have `testIgnore`). This is the correct behavior — passkeys require real-auth and real CDP support, neither of which CI has. |
| **Serial mode for inbox-sharing specs** | Parallel OTP tests race on the shared Mailpit inbox | Yes — `test.describe.configure({ mode: 'serial' })` in `otp.spec.ts:5` | Correct. Same pattern in `session-management.spec.ts:95` (mutable KC session state). |
| **Deterministic fixture data** | Assertions on specific data values must be seeded and owned by the test | NO — gap | `public-sharing.spec.ts` hardcodes `PUBLIC_SLUG`, `PRIVATE_SLUG`, `PUBLIC_TRIP_ID = '1'`, and `body.data.name === 'Japan 2026'` with no `beforeAll`/`afterAll` creating or restoring this data. Implicit DB seed dependency. |

---

## Differentiators

Features that separate a good E2E suite from a great one. Not required for "green," but required for long-term maintainability.

| Feature | Value Proposition | Present in Repo? | Complexity |
|---------|-------------------|-----------------|------------|
| **Single shared `loginViaKcForm()` helper** | KC browser-flow changes break all 4 login-navigation implementations simultaneously; centralizing them means one fix propagates | No — duplicated in `global-setup.ts` (×2 for testuser and new_user), `session-management.spec.ts`, and `otp.spec.ts` test 4 | Low-Medium — extract + update call sites |
| **Poll/retry on async external services** | `fetchLatestOtp()` (`mailpit-helpers.ts:19-29`) does a single GET against Mailpit with no retry; SMTP delivery can lag even locally | No — single-shot fetch | Low — add a poll loop with exponential backoff until `messages.length > 0` or timeout |
| **Precise assertion locators** | `passkeys.spec.ts` uses `[role="alert"]` as a fallback for the last-credential guard — any unrelated toast (Phase 11 centralized `toast.ts`) renders this assertion vacuously true | Partial — most locators use multi-selector fallbacks for resilience, but some are too broad | Low — narrow `[role="alert"]` fallback in the delete-guard assertion |
| **Locale-correct loading-state assertions** | `public-sharing.spec.ts` asserts title `!= 'Cargando viaje…'` — Spanish placeholder removed in Phase 5; this negative assertion can never fail even when the title never loads | No — stale assertion | Low — replace with a positive locale-correct assertion |
| **Explicit skip reason on every `test.skip`** | Skipped tests with no reason become invisible tech debt; `'KC not available'` is the minimum but a linked issue reference is better | Partial — reason string present in most cases; no issue/tracking references | Low — convention, not code |

---

## "Green Suite" Definition

**Local (full stack running — KC + backend + frontend + Mailpit):**
- All 18 spec files pass or are formally skipped with a documented reason.
- 0 tests fail. Formally skipped tests must annotate a non-empty reason string.
- "Formally skipped" = `test.skip(condition, 'explicit reason string')` or `test.fixme(condition, 'reason')`, not silently excluded via `testIgnore` without documentation.
- The suite does not rely on retry-masking to pass: tests that require 2 retries to pass locally are considered failing, not green.

**CI (no KC, `SKIP_REAL_AUTH=true`, chromium-only via `--project=chromium`):**
- All tests not behind a guard pass.
- All `SKIP_REAL_AUTH`-gated tests (otp, passkeys, session-management) show as "skipped," not "failed."
- Passkeys specs do not appear in CI at all after the `testIgnore` fix — this is correct, not a gap. `chromium-passkeys` project is not selected by `--project=chromium`.
- idp-theme and public-sharing use live health-probe skips — confirm their CI behavior: do the probe URLs connection-error (spec errors, not skips) or skip cleanly? If they error rather than skip, they need to be converted to `SKIP_REAL_AUTH` guards.
- 0 retries consumed to pass.

**What is NOT required for "green" in v3.1:**
- KC running in CI. `SKIP_REAL_AUTH` exists precisely because this is deferred ("Real-auth E2E in CI" is in PROJECT.md Future list).
- Firefox/WebKit coverage of passkey flows. CDP is Chromium-only by architecture; `chromium-passkeys` project covers this locally.
- Every spec exercised in CI. KC-dependent specs are legitimately skipped and documented as such.

**Accepted skip criteria (formal deferral, not silent ignore):**
A spec qualifies as an accepted skip when:
1. It **passes locally** with the full stack running. If it also fails locally, it is not a valid skip — it is a failing test that needs a fix.
2. The blocking factor is documented: a specific Playwright/CDP constraint, a missing CI service, or an external environment unavailable in GitHub Actions.
3. The skip annotation includes the reason string (non-empty).

---

## Skip/Deferral Patterns

The anti-pattern is a silently failing or silently excluded test (commented out, `testIgnore`'d without documentation).

### Pattern 1: Environment guard (current — correct for KC-dependent tests)

```ts
// otp.spec.ts:16, passkeys.spec.ts:25, session-management.spec.ts:93
test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');
```

Use when: a live service (KC, Mailpit) is required and is confirmed absent in the target environment. The spec must pass locally.

### Pattern 2: Live health-probe guard (current — used in idp-theme, public-sharing)

```ts
// idp-theme.spec.ts:14-19
const response = await request.get(`${KEYCLOAK_URL}/realms/japan-trip`, { timeout: 5000 }).catch(() => null);
test.skip(!response?.ok(), 'Keycloak is not running locally');
```

Use when: the service availability is genuinely uncertain. Less predictable than the env-var guard in CI — a connection error causes the spec to error rather than skip if the `test.skip` call itself throws before executing. Prefer Pattern 1 for any new KC-dependent spec.

### Pattern 3: `test.fixme` for known-broken tests pending a real fix

```ts
test.fixme(true, 'OTP spec calls routes without Bearer JWT; routes are auth-gated by design (backend/src/routes/auth.ts:92). Spec must be rewritten to use an authenticated request context. Tracked in: <issue ref>');
```

Use when: a test is structurally wrong (wrong contract, stale selector, missing fixture) but the fix requires non-trivial work or a decision. `test.fixme` marks it visibly in the HTML report without hiding it. Do NOT use `test.skip` for this case — `skip` implies "will pass in the right environment," `fixme` implies "broken, fix deferred."

### Pattern 4: Describe-block-level skip for environment dependency

```ts
// session-management.spec.ts:93-95 (correct current pattern)
base.describe.configure({ mode: 'serial' }); // state isolation — must precede skip
base.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');
```

When the entire file requires a live environment, a describe-level skip is correct — all tests in the file skip together rather than requiring individual guards.

### Deferral documentation requirement

For any spec that cannot be fixed in v3.1, the deferral must appear in two places:
1. A `test.skip(condition, reason)` or `test.fixme(condition, reason)` in the spec file.
2. A corresponding entry in the milestone's REQUIREMENTS.md (or a linked GitHub issue) stating what environment change or fix would make the deferral removable.

A spec that is silently excluded (testIgnore'd without documentation, file gitignored) does not count as formally deferred — it counts as a hidden failure.

---

## Anti-Features

Things NOT to do when stabilizing this auth-heavy E2E suite.

| Anti-Feature | Why Harmful | What to Do Instead |
|--------------|-------------|-------------------|
| **Mock Keycloak away in the currently-failing specs** | Defeats the purpose of real-auth E2E coverage — these specs exist precisely to catch real KC-flow regressions. Mocking KC away makes `passkeys.spec.ts`, `otp.spec.ts`, `session-management.spec.ts` worthless | Keep real-auth specs real-auth. `SKIP_REAL_AUTH` already provides CI coverage without mocking. Fix the specs to work with the real KC contract. |
| **Add local retries to silence flaky specs** | Masks real failures as "flaky" and misleads future triage. `retries: 0` locally is intentional. | Fix the root cause. For timing issues (Mailpit SMTP lag): add poll/retry inside the helper (`fetchLatestOtp`), not at the Playwright runner level. |
| **Rewrite passing specs during stabilization** | V3.1 is stabilization. Passing specs are working correctly; touching them introduces new risk and scope creep. | Scope changes strictly to failing specs, test config, and shared helpers where the fix is directly caused by a confirmed failure. |
| **Use `test.skip` for specs that also fail locally** | A local failure is a real failure, not a skip candidate. `SKIP_REAL_AUTH` means "KC not available here" — it does not mean "this test is hard to fix." | Fix it or use `test.fixme` with a documented issue reference. |
| **`waitForTimeout()` as a stability tool** | Fixed delays mask a missing proper wait condition and slow down the suite. `passkeys.spec.ts` already has `waitForTimeout(1000)` calls that should be reviewed. | Replace with `waitFor({state: 'visible'})`, `waitForLoadState('domcontentloaded')`, `waitForURL()`, or network-request intercepts. |
| **Treat "passes in CI with SKIP_REAL_AUTH" as "the spec is green"** | CI only runs non-KC specs. A spec that passes in CI but fails locally against the real stack is still a failing spec. | Green = passes locally + skips cleanly in CI (for KC-dependent specs). Both conditions required. |
| **Silently remove a failing spec** | Deletes coverage without documenting the loss. The failing/skipped count looks healthy; the coverage gap is invisible. | Use `test.fixme` to keep it visible in reports, or open an issue and defer with `test.skip` explaining what would resolve the deferral. |
| **Duplicate KC login-navigation logic instead of extracting it** | Currently duplicated 4×; each copy drifts independently when KC browser-flow changes. Adding a 5th copy to fix one test is a net tech-debt increase. | Extract `loginViaKcForm()` into a shared fixture (`tests/e2e/fixtures/`), fix it once, call it from all sites. |

---

## Feature / Failure Dependency Map

```
global-setup.ts (kcLogin / kcLoginNewUser)
    └──produces──> .auth/user.json, .auth/session.json
                       └──required by──> passkeys.spec.ts (explicit test.use storageState, line 18)
                       └──consumed by──> chromium project default (any spec not overriding storageState)

playwright.config.ts project scoping (CURRENT GAP)
    └──missing testIgnore for passkeys.spec.ts──> runs under chromium, firefox, webkit
                                                        └──fails──> page.context().newCDPSession() (Chromium-only)
                                                              └──explains──> "passkeys ×3" stale-failure entry
    FIX: add testIgnore: ['**/passkeys.spec.ts'] to chromium/firefox/webkit projects
    RESULT after fix: passkeys runs under chromium-passkeys only; absent from CI (--project=chromium); correct

loginViaKcForm pattern (duplicated, not extracted)
    └──global-setup.ts kcLogin()            ──────────────────────────────────────────┐
    └──global-setup.ts kcLoginNewUser()     ──────────────────────────────────────────┤ all 4 fail if KC
    └──session-management.spec.ts loginViaBrowser()  ─────────────────────────────────┤ browser-flow changes
    └──otp.spec.ts test 4 (naive variant — no "Try Another Way" handling)  ────────────┘

otp.spec.ts (tests 1-3 — happy path, expiry, lockout)
    └──calls POST /api/auth/otp-request and /otp-verify via Playwright `request` fixture
                 └──routes at backend/src/routes/auth.ts:92──> authRoute.use('*', authMiddleware)
                                                                  └──requires Bearer JWT
                                                                       └──`request` fixture has no JWT
                                                                            └──routes return 401
    CONFIRMED: otp-request derives email from c.get('user').email (JWT claim, line 103)
               NOT from the request body. Sending {email, code} in body is a spec misunderstanding.
    SPEC BUG: spec models OTP as public login-fallback; route is step-up auth for authenticated users.

public-sharing.spec.ts assertions
    └──depends on──> dev DB seed state (trip id=1, specific share_slugs, is_public=true, name='Japan 2026')
                       └──no beforeAll/afterAll ownership──> structural ENV risk (stale fixture)
                       └──negative assertion on stale Spanish string──> can never catch stuck-loading (TEST BUG)
```

---

## Sources

All findings grounded in direct repository inspection (HIGH confidence):

- `tests/playwright.config.ts` — retries, trace, projects, testMatch, worker count
- `tests/global-setup.ts` — kcLogin, freshness guard, sessionStorage capture, server wait
- `tests/e2e/passkeys.spec.ts` — CDP API calls, storageState dependency
- `tests/e2e/otp.spec.ts` — serial mode, route calls without auth, Mailpit helper usage
- `tests/e2e/idp-theme.spec.ts` — live health-probe skip pattern, CSS assertions
- `tests/e2e/public-sharing.spec.ts` — hardcoded fixture values, no seed/teardown, stale Spanish assertion
- `tests/e2e/session-management.spec.ts` — loginViaBrowser helper, acknowledged KC-flow dependency
- `tests/e2e/fixtures/kc-admin.ts` — kcAdmin fixture, resetCredentials, clearOtpCodes
- `tests/e2e/fixtures/mailpit-helpers.ts` — single-shot fetchLatestOtp, no retry
- `backend/src/routes/auth.ts` — `authRoute.use('*', authMiddleware)` at line 92; `otp-request` reads email from JWT claim at line 103, not from request body
- `backend/src/validation/schemas.ts` — `OtpVerifySchema` = `{ code: string }` at lines 100-102 (no email field)
- `.github/workflows/ci.yml` — SKIP_REAL_AUTH usage, chromium-only E2E, artifact upload
- `.planning/PROJECT.md` — milestone scope, prior key decisions, deferred items
- `.planning/codebase/TESTING.md` — test framework inventory, known gaps

General Playwright ecosystem patterns (MEDIUM confidence, used to corroborate):
- CDP Chromium-only scope (well-documented Playwright/CDP architecture)
- `networkidle` fragility for SPA auth flows with background polling (community guidance)
- SMTP delivery timing in local Mailpit test setups

*Research for v3.1 E2E Stabilization milestone*
*Researched: 2026-06-16*
