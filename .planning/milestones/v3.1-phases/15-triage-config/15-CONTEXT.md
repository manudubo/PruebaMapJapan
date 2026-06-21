# Phase 15: Triage + Config — Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers:

1. **Passkeys Chromium scoping fix (SETUP-02)** — Add `testIgnore: ['**/passkeys.spec.ts']` to the `chromium`, `firefox`, and `webkit` project entries in `tests/playwright.config.ts`. This eliminates false failures caused by `page.context().newCDPSession()` being Chromium-only. The `chromium-passkeys` project already has the correct `testMatch`; no change needed there.

2. **Fresh full-suite triage run (SETUP-01)** — Run the complete E2E suite using CLI flags (`--trace retain-on-failure --retries 1`) on the post-SETUP-02 config. Produces `15-TRIAGE.md`: a per-spec failure table that supersedes the stale v3.0 failure list from research.

**Out of scope:** Any spec fixes (Phases 16–19), any `playwright.config.ts` changes beyond the `testIgnore` additions, new test infrastructure, OTP route product decisions.

</domain>

<decisions>
## Implementation Decisions

### D-01: Passkeys project scoping (SETUP-02)

- **What to change:** Add `testIgnore: ['**/passkeys.spec.ts']` to the `chromium`, `firefox`, and `webkit` project entries in `tests/playwright.config.ts`. These 3 projects currently have no `testMatch` or `testIgnore` on passkeys, so they attempt to run `passkeys.spec.ts`.
- **What not to change:** The `chromium-passkeys` entry — it already has `testMatch: ['**/passkeys.spec.ts']` and is correct.
- **Root cause:** `page.context().newCDPSession()` in `passkeys.spec.ts` is Chrome DevTools Protocol only. Firefox and WebKit do not expose CDP, so all 3 passkey tests are structurally guaranteed to fail on non-Chromium runners regardless of application correctness. This is the entire source of "passkeys ×3" in the stale failure list.
- **Commit this fix alone** before running triage — it is a prerequisite, not part of the triage output.

### D-02: Triage run configuration (SETUP-01)

- **Method:** CLI flags only — `npx playwright test --trace retain-on-failure --retries 1`. **Do not edit `playwright.config.ts`** for trace or retry settings.
- **Rationale:** Avoids a commit/revert cycle. The triage-phase config is ephemeral and should not live in source control.
- **Config values stay as-is:** `trace: 'on-first-retry'`, `retries: 0` locally, `retries: 2` in CI. These are unchanged by this phase.
- **`retries: 1` interpretation:** Diagnostic only. A test that fails on attempt 0 but passes on retry 1 is likely flaky — mark it `flaky` in 15-TRIAGE.md, not fixed. Research standing rule: "Do not silence flakiness with retries — fix the root cause."

### D-03: Failure list output (SETUP-01)

- **File:** `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md`
- **Format:** Per-spec table with columns: `Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase`
- **Failure mode categories:** `config-bug` (testIgnore/testMatch), `contract-mismatch` (spec vs. app API), `missing-fixture` (data), `env` (KC/Mailpit not running), `flaky` (retry-pass), `unknown` (needs deeper investigation)
- **Supersedes:** The stale v3.0 failure list from `.planning/research/SUMMARY.md`. Once 15-TRIAGE.md is written, it is the authoritative current failure state for the remainder of v3.1.
- **"Cleanly distinguishes pre-existing vs. newly introduced":** By applying SETUP-02 first, passkeys failures under firefox/webkit no longer appear. Any remaining failures are genuine app or spec issues, not config artifacts.

### D-04: Order of operations

1. Apply SETUP-02 (add `testIgnore` to chromium/firefox/webkit in `playwright.config.ts`) and commit.
2. Run full triage with CLI flags: `npx playwright test --trace retain-on-failure --retries 1`
3. Write `15-TRIAGE.md` from the triage output.
4. Commit `15-TRIAGE.md`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Config file to edit (SETUP-02)
- `tests/playwright.config.ts` — 4 project entries; add `testIgnore: ['**/passkeys.spec.ts']` to `chromium`, `firefox`, `webkit`; leave `chromium-passkeys` unchanged

