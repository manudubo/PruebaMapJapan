# Phase 19: Session + Closure — Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 19 closes out v3.1 E2E Stabilization:

1. **Verify session-management** (SESSION-01) — `session-management.spec.ts` already uses `loginViaKcForm` (wired in Phase 17). Confirm it passes with a live run.
2. **Fix outstanding config-bug failures** — Add `storageState` to firefox/webkit projects in `playwright.config.ts` so `auth.spec.ts` real-session tests pass cross-browser.
3. **Mark environment-specific specs** (DOC-01) — Two specs cannot pass in the local v3.1 environment; mark them with `test.fixme(condition, reason)`.
4. **Final full-suite run** (DOC-02) — Run the complete E2E suite after all fixes and document every outcome: green, fixed, or explicitly accepted deferral.
5. **Write 19-CLOSURE.md** — Standalone milestone close artifact with per-spec status table.

No new product features. Pure stabilization closure.

</domain>

<decisions>
## Implementation Decisions

### Session Management (SESSION-01)

- **D-01:** `session-management.spec.ts` is structurally complete — it already imports and uses `loginViaKcForm` from `tests/e2e/fixtures/kc-login-helper.ts` across all 6 tests. SESSION-01 is satisfied at the code level. Phase 19 plan item: run the spec against a live stack and record the result. If it passes, move to closure. If it fails unexpectedly, investigate before proceeding.

### Outstanding Failure Dispositions (DOC-01)

- **D-02:** `trip-edit-integration.spec.ts` [all browsers] → `test.fixme(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration')`. Keep the test; mark it so it does not count as an unexplained failure. The test describes intended behavior for an unimplemented backend integration.
- **D-03:** `auth.spec.ts` real-session tests [firefox, webkit] → **FIX** by adding `storageState: '.auth/user.json'` to the `firefox` and `webkit` project entries in `tests/playwright.config.ts`. Same line that chromium already has. This is a config-bug — one line per project, no test code changes.
- **D-04:** `new-user-trip-creation.spec.ts` [webkit only] → `test.fixme` scoped to webkit. Rationale: spec passes on chromium and firefox; webkit handles the KC redirect differently when building a fresh browser context from `new-user.json`. This is an environment constraint, not an app bug.

### Final Suite Run (DOC-02)

- **D-05:** After all fixes and fixme additions, run `npx playwright test --trace retain-on-failure --retries 1` (full suite) from the `tests/` directory. This is the authoritative final signal. Results feed directly into `19-CLOSURE.md`.
- **D-06:** Closure output lives in `19-CLOSURE.md` — standalone file with: (1) final suite summary line (X passed, Y skipped, 0 failed), (2) per-spec status table (spec | project | final status | resolution note), (3) explicit accepted deferrals list with rationale for each `test.fixme`.

### Claude's Discretion

- Exact `test.fixme` message wording beyond the rationale captured above.
- Whether `new-user-trip-creation.spec.ts` webkit fixme is placed at the `describe` block level or per-test (whichever Playwright supports cleanly for webkit-scoped skipping).
- Order of plan tasks within a single plan file.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Session management
- `tests/e2e/session-management.spec.ts` — Current spec; already uses `loginViaKcForm`. Read to confirm no remaining issues before running live.
- `tests/e2e/fixtures/kc-login-helper.ts` — Shared KC form helper; canonical template for all KC browser-flow navigation.

### Config to fix (D-03)
- `tests/playwright.config.ts` — Add `storageState: '.auth/user.json'` to `firefox` and `webkit` project entries. Chromium already has this; the three non-passkeys projects should be consistent.

### Specs to fixme (D-02, D-04)
- `tests/e2e/trip-edit-integration.spec.ts` — Add `test.fixme(true, ...)` to the top-level describe or all tests.
- `tests/e2e/new-user-trip-creation.spec.ts` — Add webkit-scoped `test.fixme`.

### Auth spec (cross-browser coverage)
- `tests/e2e/auth.spec.ts` — Real-session describe block (authenticated dashboard tests). No code changes needed here after D-03 config fix.

### Requirements and prior triage
- `.planning/REQUIREMENTS.md` — SESSION-01, DOC-01, DOC-02 (the 3 requirements this phase satisfies).
- `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md` — Authoritative Phase 15 failure list. Use as source-of-truth when writing 19-CLOSURE.md per-spec table — every failure listed there must have a documented final resolution.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/e2e/fixtures/kc-login-helper.ts` — `loginViaKcForm(page, username, password)` — already imported and used in session-management.spec.ts, otp.spec.ts, global-setup.ts.
- `tests/e2e/fixtures/kc-admin.ts` — Model for test fixture file structure; `logoutUser(username)` used in session-management beforeEach.

### Established Patterns
- `page.locator('a, button').filter({ hasText: /try another way/i })` — preferred KC DOM navigation (handles aria-hidden KC links); used in `loginViaKcForm`.
- `test.fixme(condition, reason)` — Playwright API for documented skips; required by DOC-01. `condition` can be `true` for unconditional or `!!process.env.WEBKIT` for browser-conditional.
- `playwright.config.ts` storageState pattern: `storageState: process.env.SKIP_REAL_AUTH ? undefined : '.auth/user.json'` (mirroring the chromium project's pattern).

### Integration Points
- `tests/playwright.config.ts` → firefox and webkit project entries need `storageState` added.
- `tests/e2e/trip-edit-integration.spec.ts` → top-level `test.fixme` wrapping.
- `tests/e2e/new-user-trip-creation.spec.ts` → webkit-conditional `test.fixme`.

</code_context>

<specifics>
## Specific Details

- `auth.spec.ts` config fix is one-liner per project — no test code changes needed.
- `trip-edit-integration.spec.ts` was written pre-Phase 2 for an API integration test that never got a backend implementation; the `@integration` tag and `P2-V1` label confirm this.
- The Phase 15 triage assigned session-management and auth.spec.ts firefox/webkit both to "Phase 18" in the suggested-phase column, but Phase 18 requirements only covered PASS-01/02/03. Phase 19 is the correct landing for these.
- 19-CLOSURE.md should reference the Phase 15 triage failure table and show each entry's final resolution alongside the new final-run summary.

</specifics>

<deferred>
## Deferred Ideas

- **OTP brute-force lockout**: `attackDetection.del` in `otp.spec.ts` `beforeEach` — deferred, not needed for current test isolation (serial mode handles it).
- **Per-recipient Mailpit isolation**: `GET /api/v1/search?query=to:...` in `fetchLatestOtp()` — deferred until OTP coverage expands to multiple personas.
- **Real-auth E2E in CI**: Requires KC in CI environment; `SKIP_REAL_AUTH` removal deferred to future milestone.

</deferred>

---

*Phase: 19-session-closure*
*Context gathered: 2026-07-13*
