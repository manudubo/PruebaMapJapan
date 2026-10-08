# Self-registration, integration and end-to-end proof

Base: `607b4b3` (merge of the IdP, backend and frontend tracks). Worktree branch, nothing pushed.

## Bugs found by running the real stack (all fixed, each with a test)

| # | Bug | Found by | Fix |
|---|---|---|---|
| 1 | `travelmap-recovery` token carried **no roles** (`full_scope_allowed=false` and no scope mapping), so every Admin API call was 403 and `POST /api/auth/recovery/confirm` answered 503 for everyone. Recovery could never have worked in production. | Backend against the real realm | `keycloak_generic_role_mapper` + `keycloak_role` data source in `terraform/keycloak/main.tf`; static check in `idp-config.spec.ts`; live check (token has `realm-management: [manage-users]`, user lookup 200) in `idp-registration.spec.ts` |
| 2 | Burned code (5 wrong guesses) answers **429 `max_attempts`**; `classifyCodeProblem()` ran the 429 check first, so the user saw "wait N seconds" instead of "request a new code". | New shared contract test | `frontend/src/api/authFlows.ts` classifies `max_attempts` first |
| 3 | `backend/src/dev.ts` forwarded a fixed handful of variables: `REQUIRE_VERIFIED_EMAIL`, `SMTP_*`, `EMAIL_*`, `KEYCLOAK_RECOVERY_*` never reached the app, so the flows could not run on the dev server. | Starting the dev server | forwards all of `SERVER_ENV_CONTRACT` |
| 4 | The fixme'd recovery e2e assumed a Keycloak-only sign-up could recover. Recovery needs a `users` row (created by the first authenticated call, which the app makes on the redirect landing). A verified owner keeps the passkey, an unverified one loses it by design (squatting defence). | e2e | Test now provisions the row like the app, verifies first for the "keeps passkey" case, and a separate squatting test asserts the opposite. Documented, not a product change. |

## Contract reconciliation (task 1)

`contracts/auth-flows.json` is the single wire contract (14 cases: status, body subset, headers, and what the frontend must derive). `backend/src/routes/auth-flows-contract.test.ts` makes the **real routes** produce every case (real Postgres; 201/200/429 `otp_pending`/400 `invalid_code`/400 `otp_not_found`/429 `max_attempts`/403 `email_not_verified` gate/202 generic/429 `rate_limited` with `Retry-After`/422 `weak_password` with `reason`/503 `service_unavailable`/422 `recovery_unavailable`). `frontend/tests/auth-flows-contract.test.ts` feeds the same file to `authPost` + `classifyCodeProblem`. Changing either side alone fails CI.

Mismatches, all on the frontend side except where noted: only bug 2 was a real mismatch. Others were confirmed compatible: the field is `retryAfter` (and `Retry-After`), `code ?? error` picks `service_unavailable`/`email_not_verified` correctly, `attemptsLeft` is **never sent** by the backend (UI falls back to the generic wrong-code text; kept, harmless), 202 body is `{success:true,message}`, envelope `{success,data}` for 200s. `weak_password.reason` is not shown by the UI (only "doesn't meet the requirements"); not changed.

## Flows (real Keycloak 26.6.1, backend dev server, Postgres 16, Mailpit; Chromium with CDP virtual authenticator)

| Flow | Result | Evidence |
|---|---|---|
| Sign up on the built frontend (passkey) -> first sign-in -> verify screen -> OTP from Mailpit -> API unlocked | PASS | `registration-integration.spec.ts` #1 (one `email-verify/request` 201 automatically, credential = only the passkey, `/api/trips` 200 after). No onboarding dialog follows: the account already has the passkey it was created with (by design). |
| Unverified account: API 403 `email_not_verified`, UI verify screen, reload does not send a second mail | PASS | spec #2; 403 also asserted at API level (`idp-registration` #7) and through the proxy (self-host `verify`) |
| Wrong codes then burned code (5 guesses -> 429 `max_attempts` -> "Too many attempts. Request a new code.") | PASS | spec #3 (each guess synchronised on the server response) |
| Passkey-only user without WebAuthn (init script deletes `PublicKeyCredential`): Keycloak theme link -> `recover.html?email=` prefilled -> mailed code -> new password -> password set, passkey kept -> signs in via "Try another way" -> dashboard, never visits a required-action/enrolment URL | PASS | spec #4; API-level twin `idp-registration` #8 |
| Squatting: attacker registers the owner's address (passkey, session, 403 gate, guessing refused), owner recovers by mail: attacker's passkey deleted, only the owner's password remains, owner signs in | PASS | `idp-registration` #9 |
| Anti-enumeration: unknown address gets the same 202 body, the same UI screen, and no mail | PASS | spec #5, API tests, self-host `recover` |
| Backend down on confirm -> network message; Keycloak down on fresh load -> "can't reach sign-in" with Retry | PASS (simulated by aborting requests in the browser; services stayed up) | spec #6 |
| 429 on recovery request -> `Retry-After` + body `retryAfter` + disabled button with countdown | PASS, opt-in (`E2E_RATE_LIMIT=1`: it burns the per-IP 10/h limit of the running backend) | spec #7 |
| Resend cooldown | PASS in the real stack for "button disabled after the automatic first mail and after reload"; the countdown to zero and the 429-on-resend are covered by the mocked `registration-ui.spec.ts` only |
| Double clicks | Mocked UI suite only (double submit guard); not re-run against the real stack |
| Expired code (10 min) | Backend adversarial tests only; not re-run end to end |

