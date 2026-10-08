# v3.2 Traceability: requirement -> status -> commits -> tests -> summary

Rebuilt on 2026-10-04 from `git log 3c147f6..HEAD` (HEAD `33ab925`), the per-phase summaries and the code. Extended on 2026-10-08 for the PR #24 batch (`git log origin/main..HEAD`, head `2d7a734`, 89 commits; section "Post-v3.2 batch" at the end) and for the Actions results of PR #23. Rows below that changed in that update are marked (updated 2026-10-08). Phases 22-26 have no PLAN.md, and most commit subjects carry no requirement ID, so IDs were matched through the files each commit touched and the summaries. Each row was checked against the current code; the full unit suites were re-run on 2026-10-04 (backend 1524, frontend 1042, both passing).

Status vocabulary (same as `REQUIREMENTS.md`): **Complete** = implemented and proven by tests or a recorded manual check. **Partial** = part of the acceptance criteria met. **Deferred** = consciously not done. **Unverified** = implemented, a required verification has not happened.

Path shorthand in the Tests column:

- `be/` = `backend/src/`, `adv/` = `backend/tests/adversarial/`, `sys/` = `backend/tests/system/`, `fe/` = `frontend/tests/`, `e2e/` = `tests/e2e/`, `ss/` = `deploy/selfhost/tests/`
- `e2e/` specs were NOT re-run in this consolidation; the ones marked (KC) need a live Keycloak and have never run in CI. See `.planning/qa/QA-INDEX.md`.
- "none" = no automated test; the evidence column says what was checked instead.

Summary docs: `20-0x` = `phases/20-critical-security/20-0x-SUMMARY.md`, `22` = `22-reliability-bugs/22-SUMMARY.md`, `23` = `23-supply-chain-a11y/23-SUMMARY.md`, `23-QA` = `23-QA-FOLLOWUP.md`, `24-BE` / `24-E2E` = `24-arch-debt/24-BACKEND-SUMMARY.md` / `24-E2E-SUMMARY.md`, `25` = `25-biz-parity/25-SUMMARY.md`, `25-B7` = `25-BIZ07-SEC22-OTP-SUMMARY.md`, `26-IDP` / `26-APP` = `26-idp-flow/26-IDP-SUMMARY.md` / `26-APPSEC-SUMMARY.md`, `REV` / `DEMO` / `QA-BE` / `QA-FE` = `.planning/qa/REVIEW-FIXES.md` / `QA-DEMO-FIXES.md` / `QA-BACKEND-REPORT.md` / `QA-FRONTEND-REPORT.md`. PR #24 reports: `A11Y` = `qa/A11Y-LCP-FOLLOWUP.md`, `HARD` = `qa/PROD-HARDENING.md`, `SELF` = `qa/SELFHOST-REPORT.md`, `INT` = `qa/INTEGRATION-REPORT.md`, `SYS` = `qa/QA-SYSTEM-REPORT.md`, `FULL` = `qa/QA-FULLSTACK-REPORT.md`, `DEBT` = `qa/E2E-DEBT-KC-CI.md`.

## Phase 20: Critical Security (commits predate `3c147f6`)

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| SEC-01 | Complete | 68a9837 (RED test 13e9a4d) | backend/tests/otp-csprng.test.ts | 20-01 |
| SEC-02 | Complete | 1e43fcb (RED f10cc43); QA hardening e048732, de4659a, d97f6c1 | fe/widgets-xss.test.ts, fe/widgets-resilience.test.ts, fe/searchbar-xss.test.ts | 20-02, QA-FE |
| SEC-03 | Complete (relay caveat) | 1e43fcb, e048732 | fe/widgets-xss.test.ts, fe/widgets-resilience.test.ts | 20-02, 20-VERIFICATION |
| SEC-04 | Complete | 4a16ff8; fix 1b9ba1d; 5165f1d; 06a730c | fe/csp-plugin.test.ts, e2e/csp.spec.ts | 20-03, 20-CSP-FOLLOWUP |
| SEC-14 | Complete | 2d326a8 | none (Terraform removal; `grep kc_admin_client_secret terraform/` is empty) | 20-01 |

