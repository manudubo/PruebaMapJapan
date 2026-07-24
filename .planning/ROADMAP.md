# Roadmap: TravelMap

## Milestones

- âœ… **v2.0 Auth Infrastructure & Hardening** â€” Phases 1â€“9 (shipped 2026-05-28)
- âœ… **v3.0 Quality, Polish & DevX** â€” Phases 10â€“14 (shipped 2026-06-15)
- âœ… **v3.1 E2E Stabilization** â€” Phases 15â€“19 (shipped 2026-07-23)
- ðŸ”œ **v3.2 Security & Code Health Hardening** â€” Phases 20â€“26 (candidate, not started â€” see `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`)

## Phases

<details>
<summary>âœ… v2.0 Auth Infrastructure & Hardening (Phases 1â€“9) â€” SHIPPED 2026-05-28</summary>

- [x] Phase 1: Security Hardening (8/8 plans) â€” completed 2026-04-27
- [x] Phase 2: Trip Builder (9/9 plans) â€” completed 2026-05-04
- [x] Phase 3: Public Sharing (3/3 plans) â€” completed 2026-05-06
- [x] Phase 4: Passkeys (2/2 plans) â€” completed 2026-05-09
- [x] Phase 5: Internationalization (12/12 plans) â€” completed 2026-05-15
- [x] Phase 6: Local Infrastructure (6/6 plans) â€” completed 2026-05-19
- [x] Phase 7: Backend Hardening + KC Config (9/9 plans) â€” completed 2026-05-24
- [x] Phase 8: OTP + Passkey Campaign (8/8 plans) â€” completed 2026-05-26
- [x] Phase 9: Playwright Real Auth (7/7 plans) â€” completed 2026-05-28

</details>

<details>
<summary>âœ… v3.0 Quality, Polish & DevX (Phases 10â€“14) â€” SHIPPED 2026-06-15</summary>

- [x] Phase 10: Design Tokens + IDP Theme (4/4 plans) â€” completed 2026-05-31
- [x] Phase 11: Error Handling (4/4 plans) â€” completed 2026-06-01
- [x] Phase 12: Terraform Expansion + Dev Script (2/2 plans) â€” completed 2026-06-02
- [x] Phase 13: Security Audit + Documentation (5/5 plans) â€” completed 2026-06-07
- [x] Phase 14: E2E Expansion + New User Parity (4/4 plans) â€” completed 2026-06-09

</details>

### v3.1 E2E Stabilization (Phases 15â€“19)

- [x] **Phase 15: Triage + Config** - Run fresh full-suite triage and fix passkeys Chromium scoping
- [x] **Phase 16: Independent Spec Fixes** - Fix public-sharing fixture and IDP theme assertions
- [x] **Phase 17: OTP + Login Helper** - Fix OTP contract and extract shared KC form helper
- [x] **Phase 18: Passkeys Fixes** - Fix authenticator lifecycle and credential reset
- [x] **Phase 19: Session + Closure** - Fix session-management selectors and document all outcomes

## Phase Details

### Phase 15: Triage + Config
**Goal**: The team has an authoritative, current failure list and passkeys Chromium-scoping is corrected so signal from subsequent fixes is not polluted by cross-browser config bugs
**Depends on**: Nothing (first phase of v3.1)
**Requirements**: SETUP-01, SETUP-02
**Success Criteria** (what must be TRUE):
  1. A full suite run with `trace: 'retain-on-failure'` and `retries: 1` completes and produces a written failure list that supersedes the stale v3.0 list
  2. `passkeys.spec.ts` no longer appears as a failure under `firefox` or `webkit` projects â€” the spec only runs under a Chromium-scoped project
  3. The triage output cleanly distinguishes which failures are pre-existing versus newly introduced by recent commits
**Plans**: 2 plans

Plans:
- [x] 15-01-PLAN.md â€” Add testIgnore to chromium/firefox/webkit project entries (SETUP-02) â€” commit 68cd447
- [x] 15-02-PLAN.md â€” Run full-suite triage and write 15-TRIAGE.md (SETUP-01) â€” commit f4680c3

### Phase 16: Independent Spec Fixes
**Goal**: The two specs that have no auth dependency and no coupling to the shared login helper â€” `public-sharing.spec.ts` and `idp-theme.spec.ts` â€” are green and can run independently
**Depends on**: Phase 15
**Requirements**: SHARE-01, SHARE-02, THEME-01, THEME-02, THEME-03
**Success Criteria** (what must be TRUE):
  1. `public-sharing.spec.ts` creates its own fixture data (public and private trips) in `beforeAll` â€” no hardcoded UUIDs, no dependency on pre-existing seed state
  2. `public-sharing.spec.ts` assertions reference current English loading/error copy, not the removed Spanish placeholder
  3. `idp-theme.spec.ts` runs with an empty `storageState` so an inherited KC SSO session cannot prevent the login page from rendering
  4. `idp-theme.spec.ts` uses a valid PKCE S256 `code_challenge` in `LOGIN_URL` so KC 26 does not reject the auth request before the login page renders
  5. All DOM and CSS assertions in `idp-theme.spec.ts` match the current KC 26 template structure and pass reliably
