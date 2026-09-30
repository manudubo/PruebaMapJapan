# Phase 24 — E2E summary (ARCH-07, ARCH-09)

Branch: `worktree-agent-aad2f84b4c1eef68c`. Scope: `tests/` (specs, fixtures, config), `uat-passkeys.spec.ts`, `.github/workflows/ci.yml` e2e job.

## Status

| Req | Status | Evidence |
|-----|--------|----------|
| ARCH-07 | Done (grep-verified; KC-only specs typecheck-only) | `waitForTimeout`: 32 -> 0. `test.skip(`: 32 -> 0 (converted to `test.fixme(cond, reason)` or removed). |
| ARCH-09 | Fixed locally, **not yet observed green on GitHub Actions** | CI-mode local run (`CI=true SKIP_REAL_AUTH=true`, `--project=chromium`, preview build, `retries=0`) x3: 144 passed / 41 skipped(fixme) / 0 failed each time. |

ARCH-09 is not ticked: roadmap criterion 2 requires a passing run in Actions history. Push the branch and confirm before ticking.

## ARCH-09 root cause

1. Specs mocked `**/realms/**` with a bare 200 `{}`. keycloak-js `check-sso` first loads `.../3p-cookies/step1.html` and waits `messageReceiveTimeout` (10 s) for a `postMessage` that mock never sends. `#dashboard-login-prompt` / `#trips-grid` therefore appeared after ~10.4 s (measured), past the 5-10 s assertion timeouts. Reproduced locally: 6 failures matching CI (`auth.spec.ts:33`, `trips.spec.ts:42/199`, `ui-consistency.spec.ts:74/119/149`).
2. Two specs stubbed `**/src/auth/keycloak.ts*` / `src/pages/*.ts`, which exist only under the dev server; a preview build serves hashed bundles. `ui-consistency` also fetched `src/pages/profile.ts` source over HTTP.
3. Three specs asserted "demo trips for guests"; `dashboard.ts` now shows the sign-in prompt and hides the grid for guests (spec drift).
4. CI built with `VITE_API_URL=http://localhost:8787` (no `/api`) so no request matched the `**/api/**` mocks. Fixed to `.../api`.
5. Preview was started by a backgrounded shell step (race with first test). Now Playwright `webServer` (CI only).

Fix: `fixtures/mockKeycloak.ts` answers the whole check-sso handshake instantly (logged-out, or logged-in with an unsigned fake token, incl. token exchange and the once-per-device passkey-campaign cookie); `fixtures/mockApi.ts` records calls; `fixtures/mockThirdParty.ts` serves Leaflet CSS/JS, tiles and fonts locally. Specs were rewritten to assert real behaviour, not to pass.

## ARCH-07 changes

- Sleeps replaced with web-first assertions on real readiness signals: hero visible after auth check, `body.ready`, debounced-search settle marker (`.keyboard-hint`), `#passkey-delete-overlay` (profile.ts builds it right before wiring handlers), `#landing-login-btn` visible.
- Skips: KC/backend-dependent guards -> `test.fixme(cond, reason)` (otp, new-user, passkeys, session-management, auth real-session, idp-theme, api, public-sharing). Removed as no longer applicable: "Frontend not running" (frontend is the baseURL; down must fail), TRIP-08 migration-file-exists (file exists). `geocoder.spec.ts` deleted (two `expect(true)` stubs superseded by TRIP-07 block in `trip-edit.spec.ts`).
- Vacuous tests (`expect(true)`, `typeof x`, `count >= 0`, set-then-clear sessionStorage) replaced by assertions that can fail. Suite now 185 tests on chromium (was ~103 real + stubs).

## App defects found (kept as documented `test.fixme`; fixes are outside e2e scope)

1. **CSP blocks the API** — `frontend/vite.config.ts` `cspPlugin()` puts Keycloak but not `VITE_API_URL` in `connect-src`; a browser enforcing it cannot fetch trips (also affects prod builds). Proved failing in `csp.spec.ts` (fixme). Other specs use `bypassCSP` for this reason. **Highest priority.**
2. **Double-click "Create trip" creates two trips** — `dashboard.ts handleCreateTrip` awaits a dynamic import before disabling the button (`trips.spec.ts`, fixme).
3. **Activity reorder does not visibly reorder** — `activities.ts handleReorder` swaps array order but render re-sorts by unchanged `order_index`; POST body is correct (`trip-edit.spec.ts`, fixme).
4. **Search never says "No results"** — `search.ts calculateScore` adds a per-type boost to every item so nonsense queries return 8 results (`search.spec.ts`, fixme).
5. 7 of 8 static city pages lack `#map[aria-label]` (only tokyo.html has it) (`city-pages.spec.ts`, fixme x7).
6. No `start_date <= end_date` validation in create-trip form (BIZ-06, Phase 25; fixme).
7. Minor: a pending debounced search can re-open the dropdown after click-outside within 150 ms.

## Not run (could not execute here)

No Keycloak/backend/DB in sandbox, Firefox/WebKit not installed (CI only runs chromium). Not executed: `passkeys.spec.ts`, `session-management.spec.ts`, `otp.spec.ts`, `new-user-trip-creation.spec.ts`, `idp-theme.spec.ts`, `api.spec.ts`, `public-sharing.spec.ts`, `auth.spec.ts` "real session", `trip-edit-integration.spec.ts` (already `fixme(true)`), `uat-passkeys.spec.ts` (outside testDir). These typecheck only; their sleep replacements (`passkeys.spec.ts`, `uat-passkeys.spec.ts`) are unverified at runtime. `pwa.spec.ts` ran and passes unchanged. `api.spec.ts` still has a vacuous `expect([404, 500]).toContain(status)` (tracked with ARCH-06/TQ-01; not touched, needs a live backend to tighten safely).

## Repro

```bash
npm ci && (cd tests && npm ci)
VITE_API_URL=http://localhost:8787/api VITE_KEYCLOAK_URL=http://localhost:8080 \
  VITE_KEYCLOAK_REALM=japan-trip VITE_KEYCLOAK_CLIENT_ID=japan-trip-frontend npm run build:frontend
cd tests && CI=true SKIP_REAL_AUTH=true npx playwright test --project=chromium --retries=0
```
