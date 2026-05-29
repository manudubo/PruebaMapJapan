# Phase 9: Playwright Real Auth — Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

New Playwright test infrastructure on top of existing `tests/` workspace:
- Replace the stub `globalSetup.ts` with real OIDC login via headless Chromium → writes `tests/.auth/user.json` via `storageState`
- KC Admin API fixture helper (`tests/fixtures/kc-admin.ts`) for per-test state reset
- New `chromium-passkeys` Playwright project using CDP Virtual Authenticator for passkey register/login/delete tests
- OTP fallback E2E tests (serial) via Mailpit REST API for request → verify → expired → max-attempts flows
- Migrate select mock-based auth tests to real-auth equivalents

No backend changes. No frontend changes. No production Terraform. CI keeps running mocked tests — real-auth tests are local-only for this phase.

</domain>

<decisions>
## Implementation Decisions

### Test user strategy (E2E-01)

- **D-01:** `globalSetup.ts` logs in as a pre-seeded fixed test user (`e2e-test@local`) using OIDC PKCE via headless Chromium. Credentials stored as `E2E_TEST_USERNAME` and `E2E_TEST_PASSWORD` env vars in `tests/.env.test` (gitignored, `.env.test.example` committed). This user is pre-created in KC once (manual KC console or Terraform) and never deleted by the test suite.
- **D-02:** Stable password — no per-run credential rotation. `globalSetup` checks if `tests/.auth/user.json` exists and is unexpired before attempting re-login (reuse storageState when possible). The file is gitignored.
- **D-03:** `globalSetup` checks `process.env.SKIP_REAL_AUTH` first. If set (CI uses `SKIP_REAL_AUTH=true`), skip KC login entirely — no storageState is written. Real-auth test files guard themselves with `test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment')`.

### KC Admin fixtures (E2E-02)

- **D-04:** `tests/fixtures/kc-admin.ts` exports a `kcAdmin` Playwright fixture (and plain helper functions) that calls the KC Admin API using client credentials grant against the `japan-trip-worker` service account (already configured in Phase 7, D-01 to D-03). Credentials: `KC_ADMIN_CLIENT_ID` and `KC_ADMIN_CLIENT_SECRET` from `tests/.env.test`.
- **D-05:** Fixture provides: `createUser()`, `deleteUser()`, `resetCredentials()`, `clearOtpCodes()` (via direct DB query or KC Admin). `clearOtpCodes` clears the `email_otp_codes` table rows for the test user before OTP tests run.

### Existing mock tests migration (E2E-01)

- **D-06:** Claude decides which auth.spec.ts tests to migrate to real-auth. The criterion: tests that assert authenticated UI behavior (trips grid visible after login, user info shown) benefit from a real session. Tests that assert unauthenticated behavior (login prompt visible, redirect to KC URL) do NOT need a real session and can stay mocked. Keep the same file (`auth.spec.ts`) — no separate project.
- **D-07:** No tagging (`@mocked`, `@real-auth`) on test cases. Mix is implicit. Developers understand that real-auth tests require KC running locally.

### CI strategy (E2E-01)

- **D-08:** Real-auth tests are local-only for Phase 9. GitHub Actions CI workflow sets `SKIP_REAL_AUTH: true` in the `env:` block for the Playwright test step. CI continues running the existing mocked tests (no KC service container in GHA for this phase).
- **D-09:** `tests/.auth/user.json` and `tests/.env.test` are gitignored. A `tests/.env.test.example` file is committed with placeholder values documenting the required env vars.

### Chromium-passkeys project (E2E-03)

- **D-10:** Add a `chromium-passkeys` Playwright project in `playwright.config.ts`. This project runs only passkey-specific spec files (e.g., `tests/e2e/passkeys.spec.ts`). It uses CDP `session.send('WebAuthn.enable', { enableUI: false })` + `session.send('WebAuthn.addVirtualAuthenticator', ...)` to register a software passkey without physical hardware.
- **D-11:** Passkey tests require a clean-credential test user at the start. The `kc-admin` fixture `resetCredentials()` removes all passkeys for `e2e-test@local` in `beforeEach`. Tests: register passkey, login with passkey, delete passkey (last-credential guard).

### OTP test strategy (E2E-04)

- **D-12:** OTP tests (`tests/e2e/otp.spec.ts`) use `test.describe.configure({ mode: 'serial' })` to prevent parallel Mailpit inbox interference. The `chromium-passkeys` project also implicitly serializes OTP tests if they share the same Playwright worker.
- **D-13:** A dedicated `otp-test@local` user is pre-seeded in KC for OTP tests. This user has: a verified email address (`otp-test@local`), no passkeys registered, and a password set. Separate from `e2e-test@local` to avoid session state pollution. Its credentials live in `tests/.env.test` as `E2E_OTP_USERNAME` / `E2E_OTP_PASSWORD`.
- **D-14:** OTP email fetch: `GET http://localhost:8025/api/v1/messages` returns all Mailpit messages. OTP tests call `DELETE /api/v1/messages` (purge) before triggering OTP request, then fetch and parse the latest message. Serial execution guarantees no interference from other tests.
- **D-15:** Mailpit REST base URL: `MAILPIT_URL` env var in `tests/.env.test`, default `http://localhost:8025`.

### sessionStorage replay (E2E-01)

