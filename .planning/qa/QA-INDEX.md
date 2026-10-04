# QA index: what was checked, and what was not

Read this before approving the v3.2 PR. It lists every QA artifact, what it covers, and the verification gaps. Requirement-level evidence is in `.planning/phases/TRACEABILITY.md`.

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

## Re-verified on 2026-10-04 (this consolidation)

- `tsc --noEmit` backend and frontend: clean.
- `npm test --workspace=backend` on a real Postgres 16 (UTF8): 43 files, 1524 tests passed.
- `npm run test:run --workspace=frontend`: 47 files, 1042 tests passed, also under `TZ=America/Argentina/Buenos_Aires`.
- `vite build` with API and Keycloak origins: OK, CSP meta present in 13 of 14 pages (not in `silent-check-sso.html`).
- Not re-run: Playwright, Terraform, Keycloak, Lighthouse/axe, `wrangler deploy --dry-run`.

## What was NOT verified

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

- 3 `waitForTimeout` and 6 `test.skip(` in newer specs (`idp-flow`, `idp-config`, `qa-sw`, `overview-map`, `qa-frontend`); 24 `test.fixme` in total.
- `tests/e2e/api.spec.ts:61` still asserts `[404, 500]`.
- `tests/e2e/trip-edit.spec.ts:260` expects a destination POST body without `zoom_level`, which `destinations.ts` always sends.
- Backend adversarial suites log `57P01` on teardown (`DROP DATABASE ... WITH (FORCE)`); tests pass.
- The backend suite needs a UTF8 cluster; on SQL_ASCII two multibyte-length tests fail.
