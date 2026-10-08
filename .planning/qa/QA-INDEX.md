# QA index: what was checked, and what was not

Read this before approving the v3.2 PR or PR #24. It lists every QA artifact, what it covers, and the verification gaps. The first table is the v3.2 set (PR #23, merged); the second is the PR #24 set (added 2026-10-08). Requirement-level evidence is in `.planning/phases/TRACEABILITY.md`.

## Artifacts

| Artifact | Covers | Status of its findings |
|----------|--------|------------------------|
| `QA-BACKEND-REPORT.md` | Adversarial API suite (`backend/tests/adversarial/`, 8 files) on a real Postgres: JWT, IDOR on 19 routes, flows and cascades, reorder, input fuzz, concurrency with forced lock interleavings, OTP, CORS/headers. 11 defects fixed (F1-F11) | All 3 `it.fails` it left open (SEC-07 issuance, SEC-22, BIZ-07) are now normal passing tests (`25-BIZ07-SEC22-OTP-SUMMARY.md`). The report's "still open" table is out of date |
| `QA-FRONTEND-REPORT.md` | Visual sweep of 13 pages x light/dark x 375/1280 (10 screenshots in `visual/`), service worker behaviour in Chromium, hostile widget/search inputs, theme with blocked storage. 6 defects fixed | Visual items 7-10 (dark landing cards, floating search button, Keycloak-down landing, empty dashboard) were fixed afterwards: `phases/23-supply-chain-a11y/23-QA-FOLLOWUP.md` |
| `phases/23-supply-chain-a11y/23-QA-FOLLOWUP.md` | Fix and tests for visual items 1-4, double-submit trip creation, OTP request origin; 53 `@qa-noauth` e2e tests with a fake IdP and API | Fixed. Run on a local preview, not in CI |
| `phases/20-critical-security/20-CSP-FOLLOWUP.md` | CSP blocked the API origin (every logged-in call failed in an enforcing browser); fix and hostile-env build matrix; `csp.spec.ts` enforces the CSP | Fixed. Real tiles and real Keycloak/API were stubbed |
| `QA-DEMO-FIXES.md` | CartoDB "API KEY REQUIRED" tiles, missing overview map, countdown. Provider comparison, pixel diff vs `ab6b603`, 16 real-tile views (8 screenshots in `visual-demo/`), 198 e2e passed / 1 skipped on a preview build | Fixed. Live site still serves the old build until merge |
| `REVIEW-FIXES.md` | Independent review of `be13cef`: deploy order, fork-safe deploys, trip-edit with slow Keycloak, extra DB round-trip, `import.sh`, hotel 404, CSP strictness, SW resilience. Owner actions list | M1, M2, S1, S2, S5, N1, N2, N3 (docs only), N6, N7 fixed. S3 and S4 not done |
| `NEON-SMOKE-CHECKLIST.md` | 9 manual checks of the Neon HTTP driver paths | Never run; results table is empty |
| `phases/24-arch-debt/24-E2E-SUMMARY.md` | Why the CI e2e job failed (5 root causes) and the local CI-mode runs (144 passed / 41 fixme / 0 failed x3). Lists specs that could not run | See gaps below |
| `phases/26-idp-flow/26-IDP-SUMMARY.md` | Live Keycloak 26.6.1 checks of the new browser flow: Chromium 14/14, Firefox 10/10, 96/96 with `--repeat-each=4`, mutation run against the old flow (12/14 fail), 38 HTTP fuzz checks, Terraform upgrade path | Done once in a sandbox, not reproducible in CI |

## Artifacts added by the PR #24 batch