**Plans**: 2 plans

Plans:
- [x] 16-01-PLAN.md â€” Rewrite public-sharing.spec.ts with beforeAll fixture (SHARE-01, SHARE-02) — commit ff2393a
- [x] 16-02-PLAN.md â€” Fix idp-theme.spec.ts storageState override and PKCE challenge (THEME-01, THEME-02, THEME-03) — commit 04c6a04

### Phase 17: OTP + Login Helper
**Goal**: OTP specs pass against the actual route contract, and a single shared KC form-navigation helper replaces the four independent implementations so a KC flow change requires one fix
**Depends on**: Phase 15
**Requirements**: OTP-01, OTP-02, OTP-03, SESSION-02
**Success Criteria** (what must be TRUE):
  1. `fetchLatestOtp()` uses a polling loop so SMTP delivery lag does not produce false failures
  2. `otp.spec.ts` tests 1â€“3 satisfy the auth-gated route contract for `/api/auth/otp-request` and `/otp-verify` â€” no structural mismatch between spec and backend
  3. `otp.spec.ts` test 4 drives the KC browser flow using the shared helper and passes reliably
  4. A single `loginViaKcForm(page, username, password)` fixture exists and is used in all four former call sites (`global-setup.ts` Ã—2, `session-management.spec.ts`, `otp.spec.ts`)
**Plans**: 2 plans

Plans:
- [x] 17-01-PLAN.md — Create loginViaKcForm helper + fix otp.spec.ts (OTP-01, OTP-02, OTP-03, SESSION-02) — commit 75b873f
- [x] 17-02-PLAN.md — Wire loginViaKcForm into global-setup.ts + session-management.spec.ts (SESSION-02) — commit d042197

### Phase 18: Passkeys Fixes
**Goal**: `passkeys.spec.ts` passes reliably under the `chromium-passkeys` project with no unexplained residual failures
**Depends on**: Phase 15
**Requirements**: PASS-01, PASS-02, PASS-03
**Success Criteria** (what must be TRUE):
  1. A mid-test failure in `passkeys.spec.ts` does not leave a stale virtual authenticator â€” cleanup runs in `afterEach` unconditionally
  2. `kcAdmin.resetCredentials` leaves the test user's required actions clean â€” the passkey campaign flow cannot hijack the next test after a reset
  3. `passkeys.spec.ts` passes green under the `chromium-passkeys` project with no unexplained failures
**Plans**: 2 plans

Plans:
- [x] 18-01-PLAN.md â€” Passkeys spec selector fixes and afterEach cleanup (PASS-01) â€” commit a0872b7,a189ff2
- [x] 18-02-PLAN.md â€” Clear webauthn-register-passwordless in resetCredentials (PASS-02) â€” commit 08a48e3

### Phase 19: Session + Closure
**Goal**: `session-management.spec.ts` passes, and every test outcome in the suite is accounted for â€” green, root-caused and fixed, or explicitly documented as an accepted deferral
**Depends on**: Phase 17, Phase 18
**Requirements**: SESSION-01, DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. `session-management.spec.ts` `loginViaBrowser()` uses the shared `loginViaKcForm` helper and passes reliably against the current KC browser-flow shape
  2. Any spec that cannot be fixed due to genuine environment constraints is marked `test.fixme(condition, reason)` with an explicit rationale â€” no silently skipped or unexplained failures remain
  3. The full E2E suite run produces zero unexplained failures â€” every outcome is green, has a merged fix, or has a documented and accepted deferral on record
**Plans**: 2 plans

Plans:
- [x] 19-01-PLAN.md — Add storageState to firefox/webkit projects; mark trip-edit-integration and new-user webkit as test.fixme (DOC-01, DOC-02) — commit dff16ca,836fc25
- [x] 19-02-PLAN.md — Run full E2E suite, verify session-management live, write 19-CLOSURE.md (SESSION-01, DOC-02) — commit d89d075

### v3.2 Security & Code Health Hardening (candidate — not started)

Synthesized from `ANALISIS-REPO.md` (7 passes, ~84 actionable findings) and `codex-review.md` (both in repo root). Full findings, per-item verification status, and rationale in `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`. To formalize: run `/gsd-new-milestone` when ready to start v3.2, which turns this draft into real phases via `/gsd-plan-phase`.

