# Self-registration: passkey sign-up, e-mail code gate, e-mail recovery

## Summary

Anyone can create an account. Sign-up is passkey-first (no password), the
e-mail must be proven with a 6-digit code before the API opens, and a user
whose device cannot use the passkey recovers by e-mail code and sets a
password. Registration stays closed in production until the owner opens it.

Base `main` @ `d2dd404` (PR #24, merged). 53 commits, one day, four tracks
(IdP, backend, UI, integration). Requirements REG-01..07 in
`.planning/REQUIREMENTS.md`; commits and tests in
`.planning/phases/TRACEABILITY.md`.

## What changed

- **Keycloak** (`terraform/keycloak/`): flow `registration-passkey` (form without
  password, passkey required action), `travelmap-recovery` client (only
  `manage-users`, scope-mapped), "Try another way" fix for users with both
  credentials, optional reCAPTCHA, 9 new production plan guards, theme link
  to `recover.html`.
- **Backend**: migration 0011 (`users.email_verified_at`, OTP `purpose`),
  `POST /api/auth/email-verify/request|confirm`, `403 email_not_verified`
  on every other authenticated route (`REQUIRE_VERIFIED_EMAIL`, default on
  outside development), `POST /api/auth/recovery/request|confirm`
  (same 202 for unknown addresses).
- **Frontend**: Sign up next to Sign in (hidden in demo-only builds),
  verification screen, new-user passkey dialog, `recover.html`, "Add a
  password as a backup" card on the profile page.
- **Ops**: `purge-unverified` systemd timer, `REGISTRATION_ENABLED` and
  captcha keys in the self-host kit, `contracts/auth-flows.json` shared by
  both sides, real-stack e2e in `keycloak-flow.yml`.

## Verification (the reports' figures, not re-run for the docs)

- Backend 70 files / 2161 tests x3 on Postgres 16; frontend 69 files / 1488.
- `terraform test` 23/23; `purge-unverified.test.sh` 34/34; `scripts.test.sh` 57/57.
- Real stack (Keycloak 26.6.1, backend, Postgres, Mailpit, built frontend,
  Chromium virtual authenticator): `idp-registration` 9/9 and
  `registration-integration` 7/7.
- Self-host `stack-e2e.sh` 67/67 incl. `register verify recover`.
- Mocked UI Playwright 96/96; axe 0 violations (6 states x light/dark x 2 widths).
- Integration found and fixed 4 bugs, among them: the recovery token had no roles (every
  recovery answered 503), `max_attempts` was shown as a wait, the dev server
  dropped env variables, and a recovery e2e assumption.

Reports: `.planning/qa/REGISTRATION-{IDP,BACKEND,UI,INTEGRATION}-REPORT.md`.

## Risks

- **No per-IP sign-up throttle.** Stock Caddy has no rate-limit module and
  Keycloak has none for registration. A bot with a WebAuthn emulator can
  create accounts. Mitigation: purge of never-verified accounts, optional
  reCAPTCHA, keep sign-up closed.
- **Recovery client** holds `manage-users`; its secret (server `.env`) can
  reset any password.
- Recovery needs a `users` row (created by the first authenticated call).
- Migration 0011 stamps all existing users as verified; check before enabling.
- A sign-up that never finishes passkey enrolment stays credential-less and
  unverified (rejected at sign-in, purged by the timer).
- Gmail allows about 500 mails a day; every sign-up and recovery costs one.
- Keycloak shows the preferred credential first (enrolment order).

## Not validated

- The extended `keycloak-flow.yml` on GitHub Actions (REG-07).
- Real Funnel, Gmail and passkeys on the `.ts.net` rpId (REG-01).
- reCAPTCHA with real keys; Firefox and WebKit.
- The registration UI in a browser against the self-host stack.
- Expired code and double click against the real stack (mocked/backend only).

Status: 88 Complete, 4 Partial (REG-06 among them), 3 Unverified (REG-01,
REG-07, QA-01).

## Owner actions

1. Keep `REGISTRATION_ENABLED` false until the items below are done.
2. Run `keycloak-apply.sh` (writes `KEYCLOAK_RECOVERY_CLIENT_SECRET`), redeploy
   the backend, then `stack-e2e.sh register verify recover` on the real host.
3. Enable `purge-timer.sh`; decide on reCAPTCHA keys.
4. Consider a Caddy/WAF limit on the registration endpoint.
5. Open a PR and read the `Keycloak flow` run; record it against REG-07.
6. Never paste secrets into chat, issues or logs.