- **D-16:** Playwright bug #31108 — keycloak-js stores tokens in sessionStorage, which is not captured by `storageState` (only localStorage and cookies are). Workaround: after login in `globalSetup`, capture sessionStorage via `page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)))`, store alongside `user.json`. In each test that needs auth, inject via `context.addInitScript(({ entries }) => { entries.forEach(([k, v]) => sessionStorage.setItem(k, v)); }, { entries })`.
- **D-17:** The `addInitScript` approach injects session before first navigation. Tests that use `storageState` + `addInitScript` must call `page.goto()` AFTER the script is registered (which is the default Playwright flow — `addInitScript` runs before any navigation).

### Claude's Discretion

- How to determine if storageState is expired vs valid before attempting re-login (file age check or KC token introspection)
- Exact CDP VirtualAuthenticator `options` parameters for passkey tests (protocol, transport, haUserVerification, hasResidentKey)
- Whether to also delete `otp-test@local` OTP codes via KC Admin API or via direct DB query in `clearOtpCodes()` fixture
- Exact structure of `tests/.env.test.example` — document all required vars
- Whether `chromium-passkeys` project is added to the main `playwright.config.ts` or gets its own config file

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and goals
- `.planning/REQUIREMENTS.md` §E2E-01, E2E-02, E2E-03, E2E-04 — full requirement definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 9 — 4 success criteria that define done

### Existing Playwright infrastructure
- `tests/playwright.config.ts` — base config to extend (add chromium-passkeys project, storageState)
- `tests/global-setup.ts` — existing server-wait setup to extend with KC OIDC login
- `tests/e2e/idp-theme.spec.ts` — KC-availability check pattern + `test.skip(!response?.ok())` example
- `tests/e2e/auth.spec.ts` — mock-based auth tests, partially to be migrated to real-auth

### Prior phase context (KC Admin, OTP, passkeys)
- `.planning/phases/07-passkey-login-wire-browser-passkey-keycloak-flow-as-default-/07-CONTEXT.md` — D-01 to D-03: `japan-trip-worker` KC client, `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` env vars, Admin API base URL pattern
- `.planning/phases/08-demo-trip-seed-a-public-demo-trip-in-the-database-add-view-d/08-CONTEXT.md` — OTP endpoint shapes (D-01 to D-09), passkey campaign (D-10 to D-15), last-credential guard (D-16 to D-19), UPDATE_PASSWORD gate (D-20 to D-21)

### Backend source (for kc-admin fixture implementation)
- `backend/src/types/index.ts` — `Env` interface with `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET`, `KEYCLOAK_URL`, `KEYCLOAK_REALM` binding names
- `backend/src/db/schema.ts` — `emailOtpCodes` table definition (for direct DB-based clearOtpCodes if KC Admin doesn't expose OTP code deletion)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- `tests/global-setup.ts:waitForServer()` — existing server health-check helper; can be reused/extended in the new OIDC login flow
- `tests/e2e/idp-theme.spec.ts` lines 15-19 — `test.skip(!response?.ok(), 'Keycloak is not running locally')` — the exact pattern for KC-optional test skipping, adapt to use `SKIP_REAL_AUTH` env var
- `tests/e2e/auth.spec.ts` — `page.route('**/realms/**')` mock pattern; keep for unauthenticated-scenario tests that remain mocked

### Established patterns
- `tests/` is a standalone npm workspace — add new deps there with `npm install --prefix tests`
- `tests/playwright.config.ts` uses `globalSetup: './global-setup.ts'` — extend the same file
- `workers: 2` in playwright.config.ts — OTP tests opt out via `test.describe.configure({ mode: 'serial' })`
- `tests/e2e/fixtures/mockTrip.ts` — existing fixture pattern; `kc-admin.ts` follows the same export convention

### Integration points
- `tests/.auth/` directory: create via `globalSetup`, gitignore via `.gitignore` addition
- `playwright.config.ts`: add `chromium-passkeys` project entry + `storageState` to `use:` for the `chromium` project
- GitHub Actions workflow: add `SKIP_REAL_AUTH: true` to `env:` in the Playwright test step

</code_context>

<specifics>
## Specific Ideas

- sessionStorage workaround for Playwright bug #31108: `page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)))` to capture, then `context.addInitScript()` to replay — explicitly required in E2E-01
- CDP Virtual Authenticator: `Page.CDPSession` → `session.send('WebAuthn.enable', { enableUI: false })` → `session.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', haUserVerification: true, hasResidentKey: true } })`
- Mailpit purge before OTP test: `DELETE http://localhost:8025/api/v1/messages` — clears all messages, safe because OTP tests run serially
- Two pre-seeded KC test users required: `e2e-test@local` (primary, for general auth + passkeys) and `otp-test@local` (OTP-only, must have no passkeys to trigger the OTP banner path)
- `tests/.env.test.example` vars: `E2E_TEST_USERNAME`, `E2E_TEST_PASSWORD`, `E2E_OTP_USERNAME`, `E2E_OTP_PASSWORD`, `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET`, `MAILPIT_URL`, `KEYCLOAK_URL`, `BACKEND_URL`, `FRONTEND_URL`

</specifics>

<deferred>
## Deferred Ideas

- KC as a GitHub Actions service container — explicitly deferred to a future phase; CI stays with mocked tests for now
- OTP test per-recipient email filtering (parallel-safe approach) — deferred; serial is sufficient for now
- `test.describe.configure({ mode: 'serial' })` at the config level for the entire OTP suite — deferred; in-file serial config is sufficient

</deferred>

---

*Phase: 09-playwright-real-auth*
*Context gathered: 2026-05-26*