## Phase 21: Deploy & Build Safety (commits predate `3c147f6`)

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| INFRA-01 | Complete | d692f0f, d2434af; later 1a55beb, 16ba3a3 | fe/workflows.test.ts; live gating UAT (3c147f6, 21-HUMAN-UAT.md) | 21-02 |
| INFRA-02 | Complete | d692f0f, d2434af | fe/workflows.test.ts; `test-backend` job (with its Postgres service) success on Actions: PR #23 head 2200c6e and push to main ed49639 (updated 2026-10-08) | 21-02 |
| INFRA-03 | Complete | 5db0cee, facc9ed | `npm run build --workspace=backend` (`wrangler deploy --dry-run`) | 21-01 |
| INFRA-04 | Complete | d2434af | none (`wrangler` in backend/package.json devDependencies) | 21-02 |
| INFRA-05 | Complete | 451beba | none (Docker healthcheck, 21-VERIFICATION) | 21-02 |
| DEP-01 | Complete | 5db0cee | `npm audit` (21-VERIFICATION) | 21-01 |

## Phase 22: Reliability Bugs

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| BUG-01 | Complete | 47dabce | fe/trip-edit-activities.test.ts | 22 |
| BUG-02 | Complete | 77554ee | fe/client.test.ts, fe/toast.test.ts | 22 |
| BUG-03 | Complete | bd61956; follow-ups 53e4a11, 5001faf | be/db/queries/users.test.ts, adv/concurrency.test.ts | 22, 25-B7, REV |
| BUG-04 | Complete | 32048b9; refined be3551f | fe/client.test.ts, be/routes/trips.test.ts | 22, REV |
| BUG-05 | Complete | 5411620 | be/db/queries/activities.test.ts, adv/reorder.test.ts | 22 |
| BUG-06 | Complete | c1a65a0 | none (doc comment) | 22 |
| BUG-07 | Complete | 4238e40 | fe/utils.test.ts, fe/dom.test.ts | 22 |
| BUG-08 | Complete | bd61956; 5001faf | be/db/queries/users.test.ts | 22, REV |
| BUG-09 | Complete | c1a65a0 | none (doc comment) | 22 |
| BUG-10 | Complete | 98c9294 | none (SETUP.md line 83 shows `worker_client_secret`) | 22 |
| BUG-11 | Complete | 4763244 | fe/trip-edit-activities.test.ts | 22 |
| BUG-12 | Complete | cea0fe5 | fe/geocoder.test.ts | 22 |
| BUG-13 | Complete | 8c625aa | none (`tsc --noEmit`) | 22 |
| BUG-14 | Complete | f898b7b | be/db/queries/trips.test.ts | 22 |
| BUG-15 | Complete | 2aaa6ca | be/routes/public.test.ts | 22 |
| BUG-16 | Complete | c244061; made atomic by 6f7990f | be/routes/auth-otp-cap.test.ts, be/db/queries/otp-issue.test.ts, adv/otp.test.ts | 22, 25-B7 |

## Phase 23: Supply Chain, Secrets & Accessibility

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| SEC-15 | Complete | 951ce1b | fe/supply-chain-a11y.test.ts, e2e/csp.spec.ts | 23 |
| SEC-16 | Complete | ba7bee8; d439e21, 46cbdbf, f129b67 | fe/supply-chain-a11y.test.ts, fe/sw-precache.test.ts, fe/sw-resilience.test.ts, e2e/qa-sw.spec.ts | 23, QA-FE, REV |
| INFRA-06 | Complete | ba7bee8 | fe/supply-chain-a11y.test.ts | 23 |
| DEP-02 | Partial | 5938fdf | none (`.gitleaksignore`, `docs/security/gitleaks-triage.md`); rotation unverified | 23 |
| DEP-03 | Complete | 264ee9e, 1a55beb; 2200c6e (two fixture fingerprints in `.gitleaksignore`) | fe/workflows.test.ts (YAML shape); `scripts/a11y-axe.mjs`; Actions: `gitleaks` and `accessibility` success on 2200c6e and on the push to main ed49639 (updated 2026-10-08) | 23, REV |
| A11Y-01 | Complete | fa14817 | fe/supply-chain-a11y.test.ts | 23 |
| A11Y-02 | Complete | 02430a7, a4e13c6; a223eff, 9f4426b, 78c96ef | fe/css-tokens.test.ts, e2e/accessibility.spec.ts, `scripts/a11y-axe.mjs` | 23, 23-QA |
| A11Y-03 | Complete | fa14817 | fe/supply-chain-a11y.test.ts | 23 |
| A11Y-04 | Complete | 02430a7, 5927313 (map names); 8de5e7f (declutter), e1e2782, 944c9e1 (updated 2026-10-08) | fe/map-aria-label.test.ts, fe/declutter.test.ts, e2e/lcp-target-size.spec.ts; axe 0 violations, Lighthouse a11y tokyo 1.00 (local) | 23, A11Y |
| A11Y-05 | Complete | a4e13c6, 59ed1d5; 1442d93 (no opacity gate, preloaded hero), edbc6b2 (lazy Leaflet), 973c9b1 (badge contrast), e1e2782 (updated 2026-10-08) | fe/lcp-budget.test.ts, fe/supply-chain-a11y.test.ts, e2e/lcp-target-size.spec.ts; LCP 5415 to 1304 ms (sandbox) | 23, A11Y |

