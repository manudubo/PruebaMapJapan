# Registration UI report

Branch `worktree-agent-a138a71f6b9da07ac` (base `origin/main` d2dd404 + the previous agent's four commits). Frontend only; nothing under `terraform/`, `keycloak/`, `deploy/` or `backend/src` was touched by this pass.

## What was built

| Deliverable | Where |
|---|---|
| "Sign up" + "Sign in" pair everywhere, hidden in demo-only builds | previous agent (navbar, landing, dashboard prompt, signed-out trip view); verified: sign-up goes to `/protocol/openid-connect/registrations` with a registered `redirect_uri` and no query string, also from `trip.html?tripId=1`; a build with no `VITE_KEYCLOAK_URL` emits every `data-signup` element `hidden` |
| Email OTP verification screen | `src/auth/verifyEmail.ts`, `src/modules/codeInput.ts`, `src/modules/cooldown.ts`, `src/api/authFlows.ts` |
| New-user passkey onboarding (+ backup-password variant) | `src/modules/passkeyCampaign.ts` (extended; the existing-user nudge `checkPasskeyCampaign` is unchanged), wired in `src/pages/dashboard.ts` |
| `recover.html` | `recover.html`, `src/pages/recover.ts` (bootstrap), `src/pages/recoverView.ts` (state machine), `src/auth/passwordRules.ts`; Vite entry added |
| Profile "Add a password as a backup" | `src/modules/passwordBackup.ts`, wired in `src/pages/profile.ts` |
| Keycloak-down / 403 states through the shared auth-status module | `watchAuth()` (`src/auth/authStatusUI.ts`) installs the `403 email_not_verified` gate once signed in, so dashboard, trip, trip editor and profile are all covered; Keycloak-unavailable keeps using the existing full-page state |

## Behavior decisions worth reviewing

- **Verify screen** is a full-page state (same pattern as "can't reach sign-in"), not a modal: the account cannot use the app until verified. It auto-requests a code on show unless a cooldown is already running (reload, second tab). Resend cooldown is in `localStorage` (try/catch, memory fallback) and shared by tabs; a verified signal in `localStorage` clears the screen in the other tab. After success the token is force-refreshed.
- **Dashboard order**: `GET /users/me` first. `email_verified === false` shows the screen and continues; a `403 email_not_verified` is left to the gate (screen, then reload) so there is one screen and one reload. `onboarding.is_new` -> onboarding dialog; otherwise the old behavior (passkey redirect nudge on capable devices, OTP banner otherwise). If `/users/me` fails for another reason the old behavior applies.
- **Onboarding dialog**: shown only if `PublicKeyCredential` exists and `isUserVerifyingPlatformAuthenticatorAvailable()` resolves true (guarded; a throw is "unsupported"); never when the Keycloak account API says the user already has a passkey (`webauthn-passwordless`), and quiet when that call fails. Throttle: recorded when shown; "Not now" = 7 days, at most 3 shows, "Don't ask again" = never. State is in `preferences.passkeyCampaign` (PATCH `/users/me`, existing preferences preserved) plus a `localStorage` copy; the more restrictive copy wins. Dialog: `role=dialog`, `aria-modal`, labelled/described, focus on the primary action, Tab trap, Escape = Not now, focus returned, rest of the page `inert`, fade only under `prefers-reduced-motion: no-preference`. Unsupported device (and no password yet): same dialog with "Set a password as a backup" -> Keycloak `UPDATE_PASSWORD`; new users on such devices get this instead of the OTP banner.
- **recover.html**: anti-enumeration by construction (any 2xx or 404 from the request endpoint -> the same "If an account exists for X, we sent a code" screen; wrong, expired, locked and unknown-account confirm answers share one message). Code and password only in request bodies; `?email=` is read once, validated, and removed from the address bar; page has `noindex` and `no-referrer`. 429 on request and on confirm each have a persisted countdown (`recovery.request`, `recovery.confirm`). Password rules (12+ characters counted as code points, not the email, confirmation matches) in an `aria-live=polite` list with words ("met"/"not met") besides the icon. Not precached by the service worker (needs the network). Linked from the dashboard sign-in prompt (hidden in demo-only builds).
- **Profile card**: only when the account has a passkey and no password, same throttle under `preferences.passwordBackupCampaign`.

## Backend contract assumed (not yet confirmed: `.planning/qa/REGISTRATION-BACKEND-REPORT.md` had not landed)

`src/api/authFlows.ts` is defensive and is the one place to adapt:
- `GET /users/me`: `email_verified` (absent = verified), `onboarding.is_new`.
- Any call may answer `403 {code:'email_not_verified'}` (matched on `code` only).
- `POST /auth/email-verify/request` 2xx or 429 (`retryAfter` in body or `Retry-After`); `/confirm {code}` 2xx, 400 `invalid_code` (`attemptsLeft` / `attemptsRemaining` / `attempts_*`), 400/410 expired (`*expired*`, `otp_not_found`, 410), `max_attempts`, `already_verified` (treated as success), 429.
- `POST /auth/recovery/request {email}` 2xx always (404 tolerated as success); `/confirm {email, code, new_password}` 2xx, 400 `invalid_code`, 422 `weak_password` (reasons are not shown), 429, 503.
Error classification is `classifyCodeProblem()`; paths are in the four exported functions.

## Tests

Vitest (jsdom), all new: `cooldown`, `code-input`, `auth-flows`, `verify-email` (26), `client-email-not-verified`, `passkey-onboarding` (34: prefs parsing/merge/throttle, store with API/storage failures, support detection, credential count, orchestration rules, dialog a11y and trap), `dashboard-onboarding` (7), `password-backup`, `password-rules`, `recover-view` (29), `recover-page` (shell, Vite entry, SW, gating), `auth-gate`. Existing dashboard mocks were extended for the new imports.

Playwright `@qa-noauth` (fake Keycloak/API; new fixtures `mockAuthFlows.ts`, extended `mockApi.ts` with `me` and `verification`): `registration-ui.spec.ts` (34) and `registration-ui-a11y.spec.ts` (24: axe `wcag2a/2aa/21aa/22aa`, 0 violations, 6 states x light/dark x 375/1280, plus no horizontal overflow). Covered: sign-up redirect without query; verify happy path (403 and flag variants), paste with spaces/dashes, wrong code (attempts left), expired, 429, resend cooldown visible/persisted across reload/ends, double submit, two tabs, sign out; onboarding only when supported (init script removes `PublicKeyCredential`; also a platform check answering "no"), persistence (PATCH body and local copy surviving an API that forgets), never with an existing passkey, not for existing users; profile card; recover happy path, anti-enumeration (identical text for two addresses), wrong code vs unknown account, unmet password not sent, 429 countdown across reload. The suite was run 3x for flakiness (102/102).

Screenshots (all looked at, 24 PNG): `.planning/qa/visual-registration/{verify-email,onboarding-passkey,onboarding-password,recover-email,recover-code,recover-done}-{light,dark}-{375,1280}.png`. Defects seen and fixed from them: recovery card text flush against the card edge (padding added), card touching the navbar.

## Checks run

- `tsc --noEmit` frontend and backend: clean.
- `vitest run` frontend: 68 files / 1468 tests green, also with `TZ=America/Argentina/Buenos_Aires`; includes `e2e-hygiene` (no sleeps/skips; the axe spec uses `test.fixme(!AXE, reason)`).
- `CSP_ALLOW_MISSING_ORIGINS=true npm run build`: OK (Sign up and the recovery link emitted `hidden`).
- Playwright against a `vite preview` of a build with `VITE_API_URL` and `VITE_KEYCLOAK_URL` set, Chromium from `/opt/pw-browsers` via an untracked temp config: the two new specs plus the existing `@qa-noauth` specs (`auth-return-to`, `qa-frontend`, `ui-consistency`, `session-management`, `new-user-trip-creation`, `csp`) 96/96.
- axe-core is not a dependency of `tests/`: the spec reads `require.resolve('axe-core/axe.min.js')` or `AXE_CORE_PATH` (CI already installs it with `npm i --no-save axe-core`).

## Not covered / follow-ups

- No real Keycloak or backend: the registration flow in the realm, the login-theme link to `recover.html` and the backend endpoints are the other agents' work; adapt `authFlows.ts` to their report. Real `kc_action` UPDATE_PASSWORD / webauthn registration completion is only asserted up to the redirect.
- After a 403-driven verification the page reloads, so the "Email verified" toast is not seen on the dashboard (it is on the flag-driven path).
- The Keycloak account API is used to count credentials (same call as the profile page); if its CORS or role setup differs in a deployment, onboarding stays silent by design.
- The existing OTP banner and `otp-request/otp-verify` endpoints are untouched for existing users on non-WebAuthn devices.
- `Don't ask again` has no "undo" UI; the profile page's Add passkey / Change password remain the manual route.
