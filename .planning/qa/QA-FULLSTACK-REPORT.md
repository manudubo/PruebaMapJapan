# QA — full-stack real-auth E2E report

Date: 2026-10-07. Branch: `worktree-agent-ae8d26b8062c068ba`. Base: `origin/main` @ ed49639 (PR #23 merged), plus the commits listed below.

## Verdict

Every real-auth spec now passes on a real stack: 66/66 for the Playwright real-auth set and 2/2 for `uat-passkeys.spec.ts` (final single run, after a fresh global-setup login).

Getting there took four test bugs, and some of them blocked whole runs:

- `passkeys.spec` left a passkey on the shared seeded user.
- `passkeys.spec` did not handle Keycloak's re-authentication prompt.
- The OTP test raced the passkey-campaign redirect.
- `uat-passkeys` had never been runnable against a realm built by Terraform.

In addition, `trip-edit-integration` was disabled by mistake and leaked rows into the database.

No app bug was found. The stress scenarios (OTP flood, parallel guesses, expired session mid-edit, Keycloak restart or down, passkey cancel, logout in another tab) were all handled correctly.

## Stack used (all in this sandbox)

| Piece | How |
|---|---|
| Docker | `dockerd --iptables=false`, every container on `--network host` (no bridge NAT in the sandbox) |
| Postgres 16 | `public.ecr.aws/docker/library/postgres:16-alpine`, container `qafs-pg`, port **55432** (5432 is left free for other agents); migrations 0000–0009 via `drizzle-kit migrate` (10 rows in `drizzle.__drizzle_migrations`) |
| Keycloak 26.6.1 | `quay.io/keycloak/keycloak:26.6.1 start-dev`, container `qafs-kc`, :8080, repo theme mounted, `--add-host mailpit:127.0.0.1` (realm SMTP host) |
| Terraform 1.9.8 / provider 5.7.0 | `terraform apply -var-file=local.tfvars` on a scratch copy of `terraform/keycloak` |
| Mailpit | `ghcr.io/axllent/mailpit:v1.29` (Docker Hub is rate-limited), container `qafs-mailpit`, :1025/:8025 |
| Backend | `backend/src/dev.ts` with `.dev.vars` (`DB_DRIVER=pg`, `ENVIRONMENT=development`), :8787 |
| Frontend | `vite build` + `vite preview` :5173 (production bundle, CSP enforced) |
| Playwright | 1.60 / Chromium 1223 from `/opt/pw-browsers` (version matches, so no `executablePath` was needed). The root `uat-passkeys.spec.ts` uses the root Playwright 1.59 / Chromium 1217, run through an untracked temporary config. |

The specs hard-code :5173, :8787, :8080 and :8025, and so do the realm's redirect URIs and web origins. Those ports therefore could not be made unique. They were free when the stack started.

## Results matrix

`rep` is the number of repeated runs and their result (`--repeat-each`). These are Chromium results.

| Spec | First real run (pre-fix) | Final run | Repeats | Notes |
|---|---|---|---|---|
| passkeys.spec.ts (chromium-passkeys) | 3/3 pass on a fresh login; **9/9 fail** when the login is more than 5 min old | 3/3 | 3x: 9/9 (`--workers=1`) | See finding 2. The historical "3 known failures" were this, plus finding 1. |
| otp.spec.ts | 3 pass, **1 fail** (UPDATE_PASSWORD gate) | 4/4 | 3x: 12/12 (`--workers=1`) | Finding 3. With 2 workers, `--repeat-each` runs two copies in parallel on the same user, which gives a 429; that is a repeat artefact, not a bug. |
| session-management.spec.ts | 7/7 | 7/7 | 3x: 21/21 | Covers logout in another tab, closing a tab, and a new context. |
| new-user-trip-creation.spec.ts | 1/1 | 1/1 | 3x: 3/3 | |
| api.spec.ts | 5/5 | 5/5 | 3x: 15/15 | The JWT audience test uses a real worker client_credentials token. |
| public-sharing.spec.ts | 5/5 | 5/5 | 3x: 15/15 | |
| auth.spec.ts — "real session" block | 2/2 (+12 mocked) | 14/14 | 3x: 42/42 | |
| idp-theme.spec.ts | 1/1 | 1/1 | 3x: 3/3 | |
| idp-flow.spec.ts | 14/14 | 14/14 | 3x: 40/42 → 42/42 after fix | The 2 failures came only after passkeys.spec ran (finding 1). |
| idp-config.spec.ts | 7/7 | 7/7 | 3x: 21/21 | Static checks. |
| trip-edit-integration.spec.ts | 5 skipped (`fixme(true)`) | 5/5 | 3x: 15/15 | Finding 4. |
| uat-passkeys.spec.ts (root) | 1 pass, **1 fail** (hardcoded user id does not exist) | 2/2 | 8x: 16/16 | Finding 5. |

Not run: Firefox and WebKit (only Chromium was asked for and needed), and the specs that need no auth (CI covers them).

## Findings and fixes (one commit each, test first)

1. **passkeys.spec left a passkey on `e2e-test@local`** (commit `test(e2e): stop passkeys.spec leaving a passkey on the seeded user`).
   - Impact: since Phase 26, passkey users get no password fallback. After a passkeys run, the next fresh global setup hung on the password step, which blocked the entire suite, and 2 idp-flow seeded-user tests failed.
   - Reproduced: run the passkeys project, then `idp-flow -g seeded`; 2 tests fail.
   - Fix: `afterAll` resets the WebAuthn credentials, and global setup resets them before the password login, which also covers an interrupted run.
2. **Keycloak 26 re-authentication for credential registration** (commit `test(e2e): answer Keycloak's re-authentication prompt in passkeys.spec`).
   - Cause: Keycloak asks the user to re-authenticate before a credential-registering action once the login is older than that action's max auth age (default 5 min). Global setup reuses its login for 20 min, so all 3 tests failed ("Please re-authenticate to continue").
   - Fix: one helper that answers the prompt with the password.
   - This is correct Keycloak behaviour, not an app bug: real users simply re-authenticate.
3. **OTP UPDATE_PASSWORD test raced the passkey-campaign redirect** (commit `test(e2e): accept passkey-campaign redirect in OTP UPDATE_PASSWORD test`).
   - Cause: `loginViaKcForm` returns on the first app URL, and on a fresh context the once-per-device campaign has often already redirected to Keycloak by then.
4. **trip-edit-integration was `fixme(true)` as "not implemented"**, but the page and API both exist and all 5 tests pass (commit `test(e2e): enable trip-edit-integration on the real stack and clean up`).
   - Change: it is now gated on `SKIP_REAL_AUTH`, so CI still skips it.
   - It used to create 5 "Test trip" rows per run and never delete them. They are now deleted in `afterAll`; 0 rows remain after a run.
5. **uat-passkeys.spec.ts had never been runnable on a Terraform realm** (commit `test(uat): make uat-passkeys runnable against a Terraform-built realm`). It had five problems:
   - It used a hardcoded user id from one developer's Keycloak.
   - It used the pre-KC-01 single-page login form.
   - It expected a visible Delete for the only passkey, which contradicts the D-17/D-18 last-credential guard.
   - It waited for the old Spanish text "Cargando", so the check raced.
   - Its `waitForURL` waited for `load` and timed out about 1 run in 5.

   Fix:
   - Each test now creates and deletes a throwaway user.
   - Login is username-first.
   - The test asserts the guard, registers a second passkey on a fresh virtual authenticator with a unique label (Keycloak rejects duplicate device names), then deletes one passkey.
6. **`.env.test` passwords must be quoted** (commit `docs(e2e): warn that .env.test passwords must be quoted`).
   - Cause: the realm policy requires a special character, and dotenv cuts an unquoted value at `#`. Global setup then timed out with no explanation.

## Pressure / odd-sequence probes (ad-hoc script, real stack)

| Scenario | Result |
|---|---|
| OTP request flood (20 parallel) | 1×201, 19×429, exactly 1 email in Mailpit |
| 12 parallel wrong OTP guesses | 5×400 then 7×429: no more than 5 guesses are evaluated (SEC-07 holds) |
| OTP wrong ×5 then right | 429 lockout (otp.spec, repeated 3x) |
| Session expires mid-edit (admin logs the user out, browser clock +6 min, then Save on trip-edit) | Token refresh fails; the PATCH is sent without auth and gets 401; the app shows "Session expired — redirecting to login" and goes to Keycloak. No data is corrupted. *Suggestion:* the unsaved edit is lost, and the return target is `dashboard.html` rather than the edit page. |
| Logout in another tab | session-management "logout in one tab…" passes 3/3 |
| Keycloak restart mid-session | After `docker restart`, the dashboard still renders the trips grid (persistent sessions) |
| Keycloak down | Dashboard shows "Can't reach the sign-in service… Retry / Back to home"; no hang or blank page |
| Passkey registration cancelled at Keycloak | Returns to profile.html with "You don't have any passkeys registered yet." and no error |

## DEP/INFRA claim: KC_ADMIN_CLIENT_SECRET removed from prod config

Confirmed:

- `terraform/cloudflare/main.tf` no longer creates a worker secret for it (commit 2d326a8).
- `backend/src` only declares and passes it through (`types/index.ts`, `dev.ts`); nothing reads it.
- With the backend started with `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` set to empty, these specs passed 24/24: api, otp, new-user-trip-creation, and idp-flow including the throwaway-user tests.

The admin fixture (`tests/e2e/fixtures/kc-admin.ts`) takes the worker client credentials from `tests/.env.test` and talks to the local Keycloak directly, so it does not depend on the backend config.

## Observations (not fixed)

- **Dead sessionStorage replay.** `tests/.auth/session.json` is always `[]`: keycloak-js tokens live only in memory, by design. Several specs still "replay sessionStorage (Playwright bug #31108)" and work only because of the Keycloak SSO cookie. This could be cleaned up.
- **Global setup misses the campaign redirect.** `kcLogin` does not handle the passkey-campaign redirect (Case B); after `reload()` the page can sit on the Keycloak required-action page. This is harmless today because only cookies matter (see the previous point).
- **Terraform plan does not converge on fresh realms.** A fresh Keycloak still needs the 4 built-in scope mappers imported (expected, see `import.sh`). After apply, one user (`new_user_test` here) keeps getting `VERIFY_EMAIL` re-added, so the plan never converges. It is harmless at login (`emailVerified=true`). This is pre-existing.
- **`frontend/.env.example` API URL.** It sets `VITE_API_URL=http://localhost:8787` without `/api`, while the code default and CI use `.../api`. Copying the example as SETUP.md says therefore gives 404s.
- **Repeat runs need one worker.** `--repeat-each` with 2 workers runs copies of serial specs (otp, passkeys) in parallel on the same Keycloak user, which causes interference. Use `--workers=1` for repeats of those specs.

## Repro

```bash
# stack: see table above; tests/.env.test with quoted passwords and the worker secret
cd tests && rm -rf .auth
npx playwright test --project=chromium --project=chromium-passkeys \
  e2e/{passkeys,otp,session-management,new-user-trip-creation,api,public-sharing,auth,idp-theme,idp-flow,idp-config,trip-edit-integration}.spec.ts
# root UAT: config with testDir '.', testMatch 'uat-passkeys.spec.ts', run with ./node_modules/.bin/playwright
```