## Phase 24: Architecture Debt & Test Coverage

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| ARCH-01 | Complete | e7de9f8 | be/db/index.test.ts | 24-BE |
| ARCH-02 | Complete | 7ef225e | be/middleware/db.test.ts, be/db/index.test.ts | 24-BE |
| ARCH-03 | Complete | f1c16c5 | be/routes/trips.test.ts, be/db/queries/ownership.test.ts | 24-BE |
| ARCH-05 | Complete | 10ce376, ef7325f, 4f3e784, a96c935 | be/validation/schemas.test.ts, be/routes/trips-validation.test.ts, be/routes/coordinates.test.ts | 25 |
| ARCH-06 | Complete | 1d1eeb9 | whole backend suite via `be/test-utils/global-setup.ts`; be/db/migrations.test.ts; `test-backend` with the `postgres:16-alpine` service success on Actions (2200c6e, ed49639) (updated 2026-10-08) | 24-BE |
| ARCH-07 | Complete (see residue) | ada2976, a78ced0, 06a03b8, 65fe3e7, 5216f19 | e2e/trip-edit.spec.ts, e2e/trips.spec.ts, e2e/search.spec.ts and others; residue: 3 `waitForTimeout`, 6 `test.skip(` in specs added later | 24-E2E |
| ARCH-08 | Complete | 02aa073 | e2e/idp-config.spec.ts | 26-IDP |
| ARCH-09 | Complete | 2fa0560, fc45438, 3c1fadc; 2200c6e (last expectation) | e2e/auth.spec.ts, trips.spec.ts, ui-consistency.spec.ts, trip-edit.spec.ts, fixtures/mockKeycloak.ts; `e2e` job success on Actions: 2200c6e and push to main ed49639 (updated 2026-10-08) | 24-E2E |
| M-01 | Complete | 6e77f9c | be/middleware/db.test.ts, adv/concurrency.test.ts | 24-BE |
| M-02 | Complete | b22fe08 | be/db/queries/ownership.test.ts | 24-BE |
| M-09 | Complete | 229fdd2, 5441e5d, 9cc9efe, 0489b0a | be/middleware/errors.test.ts, adv/input-fuzz.test.ts | 24-BE, QA-BE |
| PWA-01 | Complete | 89f060a | fe/pwa-icons.test.ts, e2e/pwa.spec.ts | 24-BE |
| DATA-01 | Complete | bb4a8b3 | be/db/queries/otp.test.ts, be/db/migrations.test.ts | 24-BE |
| DATA-02 | Complete | 9550f3e; 53e4a11 | be/db/migrations.test.ts, be/routes/users.test.ts, be/db/queries/users.test.ts | 24-BE |
| DATA-03 | Complete | 23fc348 | be/db/migrations.test.ts, be/routes/coordinates.test.ts | 24-BE |
| DATA-04 (extra) | Complete | 623917b | be/db/migrations.test.ts, adv/concurrency.test.ts | 24-BE |