### Passkeys spec (confirm CDP scope)
- `tests/e2e/passkeys.spec.ts:46–48` — `newCDPSession()` + `WebAuthn.enable` call that fails under non-Chromium projects; confirms why `testIgnore` is the right fix (not a `test.skip` inside the spec)

### Research (confirmed failure root causes)
- `.planning/research/SUMMARY.md` — §Confirmed Root Causes: passkeys ×3, otp tests 1–3, public-sharing; §Unconfirmed (needs live run): idp-theme, passkeys beyond scoping fix
- `.planning/research/PITFALLS.md` — WA-01 (stale CDP authenticator), WA-05 (resetCredentials misses requiredActions), OTP-02 (fetchLatestOtp race), TH-02 (invalid PKCE challenge in LOGIN_URL), TH-04 (missing KC 26 element)

### Requirements and success criteria
- `.planning/REQUIREMENTS.md` §SETUP-01, SETUP-02 — acceptance criteria
- `.planning/ROADMAP.md` §Phase 15 — 3 success criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Current playwright.config.ts project entries
```typescript
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }) } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'chromium-passkeys', use: { ...devices['Desktop Chrome'] }, testMatch: ['**/passkeys.spec.ts'] },
],
```
Fix: add `testIgnore: ['**/passkeys.spec.ts']` to the first 3 entries. The 4th is already correct.

### Passkeys spec self-heals storageState
`passkeys.spec.ts:16–18` uses inline `test.use({ storageState: path.join(__dirname, '../.auth/user.json') })` rather than relying on the project-level config. The spec manages its own auth state. No changes to the spec for SETUP-02.

### Known pre-triage failures (from static analysis — to be confirmed by live run)
These are research-confirmed root causes and should appear in 15-TRIAGE.md:
- `passkeys.spec.ts` under `firefox` and `webkit` — `config-bug`; resolved by SETUP-02 (will not appear in triage output)
- `otp.spec.ts` tests 1–3 — `contract-mismatch` (auth-gated route, spec sends unauthenticated); Phase 17
- `public-sharing.spec.ts` — `missing-fixture` (hardcoded UUIDs not in DB); Phase 16
- `idp-theme.spec.ts` — `unknown` (multiple hypotheses per research; needs live run); Phase 18 candidate
- `session-management.spec.ts` — `unknown` (fragile KC-form navigation duplicated 4×); Phase 17 candidate

</code_context>

<specifics>
## Specific Details

- **testIgnore syntax** (Playwright ^1.60.0): `testIgnore: ['**/passkeys.spec.ts']` — same glob array format as `testMatch` already used on `chromium-passkeys`
- **Triage CLI command:** `npx playwright test --trace retain-on-failure --retries 1` (run from `tests/` directory where `playwright.config.ts` lives)
- **15-TRIAGE.md table columns:** `| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |`
- **Trace output directory:** Playwright default `test-results/` — executor notes the path in 15-TRIAGE.md header, does not move or commit trace files
- **SETUP-02 commit message:** `fix(e2e): scope passkeys spec to chromium-passkeys project only`

</specifics>

<deferred>
## Deferred

- Fixing any failing spec — Phases 16–19
- OTP route auth-gating product decision — Phase 17 discuss
- Extracting shared `loginViaKcForm()` helper — Phase 17
- Moving `WebAuthn.removeVirtualAuthenticator` to `afterEach` — Phase 18 (PASS-01)
- `public-sharing.spec.ts` seed data — Phase 16
- `idp-theme.spec.ts` PKCE challenge and storageState pre-emptive fixes — Phase 18

</deferred>

---

*Phase: 15-triage-config*
*Context gathered: 2026-06-21*
