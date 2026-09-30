---
phase: 26-remaining-security-hardening
plan: idp-flow (IdP / Keycloak / Terraform half)
subsystem: identity
tags: [keycloak, terraform, webauthn, passkeys, auth-flow, security]
requirements: [KC-01, SEC-12, SEC-11, SEC-13, ARCH-08, SEC-17, SEC-19, SEC-25, SEC-21]
key-files:
  modified:
    - terraform/keycloak/flows.tf
    - terraform/keycloak/main.tf
    - terraform/keycloak/mappers.tf
    - terraform/keycloak/variables.tf
    - terraform/keycloak/local.tfvars.example
    - terraform/keycloak/import.sh
    - keycloak/themes/japan-trip/login/error.ftl
    - keycloak/Dockerfile
    - keycloak/docker-compose.yml
    - keycloak/README.md
    - tests/e2e/fixtures/kc-admin.ts
    - SETUP.md, DEVELOPMENT.md, README.md, .planning/codebase/{STRUCTURE,INTEGRATIONS}.md
  created:
    - tests/e2e/idp-flow.spec.ts
    - tests/e2e/idp-config.spec.ts
  deleted:
    - keycloak/apply-local-settings.sh
    - keycloak/realm-export.json
completed: 2026-09-30
---

# Phase 26 (IdP half): Keycloak flow, theme and Terraform hardening

## Headline: the old browser flow was a live authentication bypass

ANALISIS-REPO.md (KC-A) rated the `passkey-forms` smell as "safe today, fragile". It is
not safe. Reproduced on Keycloak 26.6.1 with the pre-Phase-26 Terraform:

- Submitting **only an existing username** returned an authorization code, which exchanged
  for a valid access token (`preferred_username` of the victim). Keycloak drops ALTERNATIVE
  siblings of a REQUIRED execution, so `passkey-forms` was "username form only".
- The same worked for a user with **no credentials at all**.
- With `kc_action=webauthn-register-passwordless`, a username-only visitor reached
  **passkey registration for that account** → account takeover.

Where it applied: any Keycloak where Terraform bound `browser-passkey`. Locally it was usually
masked because `apply-local-settings.sh` reset `browserFlow` to the stock `browser` flow.
**If a production Keycloak ever ran this Terraform, treat it as exposed**: apply this phase,
then review login events and remove unexpected WebAuthn credentials (see "Human checks").

## Per-requirement status