## Phase 25: Business Logic & Demo Parity

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| BIZ-01 | Complete | 0583db1, cc5bcac, c380beb | fe/trip-edit-activity-form.test.ts, fe/tripAdapter.test.ts | 25 |
| BIZ-02 | Complete | aa55817, 0583db1 | be/validation/schemas.test.ts, fe/trip-edit-activity-form.test.ts | 25 |
| BIZ-03 | Complete | cc5bcac, 4612e2f, 0583db1 | fe/tripAdapter.test.ts, fe/tripDetail-view.test.ts | 25 |
| BIZ-04 | Complete | cc5bcac, 4612e2f | fe/tripAdapter.test.ts, fe/tripDetail-view.test.ts | 25 |
| BIZ-05 | Complete | e98cd93, cc5bcac | fe/trip-edit-destination-form.test.ts, fe/tripAdapter.test.ts | 25 |
| BIZ-06 | Complete | 10ce376, e98cd93, 7919cc2 | be/validation/schemas.test.ts, be/routes/trips-validation.test.ts, fe/trip-edit-destination-form.test.ts, fe/trip-edit-hotel-metadata-form.test.ts | 25 |
| BIZ-07 | Complete | 6943edd, 5e4c537, 3239c24, d8477f8 | be/routes/trips-date-coherence.test.ts, be/db/migrations.test.ts, adv/input-fuzz.test.ts, adv/concurrency.test.ts, fe/trip-edit-days.test.ts | 25-B7 |
| BIZ-08 | Complete | ef7325f | be/routes/coordinates.test.ts, be/validation/schemas.test.ts, adv/input-fuzz.test.ts | 25 |
| BIZ-09 | Complete | 4f3e784, a96c935 | be/validation/schemas.test.ts, be/routes/trips-validation.test.ts | 25 |
| BIZ-10 | Complete | 33157d1, c380beb | fe/i18n-residue.test.ts | 25 |
| BIZ-11 | Complete | 0a6c0d6, 2bee303 | fe/dates.test.ts, fe/widgets-weather.test.ts, fe/tripAdapter.test.ts | 25 |

## Phase 26: Remaining Security Hardening & IdP Flow

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| SEC-05 | Complete | d874ba2 | be/auth/keycloak-jwks-cooldown.test.ts, adv/auth-jwt.test.ts | 26-APP |
| SEC-06 | Complete | 3f3abe7 | be/middleware/auth.test.ts, adv/auth-jwt.test.ts | 26-APP |
| SEC-07 | Complete | 7e5d975, b50ca9e, 6f7990f | be/db/queries/otp-attempts.test.ts, be/routes/auth-otp-verify.test.ts, be/db/queries/otp-issue.test.ts, adv/otp.test.ts | 26-APP, 25-B7 |
| SEC-08 | Complete | 6f86b57 | be/auth/otp-email.test.ts, adv/otp.test.ts | 26-APP |
| SEC-09 | Complete | 3b5d071 | fe/passkey-list-xss.test.ts | 26-APP |
| SEC-10 | Complete | d97f6c1, de4659a | fe/search-highlight-xss.test.ts, fe/searchbar-xss.test.ts | 26-APP |
| SEC-11 | Complete | 33362a8 | e2e/idp-config.spec.ts (static), e2e/idp-theme.spec.ts (KC) | 26-IDP |
| SEC-12 | Complete | de2d7a6, 93ecc49, 8740a6e, 1a6f22a | e2e/idp-flow.spec.ts (KC), e2e/idp-config.spec.ts | 26-IDP |
| SEC-13 | Complete | b6018de, 02aa073 | e2e/idp-config.spec.ts | 26-IDP |
| SEC-17 | Partial | 9b59034; 8b4c4ca (production profile requires `ssl_required = all`) (updated 2026-10-08) | e2e/idp-config.spec.ts (negative plan checks), e2e/idp-hardening.spec.ts (live); realm dump `sslRequired=all`; real Funnel chain and Railway not validated | 26-IDP, HARD |
| SEC-18 | Complete | 7dbb9b2, 070af9c; ec2f546 (`NOMINATIM_USER_AGENT`) (updated 2026-10-08) | adv/geocode.test.ts, fe/geocoder-proxy.test.ts, fe/csp-plugin.test.ts | HARD, INT |
| SEC-19 | Complete | bdf341d | e2e/idp-config.spec.ts | 26-IDP |
| SEC-20 | Complete | a16b385 | be/middleware/security.test.ts, adv/cors-headers.test.ts | 26-APP |
| SEC-21 | Complete | 53cf540 | be/db/queries/trips-public.test.ts | 26-APP |
| SEC-22 | Complete | ea1f511 | be/routes/trips.test.ts, be/db/queries/ownership.test.ts, adv/idor.test.ts | 25-B7 |
| SEC-23 | Complete | 0e33b25; 0325e75 (origin typo), 9417514 (env-driven allow-list) (updated 2026-10-08) | be/middleware/cors.test.ts, be/middleware/cors-allowlist.test.ts, be/config/deploy-defaults.test.ts, adv/cors-headers.test.ts | 26-APP, HARD |
| SEC-24 | Complete | 3697b47 | be/routes/health.test.ts | 26-APP |
| SEC-25 | Complete | 111b910 | e2e/idp-config.spec.ts | 26-IDP |
| KC-01 | Complete | de2d7a6, b6018de, 33362a8 | e2e/idp-flow.spec.ts (KC), e2e/idp-config.spec.ts | 26-IDP |

