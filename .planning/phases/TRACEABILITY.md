# v3.2 Traceability: requirement -> status -> commits -> tests -> summary

Rebuilt on 2026-10-04 from `git log 3c147f6..HEAD` (HEAD `33ab925`), the per-phase summaries and the code. Extended on 2026-10-08 for the PR #24 batch (`git log origin/main..HEAD`, head `2d7a734`, 89 commits; section "Post-v3.2 batch" at the end) and for the Actions results of PR #23. Extended again on 2026-10-08 for the registration batch (`git log --oneline origin/main..HEAD`, 53 commits after `d2dd404`, head `f581d45`; section "Registration batch" at the end; summaries `REG-IDP` / `REG-BE` / `REG-UI` / `REG-INT` = `qa/REGISTRATION-{IDP,BACKEND,UI,INTEGRATION}-REPORT.md`). Extended on 2026-10-09 with the v3.3 section (UX-* via PR #27, UX-MOB-01 via PR #28, PKF-01..04 via PR #29 `38b9108`, UX-NAV-02 and TEST-PARITY-01 via PR #30 `432aba5`, UX-KC-04 in PR #31; commits from `git log 6d4c4f1..460a449` and `460a449..HEAD` of the integration branch). Rows below that changed in that update are marked (updated 2026-10-08). Phases 22-26 have no PLAN.md, and most commit subjects carry no requirement ID, so IDs were matched through the files each commit touched and the summaries. Each row was checked against the current code; the full unit suites were re-run on 2026-10-04 (backend 1524, frontend 1042, both passing).

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
| SEC-25 | Complete | 111b910; ded6f2f (mapper pin `add_to_token_introspection=false` kept across the provider bump, see PKF-04; updated 2026-10-09) | e2e/idp-config.spec.ts | 26-IDP |
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

## Registration batch (REG-01..07; 53 commits after `d2dd404`, 2026-10-08)

Merge commits: cde9023 (IdP), 91be138 (UI), ae6c03b (backend), f26a235 (integration). Tests are files that exist in the tree; counts are the reports' figures, not re-run. `tf/` = `terraform/keycloak/tests/`.