| ID | Status | What changed |
|----|--------|--------------|
| KC-01 | Done | `passkey-forms` = username REQUIRED → single REQUIRED `passkey-or-password` subflow whose ALTERNATIVEs are a `passkey` branch and `auth-password-form`. WebAuthn is REQUIRED only inside `passkey-if-configured` (CONDITIONAL, guarded by `conditional-user-configured`). Top-level `password-forms` removed. Password fallback for non-passkey users (incl. `e2e-test@local`) works. |
| SEC-12 | Done | Same restructure; no REQUIRED+ALTERNATIVE level remains (KC no longer logs the warning). Negative E2E tests added (see below). |
| SEC-11 | Done | `error.ftl` uses `${kcSanitize(message.summary)?no_esc}`; static test asserts every `?no_esc` in the theme is sanitized. |
| SEC-13 / ARCH-08 | Done | Browser flow bound by `keycloak_authentication_bindings` (also fixes fresh `terraform apply`, which 500'd because the realm was created with a not-yet-existing `browser_flow`). `apply-local-settings.sh` and the never-imported `realm-export.json` deleted (plus Dockerfile COPY / compose mount). `keycloak/README.md` states Terraform is the only source of truth. |
| SEC-19 | Done | Six test-user password variables have no defaults; `local.tfvars.example` lists them; SETUP uses `-var-file=local.tfvars`. Missing values fail the plan. |
| SEC-25 | Done | `avatar_url`/`preferences` mappers: `add_to_access_token = false` (ID token/userinfo kept). No backend consumer of those access-token claims exists (`extractUserInfo` parses them; nothing reads them). |
| SEC-17 | **Partial** | `ssl_required` is a validated variable (default `external`, unchanged). README/DEVELOPMENT document Keycloak 26 proxy settings (`KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true`; the previously documented `KC_PROXY=edge` no longer exists in KC 26) and a curl check. The Railway deployment itself was **not** verified (not reachable from here; DEPLOY-01 is still deferred), so prod was not switched to `all`. |
| SEC-21 | Deferred | Needs a product decision (is exposing hotel/user_id on public trips intended?). Not mine to declare; backend-owned. |

## Design note: why this layout, and its trade-off

Three variants were applied to a live Keycloak and compared:

1. **Old** (REQUIRED username + ALTERNATIVE webauthn): bypass, as above.
2. **Flat** (credential subflow = webauthn ALT + password ALT, no condition): secure, but
   Keycloak picks the default alternative by credential priority, so a passkey user who
   enrolled after setting a password is shown the **password form first** (passkey only via
   "Try another way"). Passkeys would effectively be opt-in per login.
3. **Chosen** (conditional-wrapped webauthn): passkey users always get WebAuthn; users without
   a passkey get the password form; nobody gets through without a credential.

Trade-off of (3): passkey users have **no "Try another way → password"** in this flow. Recovery
for a lost device is "Forgot password" (Keycloak's email reset-credentials flow, which signs the
user in on completion — not covered by E2E here) or an admin deleting the WebAuthn credential.
If the owner prefers fallback over passkey-first, variant (2) is a small change in `flows.tf`
(remove the two wrapper subflows); the static test would need its WebAuthn rule relaxed.

## Verification performed (all on this sandbox)

Environment: Docker daemon started in the sandbox, `quay.io/keycloak/keycloak:26.6.1 start-dev`
(dev-file DB, repo theme mounted), Terraform 1.9.8 + provider keycloak/keycloak 5.7.0 from the
lock file, Playwright 1.60 Chromium + Firefox.

| Check | Result |
|-------|--------|
| `terraform fmt -check -recursive terraform/` | clean (after the fmt commit) |
| `terraform validate` | valid |
| Upgrade path: old state → new config (apply) | 7 add / 2 change / 3 destroy, flow tree exactly as documented, next plan clean |
| Fresh empty Keycloak → apply | realm, flow and binding created; only the 4 built-in scope mappers collide (pre-existing, needs `import.sh`) |
| Plan without var-file / with `ssl_required=none` | fails with "No value for required variable" / validation error, as intended |
| `tests/e2e/idp-flow.spec.ts` (live KC) | Chromium 14/14, Firefox 10/10 (+4 passkey tests skipped: CDP-only); 96/96 with `--repeat-each=4` on both |
| Same spec against the **old** flow (mutation) | 12/14 fail; the 2 that pass (unknown user, disabled user) are rejected by any flow |
| `tests/e2e/idp-config.spec.ts` (static) | 7/7; against the pre-Phase-26 files 6/7 fail (WebAuthn rule passes vacuously there) |
| `tests/e2e/idp-theme.spec.ts` | 1/1 |
| Ad-hoc HTTP fuzz (curl, realm admin) | 38 negative checks pass: every execution id via `authenticationExecution` and via the action URL, no/empty/other-user password, identity switch mid-flow, disabled user, forged/cancelled WebAuthn, password posted to the WebAuthn step, kc_action registration with username only. Against the old flow it reports 6 bypasses. Token check: correct password → token for the right user; email and upper-case username resolve to the same user. |
| Existing `loginViaKcForm` helper (used by global-setup) | logs `e2e-test@local` in through the new flow (~8 s). Caveat: the frontend on :5173 was a dev server from another worktree (port already taken); the KC part is what was exercised. |
| KC 26 `sslRequired=all` behind proxy headers (simulated) | plain request → "HTTPS required"; with `X-Forwarded-Proto: https` → login form, cookies `Secure` |
| Mapper change | `access.token.claim=false`, id/userinfo `true` for both |
| Frontend / backend unit suites (unchanged code) | 101/101 and 34/34 pass |

The admin-dependent spec tests were run with a throwaway service-account client created in the
disposable container for the run (secret generated in-process, client deleted afterwards). The
real `japan-trip-worker` secret was not used.

## Not verified here — human checks

1. **Production exposure** (if a prod Keycloak ran the old flow): check Keycloak login events
   for LOGIN without a credential step, and list users' WebAuthn credentials for ones the owner
   did not register. Rotate sessions (`Sessions → Sign out all`) after applying.
2. **Apply on the real instance(s)** with `terraform apply -var-file=local.tfvars` (existing
   state): expect the destroy/create of the old webauthn/password-forms resources. Afterwards
   list `browser-passkey` executions (admin console or
   `GET /admin/realms/japan-trip/authentication/flows/browser-passkey/executions`) and compare
   with the tree in `keycloak/README.md` — **Terraform does not notice extra executions it does
   not track**, so strays from manual edits survive an apply. Confirm the log no longer shows
   "REQUIRED and ALTERNATIVE elements at same level".
3. Run `idp-flow.spec.ts` with `KC_ADMIN_CLIENT_ID/SECRET` + `E2E_TEST_PASSWORD` against the
   local stack, and the full E2E suite (global-setup login, otp, session-management, passkeys)
   — not run here (needs backend + Postgres + Mailpit). `passkeys.spec.ts` (3 known-failing)
   may now behave differently since WebAuthn is actually reachable; not investigated.
4. **SEC-17**: on Railway set `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true`,
   `KC_HOSTNAME=https://…`, run the curl check in `keycloak/README.md`, then set
   `ssl_required = "all"` in the prod var-file.
5. `local.tfvars` for existing developers now needs the six password variables (and optionally
   `ssl_required`); `tests/.env.test` values must match.

## Open concerns (outside this scope, not changed)

- **Prod image has no theme**: `keycloak/Dockerfile` never copies `themes/`, so the `japan-trip`
  login theme — including the SEC-11 fix — is only used where the theme is mounted (local compose).
- Fresh bootstrap still needs `import.sh` for the 4 built-in client-scope mappers.
- Observed a non-converging plan on one fresh bootstrap: `keycloak_user.testuser.required_actions`
  keeps getting `VERIFY_EMAIL` re-added (ordering with the default `VERIFY_EMAIL` action). Pre-existing, users untouched here.
- Realm has no brute-force protection configured; username-first flows also reveal whether a
  username exists (password form vs. re-prompt). Both are standard KC behaviours worth a decision.
- `tests/e2e/fixtures/kc-admin.ts` has a pre-existing unused `expect` import.

## Commits (worktree branch)

1. `fix(kc): require a credential after the username in browser-passkey` (KC-01, SEC-12)
2. `test(e2e): assert username-only login is rejected by the browser flow`
3. `fix(kc-theme): sanitize error summary before disabling escaping` (SEC-11)
4. `fix(kc): bind browser flow with keycloak_authentication_bindings` (SEC-13)
5. `chore(kc): make Terraform the only source of realm configuration` (SEC-13, ARCH-08)
6. `fix(kc): keep avatar_url/preferences out of the access token` (SEC-25)
7. `fix(tf): require test-user passwords from a var-file` (SEC-19)
8. `fix(kc): make sslRequired configurable and document Railway TLS` (SEC-17, partial)
9. `test(e2e): statically check Keycloak Terraform and theme invariants`
10. `style(tf): terraform fmt the keycloak module`
11. `test(e2e): cover username-only login without admin credentials`
12. `test(e2e): cover every browser-flow login case and tampering path`
13. `docs(26): record IdP-half summary and tick requirements`