## Post-v3.2 batch (PR #24): new requirement rows

Commits: `git log origin/main..HEAD` (89, 2026-10-04 to 2026-10-08). Test files below were checked to exist in the tree; counts are the reports' figures, not re-run here.

| ID | Status | Key commits | Tests | Report |
|----|--------|-------------|-------|--------|
| PROD-01 | Partial | 95c1814 (Node entry), 0844fcc (pool limits), 9eecc99 (images), 41f4b5b (compose + proxy), 4ca3d4e (deploy / apply / backup / restore), dca90c1 (bootstrap, funnel, status, update, timer), a254a98 (SMTP provider), 334fd59 + 334b6e2 (stack check script, scripts in CI), f3d4a5b (no-op redeploys, Keycloak after DB restart), a68aacf (guide), 7c36ca1 (bootstrap wiring), 2b3e8fe, d24fd98, 8fb877f (add-user.sh) | ss/scripts.test.sh (52), ss/stack-e2e.sh (40 on a fresh stack), be/node/bootstrap.test.ts, be/node/config.test.ts; `docs/SELF-HOSTING.md`; real Funnel, Gmail, passkeys not validated | SELF, INT |
| PROD-02 | Complete | 0325e75 (origin typo), 9417514 (CORS), cfea1b2 (access tokens only), 188529c (rate limits), a254a98 (SMTP), 5dc48ad (JSON logs), 4231f74 (HSTS, API CSP), 8b4c4ca + a01ab25 + 658502c (Keycloak production profile, login messages, operator docs), 7dbb9b2 (geocode) | be/config/deploy-defaults.test.ts, be/middleware/cors-allowlist.test.ts, be/auth/keycloak-token-type.test.ts, be/middleware/client-ip.test.ts, be/middleware/rate-limit.test.ts, adv/rate-limit.test.ts, be/email/smtp.test.ts, adv/otp-smtp.test.ts, be/observability/logger.test.ts, adv/log-hygiene.test.ts, be/middleware/security-https.test.ts, e2e/idp-hardening.spec.ts (live Keycloak), e2e/idp-config.spec.ts | HARD |
| PROD-03 | Complete | bda9027 | fe/auth-redirect.test.ts (23), e2e/auth-return-to.spec.ts (`@qa-noauth`), fe/trip-edit-auth.test.ts | INT |
| PROD-04 | Complete (emulator) | 297dba5 (migration 0010; test 1f8c9e0), e8b2d5a (preflight; test 4964118), ad852aa + dfd844c + 6a9896b (readiness), f2a3edb (pool listener), b4a4807 (Neon HTTP harness), 80a4951, 3ec45fd | sys/upgrade-path.test.ts, sys/deploy-pipeline.test.ts, sys/neon-http.test.ts, sys/cross-phase.test.ts, sys/property.test.ts, be/routes/health-ready.test.ts | SYS, INT |
| QA-01 | Unverified | 253cd65 (hygiene guard), ab32953, a0ebd48, 40735a7 (pacer), d427494 (Keycloak CI job), 51a0442, 086bc43, 2777b3a (provider hashes) | fe/e2e-hygiene.test.ts, fe/workflows.test.ts (12 cases for the job); `scripts/ci/keycloak-flow.sh` local runs 51 passed / 5 fixme; `Keycloak flow` workflow not concluded on Actions | DEBT, INT |