Totals on the stack started by `scripts/ci/registration-stack.sh`: `idp-registration.spec.ts` 9/9 + `registration-integration.spec.ts` 7/7 (16 passed, 0 fixme). Before the changes the two backend tests were fixme.

## CI (task 2)

`scripts/ci/registration-stack.sh start|stop` (Postgres 16 container, drizzle migrations, backend with `REQUIRE_VERIFIED_EMAIL=true` + Mailpit SMTP + recovery secret, frontend build with local URLs, `vite preview` on :5173) was written and validated here (shellcheck clean, whole stack started by it and both specs passed). `keycloak-flow.yml` now runs it after the realm, runs the specs with `CI_BACKEND=1` (missing stack fails instead of fixme), `--workers=1`, the rate-limit test last, stops the stack before Keycloak. Still informational, `contents: read`, no secrets, actions pinned by SHA (unchanged), workflow test extended. **Not run on GitHub Actions** (no runner here): the YAML is covered by `workflows.test.ts` and the commands by the local run. The backend log tail is printed on failure (event names and request ids only).

Run it locally:
```bash
export KC_WORK=$(mktemp -d) KC_PORT=18480 KC_MGMT_PORT=19480 KC_CONTAINER=my-kc MAILPIT_SMTP_PORT=11025 MAILPIT_HTTP_PORT=18025 PG_PORT=55433 API_PORT=18787
scripts/ci/keycloak-flow.sh start && scripts/ci/keycloak-flow.sh apply && scripts/ci/registration-stack.sh start
cd tests && set -a && . "$KC_WORK/e2e.env" && set +a && SKIP_REAL_AUTH=true PW_NO_WEBSERVER=1 CI_KEYCLOAK=1 CI_BACKEND=1 \
  npx playwright test e2e/idp-registration.spec.ts e2e/registration-integration.spec.ts --project=chromium --workers=1
scripts/ci/registration-stack.sh stop; scripts/ci/keycloak-flow.sh stop
```
(The per-IP recovery limit is in memory: after several runs restart the backend, or `registration-stack.sh stop/start`.) The realm redirect URI fixes the frontend port to 5173.

## Self-host kit (task 3)

Full prod compose (Caddy TLS front with a private CA standing in for Funnel, STARTTLS SMTP sink, `REGISTRATION_ENABLED=true`, project `intreg`, host `intreg.localtest.me`): `deploy.sh` from empty volumes, `keycloak-apply.sh --yes` (28 resources, recovery secret written to `.env`), `deploy.sh --no-build` to load it.

`tests/stack-e2e.sh public login cors xff backup idempotent postgres restart mail invite register verify recover`: **67 passed, 0 failed.** New phases:
- `register`: registration endpoint 200 through `/auth`, form has e-mail and no password, recovery secret in `.env` (or refused when `false`).
- `verify`: unverified user -> `/users/me` 200 with `email_verified=false`, `/trips` 403 `email_not_verified`, mail with code (not in the backend log), wrong code 400, right code 200, same token unlocked.
- `recover`: 202 with identical body for unknown addresses, no mail for them, weak password 422, wrong code 400, right code 200 (backend -> Keycloak Admin API on the **internal** URL while the issuer is the public URL: the open question from the IdP report is answered, it works), code single use, login with the new password, old password dead.
Also `scripts.test.sh` 57/57, `purge-unverified.test.sh` 34/34, shellcheck clean. `docs/SELF-HOSTING.md` step 9 offers sign-up on the web or `add-user.sh`, the recovery-client role text matches Terraform, go-live checklist updated; owner values (`legion-server.tailad4a36.ts.net`, Funnel on 443 only) untouched.

## Checks run

typecheck backend + frontend clean; backend `vitest run` x3 against Postgres 16 (own cluster, port 58431): 70 files / 2161 tests each; frontend 69 files / 1488 tests, also with `TZ=America/Argentina/Buenos_Aires`; `CSP_ALLOW_MISSING_ORIGINS=true npm run build` OK; `wrangler deploy --dry-run` OK; `terraform fmt -check`, `terraform test` 23/23; shellcheck clean on kit, tests and `scripts/ci`; e2e hygiene test green.

## Not validated

- GitHub Actions run of the extended workflow; Firefox/WebKit (CDP authenticator is Chromium-only, as before).
- Real Tailscale Funnel, real Gmail, real passkeys on the `.ts.net` rpId, reCAPTCHA, a sign-up throttle (no per-IP limiter exists, see SELF-HOSTING).
- The registration UI against the self-host stack in a browser (the frontend runs on Pages; the kit run used the headless OIDC client). The UI was run against the dev-profile realm only.
- Expired code and double-click against the real stack (covered by backend/mocked tests); backend dev server used `ENVIRONMENT=development` (plain-http CORS and non-TLS SMTP sink) with `REQUIRE_VERIFIED_EMAIL=true` set explicitly; the Node `server.ts` production path ran only in the self-host kit.
- A Keycloak user who registered but never made an authenticated API call has no `users` row and cannot recover (backend risk 1); the app makes that call on the redirect landing, so only an aborted sign-up is affected.
- `attemptsLeft` is not sent by the backend; adding it would improve the wrong-code message but is not required.