| Artifact | Covers | Not covered / status |
|----------|--------|----------------------|
| `QA-SYSTEM-REPORT.md` | Backend as a system, PG 16.13, 92 tests in `backend/tests/system/`: 0003 to 0010 upgrade on ugly data (hand-built, migrator-built, push-built), deploy pipeline order, a Neon HTTP emulator (production driver against real Postgres), cross-phase races on both drivers, seeded property tests. 4 findings fixed (F1 migration 0010, F2 preflight, F3 readiness, F4 pool listener); 7 design-level findings documented | Real Neon (emulator only), a copy of the real production database, old Worker on the migrated schema (analysed, not executed). Open: legacy incoherent rows cannot be edited from the UI until their dates are fixed |
| `QA-FULLSTACK-REPORT.md` | Real-auth Playwright on a real stack (Postgres, Keycloak 26.6.1 from Terraform, Mailpit, backend, production-bundle frontend): 66/66 plus `uat-passkeys` 2/2, 3x repeats; OTP flood, parallel guesses, expired session mid-edit, Keycloak down or restarted, passkey cancel. 6 test fixes, no app bug | Chromium only; Firefox/WebKit not run. Observations not fixed: dead sessionStorage replay, global setup misses the campaign redirect, Terraform plan keeps re-adding `VERIFY_EMAIL` on one user, an edit is lost on session expiry mid-edit |
| `E2E-DEBT-KC-CI.md` | ARCH-07 residue (3 sleeps, 6 skips, `[404, 500]` assertion) cleared and guarded by `e2e-hygiene.test.ts`; the `Keycloak flow` workflow (S3) with local runs of 31 passed / 4 fixme, three times | The workflow on Actions (not concluded when checked), runner time, Terraform signature. Pre-existing: `qa-sw` fails 3 tests on Firefox (CI is Chromium only) |
| `A11Y-LCP-FOLLOWUP.md` | A11Y-04 (marker declutter; axe 0 violations on 9 pages x light/dark x 375/1280; Lighthouse a11y tokyo 1.00) and A11Y-05 (landing LCP 5415 to 1304 ms, performance 0.68 to 1.00; Tokyo LCP 2749 to 2261 ms, noisy) in a sandbox with mobile emulation | Real-network LCP on GitHub Pages, slower CPUs, Lighthouse on Actions. One `qa-sw` timeout in about 14 runs under load |
| `PROD-HARDENING.md` | 12 findings for internet exposure: origin typo, CORS, ID-token acceptance (reproduced with real tokens), rate limits and client IP, SMTP, log leaks, headers, geocode proxy, Keycloak production profile, lockout oracle, username enumeration, SEC-17. Backend 60 files / 1856 tests at that point; production-profile realm on a real Keycloak 26.6.1 with `idp-hardening.spec.ts` 18/18 | Real Funnel to Caddy to backend chain, real Gmail, Firefox/WebKit for the new spec, Workers behaviour of the memory limiter, the full e2e suite with Mailpit. Residual: username enumeration, per-process limits |
| `SELFHOST-REPORT.md` | The self-hosting kit on a sandbox stack: `stack-e2e.sh` 32 passed at the time (40 after integration), `scripts.test.sh` 45 (52 after), shellcheck; deploy from empty volumes, realm apply, OIDC code + PKCE login through the public URL, CORS, admin paths blocked, backup/restore drill, DB kill and recovery. 5 findings fixed (S1 to S5) | Tailscale Funnel itself (stub only: CLI shape on 1.102, `serve status --json`, real client IP in `X-Forwarded-For`, bandwidth limits), Cloudflare Tunnel and Let's Encrypt modes (config level), real email, passkeys on the `.ts.net` rpId, Ubuntu 26.04 specifics, `update.sh` end to end |
| `INTEGRATION-REPORT.md` | Merge of the three tracks: e2e-hygiene failure, geocoder test flake, startup wiring (`NOMINATIM_USER_AGENT`, `prepareServer()`), one `/api/health/ready`, login `redirect_uri` fix (PROD-03), self-host proof on the integrated tree (override file removed, loopback admin URL, `add-user.sh`, CI job missing `deploy-defaults.json`). Backend 64 files / 1928 tests x3, frontend 53 files / 1148 tests, `stack-e2e.sh` 40/40, mocked Playwright 286 passed | Real Funnel, Gmail, passkeys; legacy state move; production-profile brute-force tests (no admin client); the `Keycloak flow` workflow on Actions; Firefox/WebKit for `auth-return-to`. 2 mocked tests flaked under load (`qa-sw` offline city, `trips` API failure) and pass alone |

Counts in this table are the reports' figures; they were not re-run when this index was updated.

## Re-verified on 2026-10-04 (this consolidation)

- `tsc --noEmit` backend and frontend: clean.
- `npm test --workspace=backend` on a real Postgres 16 (UTF8): 43 files, 1524 tests passed.
- `npm run test:run --workspace=frontend`: 47 files, 1042 tests passed, also under `TZ=America/Argentina/Buenos_Aires`.
- `vite build` with API and Keycloak origins: OK, CSP meta present in 13 of 14 pages (not in `silent-check-sso.html`).
- Not re-run: Playwright, Terraform, Keycloak, Lighthouse/axe, `wrangler deploy --dry-run`.

## Gap status after the PR #24 batch (2026-10-08)