## Post-v3.2 batch: extra changes

| Item | Commit | Test |
|------|--------|------|
| Real-auth e2e: passkeys.spec left a passkey on the seeded user | 732ff25 | e2e/passkeys.spec.ts (real stack) |
| Real-auth e2e: Keycloak re-authentication prompt | 1e2b437 | e2e/passkeys.spec.ts |
| Real-auth e2e: OTP test raced the passkey-campaign redirect | f62137a | e2e/otp.spec.ts |
| Real-auth e2e: post-enrolment redirect wait | 6bac5b0 | e2e/idp-flow.spec.ts |
| trip-edit-integration was `fixme(true)` and leaked rows | 82f166a | e2e/trip-edit-integration.spec.ts |
| uat-passkeys runnable on a Terraform realm | 101eb29 | root `uat-passkeys.spec.ts` |
| `.env.test` quoting warning, `frontend/.env.example` API URL | 567583e, 6224459 | none (docs) |
| Cross-check for a missing public trip returning exactly 404 | a0ebd48 | e2e/api.spec.ts |
| Access log opt-in | 05fc94e | be/node tests |
| Keycloak provider hashes for linux and macOS | 2777b3a | CI job `init -lockfile=readonly` |
| Geocoder backlog test order independence | 0567509 | adv/geocode.test.ts |
| Reports and docs | 944c9e1, b3424c8, beb2cce, e575059, 7189eb0, 9534149, c5a301a, 77b1769, fe6cfc9, 3990641 | none |
| Reverted: `schema_out_of_date` guard | 1919b1e, d335705 | superseded by PR #23's schema guard |

Merge commits of the batch: 941e44b (A11Y), c3f4c31 (real-auth QA), eb62969 (system QA), bd38f77 (e2e hygiene and CI job), 0d99c06 (self-hosting), 0b8271b (hardening), 2d7a734 (integration).

## Extra changes not in the original requirements

### Adversarial backend QA (`QA-BE`)

