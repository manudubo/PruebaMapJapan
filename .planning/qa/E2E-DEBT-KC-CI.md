# E2E test debt (ARCH-07 residue) and the Keycloak CI job (review S3)

Base: `origin/main` at ed49639 (PR #23 merged), then `origin/claude/focused-lovelace-cryssy` (941e44b, real-auth QA + A11Y-04/05) merged in. Worktree branch only; not pushed.

**After the merge:**
- **Re-grep:** no new `waitForTimeout` or `test.skip(` in tests/e2e.
- **Keycloak-related files unchanged by the merge:** the Terraform files, `idp-*` specs, fixtures and Playwright config. So the Keycloak runs below still apply.
- **Checks re-run:**
  - typecheck: clean;
  - frontend: 50 files, 1102 tests;
  - backend, on a fresh Postgres 16: 48 files, 1619 tests;
  - full CI-mode Chromium suite: 282 passed, 48 fixme, 0 failed;
  - `overview-map`, `qa-frontend` and `qa-sw` with `--repeat-each=3`: 144/144.

## 1. Test debt

ARCH-07 left `tests/e2e` at 0 `waitForTimeout` / 0 `test.skip(`. Later specs added 3 and 6 back.

| Where | Was | Now |
|-------|-----|-----|
| `overview-map.spec.ts` lazy-map test | `waitForTimeout(500)` | Waits two animation frames. By then the IntersectionObserver has delivered its first (not intersecting) entry, so "no map" means "not initialised" and not "not initialised yet". |
| `qa-frontend.spec.ts` search XSS | `waitForTimeout(400)` | Clears the input, which shows the suggestions list with its "Cities" header. Then waits for the debounced search for the payload to replace that header. |
| `idp-flow.spec.ts` lost passkey | `waitForTimeout(3_000)` | Waits for the WebAuthn error POST that Keycloak's page sends back. |
| `idp-flow.spec.ts` Keycloak down / no `E2E_TEST_PASSWORD` / no admin client (3 skips) | `test.skip(cond)` | Locally: `test.fixme(cond && !CI_KEYCLOAK, reason)`. With `CI_KEYCLOAK=1` the precondition is asserted, so a broken CI job fails instead of passing with nothing run. |
| `idp-flow.spec.ts` passkey cases on non-Chromium | `test.skip` | Documented `test.fixme(browserName !== 'chromium', …)`. The virtual authenticator is CDP-only, so this is not an app defect. |
| `idp-config.spec.ts` non-Chromium projects | `test.skip` per test | Ignored by the firefox and webkit projects in `playwright.config.ts`. These are pure file checks, so they run once. |
| `qa-sw.spec.ts` dev build | `test.skip(!prod)` | Fixme only outside CI. In CI the preview build is always a production build, so a dev build there is a failure. |
| `api.spec.ts:61` | `expect([404, 500]).toContain(status)` | `toBe(404)` and the body `{ success: false, error: 'Trip not found' }`. `BACKEND_URL` can be overridden, as `global-setup.ts` already allows. |

**Guard.** `frontend/tests/e2e-hygiene.test.ts` runs in the frontend Vitest suite on every CI push. It fails if any file in `tests/e2e` contains `waitForTimeout(`, `test.skip(`, `describe.skip(`, or a `test.fixme()` with no reason. It includes a scanner self-check, so the test cannot pass vacuously.

**Flake fixed along the way.** In `idp-flow.spec.ts`, `enrolPasskey` returned as soon as the redirect *request* was seen. The next `page.goto()` was then "interrupted by another navigation", and two passkey tests failed in the first local run of the CI job. It now waits for the main frame to commit outside Keycloak. A probe confirmed Chromium emits `framenavigated` (`chrome-error://…`) when nothing listens on :5173, which is the CI case.

### Verification

- **`api.spec.ts`** ran against a real backend: `backend/src/dev.ts` with `DB_DRIVER=pg` and `ENVIRONMENT=development`, on Postgres 16 (UTF8, port 55471, started via `setpriv`), migrated with `npm run db:migrate --workspace=backend`, and the Keycloak below for the JWT test. Result: 5/5 three times (`--repeat-each=3`). A curl check gave 404 for the missing trip, 400 for a malformed slug and 401 without a token.
- **Touched frontend specs**, CI mode (preview build, `--retries=0`), `--repeat-each=3`: `overview-map`, `qa-frontend`, `qa-sw` and `idp-config` all passed on Chromium.
- **`idp-flow` + `idp-config`** passed in 3 consecutive full runs of the CI job (see below).
- **Full CI-mode Chromium suite:** 279 passed, 48 fixme, 0 failed.
- **Unit and type checks:** typecheck clean (frontend and backend). Frontend: 48 files, 1062 tests. Backend, with `TEST_DATABASE_URL` on that Postgres: 43 files, 1524 tests.
- **Fixme versus fail:** with Keycloak unreachable, `idp-flow` reports 14 fixme without the flag and fails with `CI_KEYCLOAK=1`.

## 2. S3: `.github/workflows/keycloak-flow.yml`

The steps live in `scripts/ci/keycloak-flow.sh` (`start | apply | stop`), so the local run uses the same commands.

1. **Checkout and setup.** Checkout runs with `persist-credentials: false`, then setup-node 22. Both are pinned by SHA, the same SHAs `ci.yml` uses.
2. **Terraform.** Installs Terraform **1.9.8** from releases.hashicorp.com. It checks `sha256sum -c` against a pinned hash before `unzip`. The hash was confirmed against HashiCorp's SHA256SUMS and the downloaded zip.
3. **Keycloak.** `start` runs `quay.io/keycloak/keycloak:26.6.1 start-dev` with host networking and the repo theme mounted read-only. The healthcheck uses bash `/dev/tcp` (as in docker-compose) on `/realms/master`, because the realm does not exist yet. The admin password is random and passed via `--env-file`.
4. **Realm.** `apply` copies `terraform/keycloak` to `$RUNNER_TEMP`, so state never enters the checkout. It runs `init -lockfile=readonly`, then applies the realm with random test-user passwords from a tfvars file in `$RUNNER_TEMP`. Two things were needed that the S3 proposal did not foresee:
   - **Lock file:** it had only one platform's `h1:` hash, so `-lockfile=readonly` failed on Linux. Hashes for linux/windows/darwin were added; the existing ones are unchanged.
   - **Fresh bootstrap:** a plain apply fails with "protocol mapper with name username already exists", because Keycloak creates the built-in profile/email mappers that `mappers.tf` manages. The script runs `apply -target=keycloak_realm.japan_trip`, imports those 4 mappers, then runs the full apply.
5. **Playwright.** Runs `idp-flow.spec.ts` and `idp-config.spec.ts` with `--project=chromium --project=firefox --retries=0`. It sets `CI_KEYCLOAK=1`, `SKIP_REAL_AUTH=true`, and `PW_NO_WEBSERVER=1`, a new switch in `playwright.config.ts` that avoids building the app these specs never load. The `kcAdmin` fixture uses the Terraform `japan-trip-worker` client (manage-users). Its per-run secret comes from `terraform output`.
6. **On failure:** prints the Keycloak log tail and uploads `tests/playwright-report/`. **Always:** removes the container and the work directory.

**Secrets.** No repository secret is used. Generated values go only to mode-600 files under `$RUNNER_TEMP` (curl reads the admin password from a file) and are `::add-mask::`ed on Actions. They are never echoed, and there is no `set -x`.

**Permissions and triggers.** The workflow has `contents: read` only and runs on `pull_request` to main, `push` (main, `feature/**`) and `workflow_dispatch`, with a 20-minute timeout. `ci.yml` now shellchecks the script. actionlint 1.7.7 and shellcheck 0.11 are clean.

**Tests.** `frontend/tests/workflows.test.ts` adds 12 cases. They check that:
- the job exists;
- the triggers are right;
- it is informational (deploys follow only `CI`);
- no `secrets.` reference and no tracing are present;
- checkout does not persist credentials;
- Terraform is pinned and verified before unzip;
- the steps run in order (start, apply, playwright) with both specs, both browsers and `CI_KEYCLOAK=1`;
- the report uploads on failure and the stop step always runs;
- secrets are generated under umask 077, passed by `--env-file` and file rather than argv, printed only via `::add-mask::` or into a file, and every generated secret is masked.

A mutation (`echo "admin password: $admin_pass"`) makes the suite fail.

### Local reproduction

The sandbox setup:
- dockerd was already running;
- `KC_PORT=18080` and `KC_MGMT_PORT=19000`, because other sessions use 8080 and 9000;
- `KC_WORK` in the scratchpad;
- the verified Terraform zip;
- `CI=true`.

| Run | Result | Time |
|-----|--------|------|
| 1 (before the `enrolPasskey` fix) | 29 passed, 2 failed (passkey tests, navigation race), 4 fixme | 87 s |
| 2 | 31 passed, 4 fixme (Firefox passkey cases), 0 failed | 110 s |
| 3 | 31 passed, 4 fixme, 0 failed | 106 s |
| 4 | 31 passed, 4 fixme, 0 failed | 106 s |

### Decision: informational, not deploy-gating

After the fix it passed 3 out of 3 local runs. I still left it informational: it is its own workflow, and the deploy workflows only follow `CI`. Reasons:

1. It has **never run on GitHub Actions**.
2. The first local run exposed a real flake, and only 3 runs have passed since the fix.
3. It depends on quay.io, releases.hashicorp.com and registry.terraform.io at run time. An outage of any of them should not block a Pages deploy.

Recommendation: after about 10 green runs on Actions, make "Keycloak flow / idp-flow" a required status check for PRs to main (branch protection). That covers the merge path without coupling deploys to external registries.

### Not validated

- **Anything Actions-specific.** This covers:
  - `services`-free `docker run --network host` on `ubuntu-latest`;
  - `$GITHUB_PATH`;
  - `::add-mask::` behaviour;
  - the setup-node cache keyed on `tests/package-lock.json`;
  - `playwright install --with-deps chromium firefox` time;
  - the GitHub reporter;
  - the artifact upload.

  actionlint only checks syntax and expressions.
- **Runner time.** Locally a run took about 110 s with images and browsers cached. On a fresh runner, the image pull, browser install and npm ci will add time. The 20-minute timeout is a guess.
- **Terraform signature.** The Terraform zip is pinned by sha256 only. The GPG signature on SHA256SUMS is not checked, the same as gitleaks in `security.yml`.

## Pre-existing issues seen, not fixed

- **`qa-sw.spec.ts` on Firefox:** 3 tests fail every time. One uses CDP (`newCDPSession`), and the offline map tests fail too. CI runs only Chromium, so this does not affect CI. The tests could be made chromium-only like `idp-config`.
- **Chromium offline behaviour in a private network namespace:** when the specs were run in a private network namespace (`unshare -n`, which I first tried in order to avoid the other sessions' :5173 server), Chromium reports `navigator.onLine === false`. The app then shows "Can't reach the sign-in service", and `qa-sw` "never opened before" failed intermittently. All of this went away in the host namespace. It is a sandbox artifact, not a product bug, but it is worth knowing.
- **Terraform plan drift:** the known `testuser.required_actions` drift (26-IDP-SUMMARY) was not checked. The job does not run a second plan.

## Cleanup

Everything I started has been removed:
- the Keycloak container (`kc-flow-ae8e`) and its work directory (by `stop`);
- the backend dev server;
- Postgres (`pg_ctl stop`, data dir `/var/lib/postgresql/e2edebt-ae8e` deleted).

Containers named `qafs-*` and `tmshost-*` belong to other sessions and were not touched.