- [ ] **Phase 20: Critical Security Fixes** — OTP CSPRNG (SEC-01), widget XSS + CSP package (SEC-02/03/04), remove or scope the unused Keycloak `manage-users` admin role/secret (SEC-14)
- [ ] **Phase 21: Deploy & Build Safety** — backend build is currently broken (`wrangler deploy --dry-run` fails on `string_decoder`, INFRA-03); gate `deploy-*.yml` on CI success (INFRA-01/02), pin wrangler (INFRA-04), fix KC Docker healthcheck (INFRA-05), upgrade `drizzle-orm`/`dompurify` (DEP-01)
- [ ] **Phase 22: Reliability Bugs** — activity-reorder UI bug (BUG-01), hung promise on 401 (BUG-02), first-login auto-provision race (BUG-03), stale sessionStorage doc comment (BUG-06), plus ~12 lower-severity bugs (BUG-04/05/07..16)
- [ ] **Phase 23: Supply Chain, Secrets & Accessibility** — Leaflet SRI on all 9 map pages incl. public `trip.html` (SEC-15), service-worker cache-versioning fix so deployed fixes actually reach users (SEC-16), triage/rotate the 14 Gitleaks findings (DEP-02), add secret/a11y scanning to CI (DEP-03), fix `aria-expanded` misuse + contrast + heading-order violations (A11Y-01..05)
- [ ] **Phase 24: Architecture Debt & Test Coverage** — point backend unit tests at a real ephemeral DB instead of a nonexistent mock (currently 3/4 `public.test.ts` tests vacuously pass on a 500, ARCH-06); this unblocks zero-coverage `trips.ts` authorization cascade (ARCH-03); `DATABASE_URL`/`getDb` middleware dedup (M-01), dual-DB-driver env-var instead of substring match (ARCH-02), OTP table index/TTL + data-layer CHECK constraints (DATA-01..03)
- [ ] **Phase 25: Trip-Planner Business Logic & Demo Parity** — cross-level date coherence validation, the largest business-logic gap found (BIZ-07); timezone date-shift bug, live-reproduced and affecting most users (BIZ-11); expose `is_optional`/`is_generic`/`maps_url`/`time`/`zoom_level` fields end-to-end through editor → schema → adapter → view (BIZ-01..05); date-order validation (BIZ-06/08/09)
- [ ] **Phase 26: Remaining Security Hardening & IdP Flow** — Phase 13 backlog passkey-flow restructure now that the `REQUIRED`+`ALTERNATIVE` smell is confirmed still-firing in logs (KC-01), JWKS cache DoS cooldown (SEC-05), JWT error detail leak (SEC-06), OTP TOCTOU (SEC-07), remaining low-severity findings (SEC-08..13, SEC-17..25)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Security Hardening | v2.0 | 8/8 | Complete | 2026-04-27 |
| 2. Trip Builder | v2.0 | 9/9 | Complete | 2026-05-04 |
| 3. Public Sharing | v2.0 | 3/3 | Complete | 2026-05-06 |
| 4. Passkeys | v2.0 | 2/2 | Complete | 2026-05-09 |
| 5. Internationalization | v2.0 | 12/12 | Complete | 2026-05-15 |
| 6. Local Infrastructure | v2.0 | 6/6 | Complete | 2026-05-19 |
| 7. Backend Hardening + KC Config | v2.0 | 9/9 | Complete | 2026-05-24 |
| 8. OTP + Passkey Campaign | v2.0 | 8/8 | Complete | 2026-05-26 |
| 9. Playwright Real Auth | v2.0 | 7/7 | Complete | 2026-05-28 |
| 10. Design Tokens + IDP Theme | v3.0 | 4/4 | Complete | 2026-05-31 |
| 11. Error Handling | v3.0 | 4/4 | Complete | 2026-06-01 |
| 12. Terraform Expansion + Dev Script | v3.0 | 2/2 | Complete | 2026-06-02 |
| 13. Security Audit + Documentation | v3.0 | 5/5 | Complete | 2026-06-07 |
| 14. E2E Expansion + New User Parity | v3.0 | 4/4 | Complete | 2026-06-09 |
| 15. Triage + Config | v3.1 | 2/2 | Complete | 2026-06-21 |
| 16. Independent Spec Fixes | v3.1 | 2/2 | Complete | 2026-06-22 |
| 17. OTP + Login Helper | v3.1 | 2/2 | Complete | 2026-06-23 |
| 18. Passkeys Fixes | v3.1 | 2/2 | Complete | 2026-07-13 |
| 19. Session + Closure | v3.1 | 2/2 | Complete | 2026-07-23 |

*Full v2.0 phase details in `.planning/milestones/v2.0-ROADMAP.md`*
*Full v3.0 phase details in `.planning/milestones/v3.0-ROADMAP.md`*