| Item | Commit | Test |
|------|--------|------|
| Suite added (8 files) | f8e5ca9, d11849b (report), 1f10fe1 | adv/*.test.ts |
| F1 malformed JSON gave 500 | 0489b0a | adv/input-fuzz.test.ts |
| F2 request body cap 1 MB | ff22d8e | adv/input-fuzz.test.ts |
| F3 path ids with aliases (`0x1`, `1e0`) | 18fc941 | be/validation/ids.test.ts |
| F4 JWT `exp`/`nbf` not numeric | c878f04 | adv/auth-jwt.test.ts |
| F5 long or NUL display name locked the user out | 0267ea5 | adv/auth-jwt.test.ts |
| F6 JWT claims decoded without UTF-8 | 911882f | adv/auth-jwt.test.ts |
| F7 `javascript:` URLs accepted | 288977f | adv/input-fuzz.test.ts |
| F8 NUL characters | d2a0e9b | adv/input-fuzz.test.ts |
| F9 year 0000 dates | 094d492 | adv/input-fuzz.test.ts |
| F10 `order_index` over int4 | b056553 | adv/input-fuzz.test.ts |
| F11 unbounded `preferences` | 758eddf | adv/input-fuzz.test.ts |
| Flaky BUG-03 test (same-subject email race) | 53e4a11 | adv/concurrency.test.ts |
| PATCH of a target deleted mid-request gave 500 | d8477f8 | be/routes/trips-date-coherence.test.ts |

### Frontend QA and follow-up (`QA-FE`, `23-QA`)

| Item | Commit | Test |
|------|--------|------|
| Blocked `localStorage` broke map init | 5c74925 | fe/qa-resilience.test.ts |
| Offline PWA precache missing JS/CSS | f129b67 | fe/sw-precache.test.ts, e2e/qa-sw.spec.ts |
| Search returned items for gibberish | 8da845a | fe/search-relevance.test.ts |
| Search dropdown XSS from API data | de4659a | fe/searchbar-xss.test.ts |
| Weather/RSS garbage payloads and unsafe links | e048732 | fe/widgets-resilience.test.ts |
| No-auth e2e specs | eb3b0ef, 6f4c66a, 1ef4c81 | e2e/qa-frontend.spec.ts, e2e/qa-followup.spec.ts |
| Dark landing cards (undefined CSS vars) | a223eff, 9f4426b | fe/css-tokens.test.ts |
| Floating search button covered content | 948668d | fe/searchbar-layout.test.ts |
| Landing hang with Keycloak down; error/retry states | 8f81766, 6099e4f | fe/auth-init.test.ts, fe/auth-status-ui.test.ts, fe/dashboard-auth.test.ts |
| Double-click created two trips | e6cb2de | fe/dashboard-create-trip.test.ts |
| OTP requests used a page-relative URL | bdc6a9e | fe/otp-api-url.test.ts |
| Navbar Sign in contrast; axe on settled auth states | 78c96ef | scripts/a11y-axe.mjs |
| Map aria-label on every city page | 5927313 | fe/map-aria-label.test.ts |
| Search button kept in flow, search e2e updated | 948668d, 3c1fadc | e2e/search.spec.ts |

### Demo regressions (`DEMO`)

| Item | Commit | Test |
|------|--------|------|
| CartoDB API-key tiles replaced by OpenStreetMap | 75f549c | fe/tile-provider.test.ts, fe/tile-guard.test.ts, e2e/map-tiles.spec.ts |
| OSM usage rules documented | df8c2ef | none (docs) |
| Overview map and Cities list restored | bb7bb28 | fe/overview-map.test.ts, e2e/overview-map.spec.ts |
| Minute-based minimalist countdown | 7482082 | fe/countdown.test.ts |
| Report and screenshots | cec98d8 | none |

### Review fixes (`REV`)

| Finding | Commit | Test |
|---------|--------|------|
| M1 migrate before deploy | 16ba3a3, aa2ef99, 5a64014 | fe/workflows.test.ts, be/db/preflight.test.ts, be/db/schema-guard.test.ts |
| M2 same-repo deploys, pinned actions | 1a55beb | fe/workflows.test.ts |
| S1 trip-edit survives slow Keycloak | c4bfc51 | fe/trip-edit-auth.test.ts |
| S2 SELECT before INSERT on every request | 5001faf | be/db/queries/users.test.ts |
| S5 production-safe `import.sh` | f097ad1 | terraform/keycloak/tests/import.test.sh |
| N1 `hotel_not_found` code | be3551f | fe/client.test.ts, be/routes/trips.test.ts |
| N6 CSP fails the build on missing origins | 5165f1d | fe/csp-plugin.test.ts, fe/workflows.test.ts |
| N7 service worker resilience | d439e21, 46cbdbf | fe/sw-resilience.test.ts, fe/pwa-icons.test.ts |
| N3 swapped lat/lng caveat for 0006 | a4a6775 | none (backend/src/db/README.md) |
| Owner actions, Neon checklist, CSP origin docs | a4a6775, d247aef, ec25a02 | none |
| S3 CI Keycloak job | not built | proposal in REV |
| S4 Neon HTTP smoke test | not run | `.planning/qa/NEON-SMOKE-CHECKLIST.md` |

### Other

- `a7a0bf6`, `89afe33`, `5788eb1`, `ebbed52`, `9e8e50f`, `13062f3`, `8733c46`: phase documentation commits.
- `feb5f5e`: `terraform fmt` of the Keycloak module.
- `5ad817c`: static Keycloak/theme invariant spec, also covers SEC-11/13/19/25.
- Actions evidence for PR #23 and the push to main is from the GitHub check-runs API (checked 2026-10-08), not from a commit: head `2200c6e` had `e2e`, `accessibility`, `gitleaks`, `test-backend`, `test-frontend`, `test-scripts`, `typecheck-frontend`, `typecheck-backend`, `build-backend` and the Vercel preview comments check all successful; `ed49639` had the same plus `deploy` and `build-and-deploy`.