| Gap listed in the next section | Now |
|--------------------------------|-----|
| Real-auth full e2e suite | Closed on a real stack, Chromium (`QA-FULLSTACK-REPORT.md`); still not in CI (`SKIP_REAL_AUTH=true`) |
| System / migration upgrade-path QA | Closed on test databases and an emulator (`QA-SYSTEM-REPORT.md`); not on a copy of real data |
| CI Postgres service, ARCH-09, `security.yml` on Actions | Closed: green on PR #23 head 2200c6e and on the push to main (ed49639), read from the check-runs API |
| CI job running Keycloak (S3) | Built; not yet seen green on Actions |
| Production Keycloak | The production profile was applied to a real Keycloak 26.6.1 locally; the owner's realm has not been touched |
| Neon HTTP driver | Emulator only; smoke checklist still unrun |
| Tripbuilder / authenticated UI visually against a real backend | Real-auth specs drive these pages on a real stack, but there is still no visual review of the editor against real data |
| Real map tiles and fonts in CI, Firefox and WebKit | Unchanged |

## What was NOT verified (as of the v3.2 consolidation; see the status table above)

| Gap | Why it matters | How to close it |
|-----|----------------|-----------------|
| **Real-auth full e2e suite** (`otp`, `passkeys`, `session-management`, `new-user-trip-creation`, `idp-theme`, `api`, `public-sharing`, `auth` real session, `uat-passkeys`) | These specs were only typechecked after the ARCH-07 rewrite; their sleep replacements (`passkeys`, `uat-passkeys`) are unproven. CI sets `SKIP_REAL_AUTH=true`. `passkeys.spec.ts` (3 known-failing) may behave differently now that WebAuthn is really reachable | Run the full suite against the local stack (Keycloak + backend + Postgres + Mailpit) |
| **Tripbuilder visual QA against the real backend** | Dashboard, trip, trip-edit and profile were only seen with Keycloak stubbed and the API mocked (Phase 25 visual check, frontend QA). The new editor fields (optional, generic, maps link, zoom, 422 messages) were never seen against real data | Run the stack, create a trip with every field, view it, share it |
| **System / migration upgrade-path QA** | Migrations 0004-0009 were tested on populated test tables and fresh databases, never on a copy of a real earlier database. Not covered: a `drizzle-kit push`-created DB (preflight only stops it), duplicate emails on real data, swapped lat/lng, and the old Worker running against a migrated DB | Restore a Neon branch of production (or a dump of the dev DB), run `db:preflight` + `db:migrate`, then smoke the API |
| **CI Postgres service on Actions** | `test-backend` has a `postgres:16-alpine` service that has never run; the suite fails (does not skip) without a database | Push and read the run |
| **ARCH-09 e2e job on Actions** | Never green in the repo's history. Since `continue-on-error` was removed it gates both deploys on `main` | Push and read the run |
| **`security.yml` (gitleaks, axe, Lighthouse) on Actions** | Never executed there; Lighthouse LCP not measured on real network | Push and read the run |
| **Neon HTTP driver** | All tests use node-postgres. `otp_issue()` result shape, SQLSTATE `code`/`column` fields behind 422 `date_conflict` and 409, and the schema-guard query are assumed identical over HTTP | `NEON-SMOKE-CHECKLIST.md` (S4) |
| **CI job running Keycloak (S3)** | The KC-01 regression tests (`idp-flow.spec.ts`) only run by hand | Build the job proposed in `REVIEW-FIXES.md` |
| **Production Keycloak** | Not reachable from the sandbox: apply of the new Terraform, removal of the stale flow, `ssl_required = "all"` behind Railway, login-event review for the old bypass | Owner actions in `PR-DESCRIPTION.md` |
| **Real map tiles and fonts in CI** | e2e stubs tiles (which is how the CartoDB placeholder went unnoticed). Real tiles were checked once by hand; `npm run check:tiles --workspace=frontend` is opt-in | Run `check:tiles` occasionally |
| **Firefox and WebKit** | CI runs chromium only; Firefox/WebKit were run only for `idp-flow.spec.ts` | Not planned |
| **Authenticated UI visually** | Frontend QA had no Keycloak or backend | Same as tripbuilder item |

## Known remaining test debt

- Cleared by the PR #24 batch: the 3 `waitForTimeout` and 6 `test.skip(` (`e2e-hygiene.test.ts` now fails the frontend suite if they return), the `api.spec.ts` `[404, 500]` assertion, and the `trip-edit.spec.ts` zoom_level expectation (2200c6e). The CI-mode Chromium suite reports 48 `test.fixme` at last count, each with a reason.
- `qa-sw` fails 3 tests on Firefox; CI runs Chromium only.
- Flaky under parallel load, pass alone: `qa-sw` (offline city never opened; registers and owns a build-versioned cache) and `trips` (API failure on create).
- Backend adversarial suites log `57P01` on teardown (`DROP DATABASE ... WITH (FORCE)`); tests pass.
- The backend suite needs a UTF8 cluster; on SQL_ASCII two multibyte-length tests fail.