| ID | Status | Key commits | Tests | Summary |
|----|--------|-------------|-------|---------|
| REG-01 | Unverified | 4649ea4, bd34659, 74d7556, 6aa71a6, 06fa511, fc85bc6, cfe23b4 | tf/guards.tftest.hcl (23 runs), e2e/idp-registration.spec.ts, e2e/idp-config.spec.ts (KC) | REG-IDP |
| REG-02 | Complete | 995bab6, 85f9824, 0c26e86, 5dc6c7a, dd13730 / f017a77 (`onboarding.is_new`) | be/routes/email-verify.test.ts, be/config/verified-email.test.ts, be/db/migrations.test.ts, be/db/schema-guard.test.ts, adv/email-verification.test.ts, sys/upgrade-path.test.ts | REG-BE |
| REG-03 | Complete | fdb3395, b6463b8, 86c5512 | adv/recovery.test.ts, be/auth/password-policy.test.ts, e2e/idp-registration.spec.ts (#7-#9), e2e/registration-integration.spec.ts (#4), ss/stack-e2e.sh `recover` | REG-BE, REG-INT |
| REG-04 | Complete | ea9662b, c2e9b36, 2e63d60, 64c1269, 074e7e1, 31e4472, f0c51f1, 912970b, c931572, a706211, f507242 | fe/verify-email.test.ts, fe/passkey-onboarding.test.ts, fe/dashboard-onboarding.test.ts, fe/recover-view.test.ts, fe/recover-page.test.ts, fe/password-backup.test.ts, fe/password-rules.test.ts, fe/auth-gate.test.ts, fe/registration.test.ts, e2e/registration-ui.spec.ts, e2e/registration-ui-a11y.spec.ts | REG-UI |
| REG-05 | Complete | 17a2493, b061473 | e2e/idp-flow.spec.ts (KC), e2e/registration-integration.spec.ts (#4) | REG-IDP |
| REG-06 | Partial | a85ed2f, 4649ea4, 3160610, 003f15f, 823c180 | ss/purge-unverified.test.sh (34), ss/scripts.test.sh, tf/guards.tftest.hcl; no test for a sign-up throttle (not built) | REG-IDP |
| REG-07 | Unverified | d12959b, b775454, 8c70a4d, 7425a2d, b431ae3, f8c6026, 4c32341, 5b1544c, 59a0c8d, f3845e1 | be/routes/auth-flows-contract.test.ts, fe/auth-flows-contract.test.ts (both read `contracts/auth-flows.json`), e2e/registration-integration.spec.ts, e2e/idp-registration.spec.ts, fe/workflows.test.ts | REG-INT |

Other commits of the batch: 5c4fa67, b0fef8d, f3845e1 (reports and screenshots); b29ee1a (UI Playwright, REG-04); 607b4b3 (duplicate block after merging two onboarding branches); 3367cc6 (revert; compose env left to the backend); f581d45 (`.gitleaksignore` for the reCAPTCHA test-key fixtures in the guard tests).

Bugs the integration run found and fixed: recovery token without roles (b6463b8), `max_attempts` shown as a wait (d12959b), dev server dropping env variables (59a0c8d), a wrong recovery e2e assumption (8c70a4d).

## v3.3 UX & Product Polish (UX-*, UX-MOB-01, PKF-01..04, UX-KC-04, UX-NAV-02, TEST-PARITY-01, and the Phase 34 residual items; 2026-10-08 to 2026-10-09)

Shipped in six pieces: PR #27 (merged to `main` as `c7d54dc`; the seven owner-reported UX-* items), PR #28 (merged as `460a449`; UX-MOB-01), PR #29 (merged as `38b9108`; PKF-01..04, plus the v3.3 close-out docs and the Navbar XSS regression test), PR #30 (merged as `432aba5`; UX-NAV-02, TEST-PARITY-01) PR #31 (merged as `7b22618`; UX-KC-04) and PR #32 (pending; the seven Phase 34 residual items). Acceptance criteria per ID are in `REQUIREMENTS.md` (section "v3.3"); QA evidence and CI lessons in `qa/UX-REPORT.md`. `fe/` unit specs are jsdom/vitest; `tf/` = `terraform/keycloak/tests/`. Screenshot sets: `.planning/qa/screens-theme/` (Keycloak screens and `passkey-first/`), `docs/design/trip-view-screens/`, `docs/design/trip-creation-screens/`, `docs/design/mobile-screens/`. The agents' worktree merge commits are not listed.

### PR #27 (`c7d54dc`)

| ID | Status | Phase | Key commits | Tests | Summary |
|----|--------|-------|-------------|-------|---------|
| UX-KC-01 | Complete | 27 | d1e126e (theme on the base theme, no PatternFly, one flat card), d1e33f0 (focus ring on the stock checkbox), a26915c (screens), ee45857 (SEC-11 `kcSanitize` on `ssoLoginInOtherTabsUrl`) | e2e/idp-theme-static.spec.ts, e2e/idp-theme-render.spec.ts (real 26.6.1 HTML snapshots; light/dark x 375/1280; one card, 44px targets, contrast, focus, axe), e2e/idp-theme.spec.ts (KC), e2e/idp-config.spec.ts; `e2e/fixtures/idp-theme/capture.mjs` regenerates the snapshots | `qa/UX-REPORT.md`, `.planning/qa/screens-theme/`. Removed the dead `verify-email.ftl` and the `login-otp.ftl` that dropped the credential picker |
| UX-KC-02 | Complete | 27 | 17971b6 (label such as "Chrome on Android (2026-10-08)" from `userAgentData` / user agent, fallback "Passkey (date)", hidden `authenticatorLabel` field), 0534c2b | e2e/idp-theme-static.spec.ts (UA table and edge cases: empty, unknown, hostile, very long, unicode, surrogate pairs), e2e/idp-theme.spec.ts (stored label comes from the device) | Pure function in `keycloak/themes/japan-trip/login/resources/js/passkey-label.js`. Non-Chromium browsers not run |
| UX-KC-03 | Complete | 27 | c8280df (production client `root_url` / `base_url` from `config/deploy-defaults.json`; loopback guard in `terraform/keycloak/main.tf` and `keycloak-apply.sh`) | tf/guards.tftest.hcl, ss/scripts.test.sh, e2e/idp-theme.spec.ts (error-page link), e2e/idp-theme-static.spec.ts (no localhost fallback in templates) | The theme footer link uses only the client Base URL. Production still needs the image redeploy (operator) |
| UX-NAV-01 | Complete | 28 | 98caa8f (Home link carries `?home`; signed-in users stay on the landing), 52dffee (drop a fixed sleep) | fe/auth-redirect.test.ts, fe/auth-status-ui.test.ts, e2e/home-link.spec.ts | Post-login return-to (PROD-03) and the `?code=` callback untouched |
| UX-SEARCH-01 | Complete | 28 | a0d1c8d (scope resolution), 17f0ee5 (own-trips index: shared load, TTL cache, timeouts, invalidation), cbf723b (scope-aware box with loading/error/empty), 36f63fa (e2e), a2d8ecc (hint row at 375px), dbe7782 (search bar in the editor) | fe/search-scope.test.ts, fe/user-search-index.test.ts, fe/searchbar-scope.test.ts, fe/search-user-ranking.test.ts, fe/search-highlight-xss.test.ts, e2e/search-scope.spec.ts, e2e/search.spec.ts | User trips on dashboard/trip/profile, demo data elsewhere. Known gap: deep link to a day/activity is ignored by `tripDetail.ts` |
| UX-TRIP-01 | Complete | 29 | a9008b4 (logic layer), 578d531 (guided editor: Trip, Route, Share steps, live demo-style preview, autosave queue, undo, place search by text / Google Maps link / dropped pin), da62653 (e2e), ad89ef8 (jsdom views, sticky opaque save banner, design screens), dbe7782 | fe/trip-edit-model.test.ts, fe/trip-edit-store.test.ts, fe/trip-edit-saveQueue.test.ts, fe/trip-edit-placeSearch.test.ts, fe/trip-edit-views.test.ts, fe/trip-edit-nav-sortable.test.ts, fe/trip-edit-auth.test.ts, e2e/trip-edit.spec.ts, e2e/trip-edit-resilience.spec.ts (XSS strings, 0/1/60 days, 200 places, geocoder down/slow, 500/422/409, offline, double submit, undo, reorder), e2e/new-user-trip-creation.spec.ts, e2e/trip-edit-integration.spec.ts (needs a backend) | `docs/design/TRIP-CREATION-UX.md`, `docs/design/trip-creation-screens/`. Also fixed the missing `order_index` bug. Known gaps: landscape editor cramped (tightened later by 4ff7fec), drop-a-pin hint says "Click ... Esc" |
| UX-TRIP-02 | Complete | 30 | 5f47b90 (pure helpers, reusable overview map), a2c8548 (saved trip like the demo), 6a17ed8 (My Trips cards with loading and error), 2c937fa (e2e) | fe/trip-view.test.ts, fe/trip-cards.test.ts, fe/dashboard-trips-states.test.ts, fe/trip-detail-escaping.test.ts, e2e/trip-view.spec.ts, e2e/dashboard-trips.spec.ts, e2e/trips.spec.ts | `docs/design/trip-view-screens/`. Navbar stored-XSS fixed in the same PR (city labels escaped in `Navbar.ts`, 2c937fa, dbe7782). Popup and card escaping is unit-tested (`trip-detail-escaping`, XSS strings in `trip-view.spec.ts`); the Navbar escape has its own regression test (`frontend/tests/signup-entry-points.test.ts`, "city names are user input", merged in PR #29), verified to fail without the fix. Known gap: weather/news widgets are not on the trip city view |

CI fixes needed before PR #27 went green (`qa/UX-REPORT.md`, "CI lessons"): 555baa0 and dbe7782 (`test.fixme` with a reason instead of a silent skip, as the ARCH-07 guard requires), ee45857 (SEC-11 template fix and an e-mail code test racing the app load), 39ca51d (ambiguous `Sign in` submit selector, now by id), 9857701 (stale expectations: new trips open the guided editor, Home carries `?home`, trip page opens in the matched city view; two racy specs), 04a3f48 (poll for the e-mail code response in the sign-up integration spec), a3e443e (keep the app from loading in the remaining e-mail code tests), d5ca9b3 (a worktree `tests/node_modules` symlink committed by accident).

### PR #28 (`460a449`)

| ID | Status | Phase | Key commits | Tests | Summary |
|----|--------|-------|-------------|-------|---------|
| UX-MOB-01 | Complete | 31 | 9751b2c (44px coarse-pointer targets, 16px fields), 3cb1425 (Playwright projects `mobile` iPhone 13 and `mobile-android` Pixel 7, layout sweep), 8ba6797 (one-finger map pan off, two-finger hint, bigger zoom/marker hit areas), 1103e0a (navbar/search shadow-DOM sizing, city links row, search clear, 44px OTP boxes, `100dvh`, safe-area snackbar, manifest orientation unlocked), dcdb793 (touch, platform and screenshot specs), 4ff7fec (coverage doc, `e2e-mobile` CI job, landscape editor, navbar wraps below 400px) | e2e/mobile-layout.spec.ts, e2e/mobile-touch.spec.ts, e2e/mobile-platform.spec.ts, e2e/mobile-screens.spec.ts (only with `MOBILE_SCREENSHOTS`), fe/map-touch-gestures.test.ts; `ci.yml` job `e2e-mobile` | `docs/design/MOBILE-COVERAGE.md` (matrix), `docs/design/mobile-screens/`. Chromium only. Not covered, real device only: iOS Safari focus zoom and toolbar, keyboard overlap, installed PWA, a real swipe over the map, WebAuthn prompts, OTP autofill; WebKit run not done |

### PR #29 (`38b9108`), passkey-first login

Evidence: `docs/design/PASSKEY-FIRST-LOGIN.md`, `.planning/qa/screens-theme/passkey-first/` (plain / prompting / dismissed, light/dark x 375/1280), operator steps in `docs/SELF-HOSTING.md`. All verified on Keycloak 26.6.1 with a Chromium virtual authenticator.

| ID | Status | Phase | Key commits | Tests | Summary |
|----|--------|-------|-------------|-------|---------|
| PKF-01 | Complete | 32 | ded6f2f (realm passkeys on), 86f4edf (marker, auto prompt, "Sign in with a passkey" button, autofill) | e2e/idp-passkey-first.spec.ts (KC: (a) autofill sign-in, (b) auto prompt with no username posted and one POST, (c) cancel without loop, (f) no WebAuthn), e2e/idp-passkey-first-render.spec.ts (plain / prompting / dismissed, light/dark, 375/1280, axe, iframe, reload, keyboard) | Plain page without JS or WebAuthn. Unverified: real Face ID / Touch ID / Android biometrics, Safari and iOS user-gesture rule for modal `get()`, Firefox, hybrid (QR) passkeys, the `immediate` mediation (guessed from a draft; a missing passkey then looks like a cancel and the two-miss rule applies) |
| PKF-02 | Complete | 32 | 86f4edf, 0a66df3, 9353b96 | e2e/idp-passkey-first-unit.spec.ts (set/read/expire/clear/corrupt, storage off, Safari-like expiry), e2e/idp-passkey-first-static.spec.ts (nothing identifying, no cookies), e2e/idp-passkey-first.spec.ts ((d) another account clears it, (e) credential gone, (g) privacy) | Marker `jp.passkey.<realm>`, 180 days, cleared by "Use another account" and after two dismissals. ITP expiry timing not seen on a real Safari |
| PKF-03 | Complete | 32 | ded6f2f (`terraform/keycloak/flows.tf`: `passkey-done` ALTERNATIVE branch) | e2e/idp-config.spec.ts (pins both findings), e2e/idp-passkey-first.spec.ts ((h) forged assertions and a bare username get no code) | **A CONDITIONAL credential subflow fails open on 26.6.1** (a bare username got an authorization code); the extra branch is fail-closed. Order inside it matters |
| PKF-04 | Complete | 32 | ded6f2f (`versions.tf` `>= 5.8.0`, lock 5.10.0, `main.tf`, `mappers.tf`) | e2e/idp-config.spec.ts (mapper pin) | Provider 5.8+ needed for `passwordless_passkeys_enabled`; the bump defaults `add_to_token_introspection` to true, pinned false on the SEC-25 mappers. Operator: redeploy the theme, run `keycloak-apply` (plan: +5 resources, realm passkey setting updated, profile mappers no change) |

Other commit of the piece: 5ffc6e8 (design doc, operator notes, screenshots).

### PR #30 (`432aba5`), Phase 33

| ID | Status | Phase | Key commits | Tests | Summary |
|----|--------|-------|-------------|-------|---------|
| UX-NAV-02 | Complete | 33 | 39827dd (`silentCheckSsoFallback: false` in `frontend/src/auth/keycloak.ts`) | fe/auth-redirect.test.ts | When the hidden SSO iframe cannot answer (iOS blocks third-party storage) keycloak-js redirected the whole page with `prompt=none` and the CURRENT url as `redirect_uri` (`/PruebaMapJapan/`, `trip-edit.html?tripId=3`), not registered: "Invalid parameter: redirect_uri". Residual: a signed-in user on iOS with a blocked iframe sees the signed-out state until Sign in. Not seen on a real iPhone |
| TEST-PARITY-01 | Complete | 33 | eaa2dd9 (structural spec), 7642e95 (visual half), abb55da (round-trip unit test), 511fbc8 (gate independent of runner timing); fixes c47d78e + 88e006a (Day colour swatches, 44 px on coarse pointers), c684774 (return-stay popup title), ab42df6 (overview declutter) | e2e/demo-parity.spec.ts (fixtures `demoTrip.ts`, `tripSnapshot.ts`, `pixelDiff.ts`), fe/demo-roundtrip.test.ts | Rebuilds the demo in the real editor (Kyoto, Osaka, Takayama via UI; 8 destinations by search; Tokyo, Nagoya, Naoshima, Hakone, Tokyo (return) seeded); structural gate and visual gate (5% overview / 2% others, same-run diff). Normalisations N1-N3 in `tripSnapshot.ts`. Documented gap (`EXPECTED_GAPS`, product decision): `takayama-option-labels` (demo "1,2,3" vs API `is_optional`; needs `activities.option_label`). CI lessons in `qa/UX-REPORT.md`. Screenshots `docs/design/demo-parity/` |

### PR #31, Phase 33

| ID | Status | Phase | Key commits | Tests | Summary |
|----|--------|-------|-------------|-------|---------|
| UX-KC-04 | Complete (PR #31, `7b22618`); real-phone validation Unverified | 33 | fdfd24d (`?v=` cache-busting of theme assets), fe78b15 (friendly error page), e548741 (mobile audit against real Keycloak HTML) | e2e/idp-theme-cache.spec.ts, e2e/idp-theme-mobile.spec.ts (60), e2e/idp-theme-mobile-live.spec.ts (48), shared `fixtures/idp-theme/mobile-checks.ts`, asset-version test, regenerated snapshots (651 theme/passkey/config/flow tests passed locally on Keycloak 26.6.1; 16 failed on the old theme) | Root cause: production Keycloak serves theme resources with `Cache-Control: max-age=2592000` under Keycloak's own version hash; `start-dev` says no-cache, so earlier tests were blind. `template.ftl` links assets as `?v=${properties.jpAssetVersion}` (`theme.properties`, refreshed by `asset-version.mjs --write`). Friendly error pages (`error.ftl`, en + es, SEC-11 kept), mobile CSS tweaks. Residual: module imports in `passkey-first.js` not versioned (closed by UX-KC-05, PR #32). Needs the Keycloak image redeploy. Screenshots `.planning/qa/screens-theme/mobile-real/` |

### PR #32, Phase 34 (residual items)

Merge hash: `<merge hash>`. Commits are on the integration branch; the agents' worktree merge commits are not listed. `tf/` = `terraform/keycloak/tests/`, `ss/` = `deploy/selfhost/tests/`, `fe/` = `frontend/tests/`. Sandbox-validated only; nothing is deployed.

| ID | Status | Phase | Key commits | Tests | Summary |
|----|--------|-------|-------------|-------|---------|
| INFRA-APPLY-01 | Unverified (Complete in the repo; real realm not checked) | 34 | 5fd4367 (data sources in `mappers.tf` / `main.tf` use `local.realm_name = "japan-trip"`), f39e060 (`keycloak-apply.sh` reads `terraform show -json` and stops on destroy/replace; `ALLOW_DESTROY=1`; fails closed) | tf/single-step.tftest.hcl (mocked provider; the old `keycloak_realm.japan_trip.id` references fail with "Unknown condition value"; static assertion that no `data` block references `keycloak_realm.`), ss/scripts.test.sh (113 passed) | Fixes the operator finding of an unexpected plan (6 protocol mappers and the recovery role mapping destroyed/recreated) at its probable cause: a realm update made the data sources "known after apply". Bare `terraform apply` on an EMPTY Keycloak no longer works (realm first; `keycloak-apply.sh` and `scripts/ci/keycloak-flow.sh` already `-target` it). Owner: `./scripts/keycloak-apply.sh --dry-run`, expect only the 5 `passkey_done*` creates plus in-place updates, 0 destroy/replace; if the script stops, send `deploy/selfhost/state/terraform/keycloak/plan.txt`, never `ALLOW_DESTROY` |
| INFRA-CFG-01 | Complete | 34 | f39e060 (`deploy_default` in `deploy/selfhost/scripts/lib/common.sh`) | ss/scripts.test.sh | Reads `pagesOrigin` / `appBasePath` from `config/deploy-defaults.json` with `python3 -I`; env overrides; missing file, invalid JSON or missing key dies with a clear message |
| UX-SESS-01 | Complete | 34 | babb1d2 (variables `remember_me`, `sso_session_idle_timeout`, `sso_session_max_lifespan`, `sso_session_idle_timeout_remember_me`, `sso_session_max_lifespan_remember_me`; `main.tf`; `production.tfvars.example`), f39e060 (env vars `REMEMBER_ME`, `SSO_SESSION_IDLE_TIMEOUT`, `SSO_SESSION_MAX_LIFESPAN`, `SSO_SESSION_IDLE_REMEMBER_ME`, `SSO_SESSION_MAX_REMEMBER_ME`; `.env.example`; `docs/SELF-HOSTING.md` "Keeping people signed in") | tf/sessions.tftest.hcl (13 runs; `terraform test` 45 passed), ss/scripts.test.sh | Opt-in; defaults unchanged (`remember_me=false`, 30m idle, 10h max). Format `<n>s|m|h` (30 days = `720h`, 90 days = `2160h`), production cap `2160h`, plan-time validations. Recommendation `REMEMBER_ME=true`, `720h` idle, `2160h` max. The login theme already renders the checkbox when `realm.rememberMe`. Not tried on a real Keycloak |
| UX-KC-05 | Complete | 34 | d2efb61 (`jpModules` in `theme.properties`, import map in `template.ftl`, `asset-version.mjs --root`) | e2e/idp-theme-cache.spec.ts (static: imported set equals `jpModules`; render: editing an imported file changes the requested URL; fails without the fix) | `passkey-device.js` and `passkey-webauthn.js` versioned through the existing inline import map; keys are absolute URLs. Browsers without import map support (Safari/iOS < 16.4, Chrome < 89, Firefox < 108; Chrome on iPhone follows iOS) use unversioned URLs: no breakage, residual stale-cache risk only for a future edit. Not verified: real older WebKit; the FreeMarker block is evaluated by hand in the render test (real rendering covered by `idp-flow` in CI). Optional deploy-time layer, name unverified: `KC_SPI_THEME_STATIC_MAX_AGE` |
| UX-MOB-02 | Complete | 34 | 95e87be (landscape editor chrome in `trip-edit.css`, `profile.html` inset), 68471a0 (`pickHint.ts`, pointer-aware drop-a-pin hint), 9ec0973 (Navbar as `<nav aria-label>` with `ul`/`li`/`a`, `aria-current`) | fe/trip-edit-views.test.ts, fe/signup-entry-points.test.ts, e2e/mobile-layout.spec.ts (844x390, landscape editor, profile inset, profile dialog, touch pin hint) | Content starts at 214 px instead of 277 px on 667x375; site nav not sticky; `<search-bar>` hidden on the editor in short landscape (trade-off: the editor has its own place search); profile inset 16-24 px; touch hint "Tap the map to drop the pin. Tap Cancel to stop." with a 44 px Cancel, fine pointer "Click the map ... Press Esc"; `role=tab` removed. Gaps: fine-pointer hint only unit-tested; the touch pin-hint screenshot did not show the hint; no WebKit/Firefox |
| UX-SEARCH-02 | Complete | 34 | 6799585 (`activityFocus.ts`, `focusTarget.ts`; URL never stripped, also in `map.ts` for the demo; marker index bug), a5a4b26 (popup after `moveend`) | e2e/trip-deeplink.spec.ts, e2e/search-scope.spec.ts (updated) | Search result opens the matched city, selects the day, focuses the activity (`flyTo`, popup, highlighted legend row, screen-reader announcement). `activityId` wins over name; the day disambiguates; unknown day/activity/destination index fall back gracefully. Fixed markers being indexed by activity position when an earlier activity had no pin |
| UX-TRIP-03 | Complete | 34 | d686c95 (`frontend/src/modules/tripWeather.ts`, `weatherIcons.ts` shared with `widgets.ts`) | fe/trip-weather.test.ts (66), e2e/trip-weather.spec.ts (21), `e2e/fixtures/mockOpenMeteo.ts`, `mobileScreens` additions | Open-Meteo, keyless, only for destinations with their own coordinates; window clipped to today..+14 days, max 5 days, else current plus next days with a reason; 8 s timeout; offline hides and retries on `online`; HTTP error or malformed shows "Weather unavailable right now." with `#trip-weather-retry`; 15-minute cache per ~1 km cell; CSP `connect-src` already allows `api.open-meteo.com`. News widget NOT added (third-party CORS proxies). Known: demo `WEATHER_CONDITIONS` lacks codes such as 80 and 96 ("Variable"); demo pages could reuse the date-window logic |

Decisions not taken (residual / product decisions): external cover images stay blocked by the CSP `img-src`; Takayama option labels "1,2,3" need `activities.option_label`; news widget; per-IP sign-up throttle (REG-06 stays Partial).
