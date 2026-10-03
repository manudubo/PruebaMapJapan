# Phase 23 QA follow-up: open visual findings 1-4 (+ coordinator items)

Source: `.planning/qa/QA-FRONTEND-REPORT.md` items 7-10 (visual findings 1-4).
Worktree branch `worktree-agent-adc1d5293f94607e0`, based on `claude/focused-lovelace-cryssy` (fe3ea75) and then merged
with its newer head (752fd6e). Not pushed.

## Finding -> fix -> tests

| # | Finding | Fix | Tests |
|---|---|---|---|
| 1 | Dark landing: countdown cards stay white | Audited every `var(--x)` in main.css, all 13 pages and all components. Undefined: `--bg-primary/secondary`, `--text-secondary/tertiary`, `--accent(-hover/-subtle)`, `--border-color/strong`, `--radius` (index, dashboard, trip, profile, trip-edit). All mapped to `--jp-*` tokens; dark-mode hardcoded overrides removed (one, the `#6e6e73` countdown label, would fail AA on a dark card). New `--jp-accent-solid(-hover)` pair for filled accents behind white text (`.btn-primary`, landing CTA, active trip tab, navbar Sign in); light hover `#0077ed` (4.3:1) -> `#0066cc`. | `css-tokens.test.ts` (fails on any undefined var anywhere; AA contrast of token pairs, light + dark). e2e: dark countdown/chip luminance. axe gate: 0 violations, 7 pages x light/dark. |
| 2 | Floating search button covers content on phones | Below 1320 px the search is an in-flow toolbar strip under the navbar (inline-end aligned); only >= 1320 px (real gutter beside the 1200 px container) keeps the fixed button, with a safe-area inset. Logical properties for RTL; container 46 px so the input stays 44x44. Box styles moved off `:host` (the page's `*` reset zeroed `:host` padding). | `searchbar-layout.test.ts` (CSS contract). e2e: 5 pages x 240/320/375/844x390/1280/1440, scrolled top/middle/bottom, no element under the button, target >= 44, no horizontal overflow; RTL; expanded field at 240/375. |
| 3 | Landing "Loading..." ~10 s with Keycloak down | `initKeycloak()` bounded to 4 s (`AUTH_INIT_TIMEOUT_MS`) with a status + listeners; late answers update all pages/navbar without a second init; `retryAuth()` on a fresh instance (keycloak-js inits once; its silent-SSO iframe has no timeout), first attempt to answer wins, rapid retries share one attempt; offline skips the wait and retries on `online`. Landing hero is static and never hidden; the check runs in `src/pages/landing.ts` and only adds a dismissible, non-blocking notice with Retry. | `auth-init.test.ts` (mocked keycloak-js: timeout, late success/anonymous, 500-style rejection, offline + flapping, init-once, concurrent callers, rapid/slow retries, token expiry with failing refresh). `auth-status-ui.test.ts` (notice, landing, i18n). e2e: abort / black-hole / 500 HTML, slow-then-anonymous, slow-then-session redirect, offline, dismiss, Retry recovery. |
| 4 | Dashboard empty when unauthenticated and Keycloak down | Shared `src/auth/authStatusUI.ts`: bounded "Checking sign-in..." status, then a full state (`<h1>`, `role=alert`, Retry, link home, `role=status` retry feedback, `lang`), distinct from the "please sign in" prompt. Page content is hidden, not removed, so a late success/Retry restores it and loads data once. Applied to dashboard, trip.html?tripId (was "no access") and profile (was a redirect to the landing). trip-edit (Phase 25) untouched: still redirects to the dashboard, which now explains the outage. Strings in English and Spanish (browser language). | `dashboard-auth.test.ts` (real dashboard: bounded pending, error vs prompt, Retry -> prompt, late success loads trips once, rapid retries). e2e: dashboard/trip/profile error state (h1, alert, Retry 44 px, single visible h1, no redirect), Retry -> prompt, rapid Retry with black-holed KC, down/still-down/up flapping, offline wording + auto-recover, Spanish. |
| + | Double-click "Create trip" creates two trips | Synchronous guard on first submit, locked while navigating, unlocked only on failure. | `dashboard-create-trip.test.ts` (2 of 3 fail without the guard). e2e with fake IdP + API: double click and Enter x4 -> one POST. |
| + | OTP requests used `fetch('/api/auth/...')` (Pages origin in production) | `apiUrl()` in the API client; dashboard builds both OTP URLs from it. | `otp-api-url.test.ts` (verify URL = `<VITE_API_URL>/auth/otp-verify`; no root-relative `/api` fetch in `src/`). |

Also: navbar Sign in used `--jp-accent` in dark (3.6:1, axe serious on every page once visible) -> `--jp-accent-solid`.
`scripts/a11y-axe.mjs` now waits `AXE_SETTLE_MS` (5 s) so it audits the settled auth state, and covers `trip.html?tripId=1`.

## Test harness notes
- `tests/e2e/qa-followup.spec.ts` (`@qa-noauth`, 53 tests) includes a small fake IdP (3p-cookie iframe, `prompt=none`
  authorize redirect, token endpoint; modes abort / hang / 500 / slow / anonymous / authenticated, switchable mid-test)
  and a fake API, so signed-in paths run without Keycloak. They run under the real CSP (after the merge it lists the
  API and Keycloak origins), which also proves the bounded timeout works with frame-src/connect-src enforced.
- Black-holed iframes hold the window `load` event: those specs use `waitUntil: 'domcontentloaded'`.
- Token expiry uses `page.clock` (fast-forward 3 min) with a failing refresh: ends in an interactive login, no page errors.

## Verification (after merging 752fd6e)
- `npm run typecheck --workspace=frontend` clean; `npm run test:run --workspace=frontend` 887/887 (also with
  `TZ=America/Argentina/Buenos_Aires`); `npm run build --workspace=frontend` OK.
- Playwright (preinstalled Chromium, temporary local config on a preview at :4180, not committed):
  `qa-followup`, `qa-frontend`, `qa-sw`, `search` with `--grep @qa-noauth`: 93 passed; auth specs 3x repeat: 60/60.
- axe (wcag2a/aa/21aa): 0 violations on 7 pages, light and dark. Screenshots (light/dark x 375/1280) of landing,
  dashboard, tokyo reviewed by eye.

## Open / notes
- `src/auth/AuthGuard.ts` is unused; its Retry still calls `initKeycloak()` (returns the cached answer). Delete or
  switch to `retryAuth()` if it is ever used.
- With Keycloak reachable but slower than 4 s, users briefly see the notice / error state before the late answer
  replaces it (by design: bounded UI, late success honoured).
- Spanish strings are only used for this auth UI (the rest of the app is English); `lang` is set on the block.
- Landing body still waits for `document.fonts.ready`/`load` before `opacity: 1` (pre-existing; affects LCP).
