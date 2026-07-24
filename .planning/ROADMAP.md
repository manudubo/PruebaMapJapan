# Roadmap: TravelMap

## Milestones

- ✅ **v2.0 Auth Infrastructure & Hardening** — Phases 1–9 (shipped 2026-05-28)
- ✅ **v3.0 Quality, Polish & DevX** — Phases 10–14 (shipped 2026-06-15)
- ✅ **v3.1 E2E Stabilization** — Phases 15–19 (shipped 2026-07-23)
- 🔜 **v3.2 Security & Code Health Hardening** — Phases 20–26 (candidate, not started — see `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`)

## Phases

<details>
<summary>✅ v2.0 Auth Infrastructure & Hardening (Phases 1–9) — SHIPPED 2026-05-28</summary>

- [x] Phase 1: Security Hardening (8/8 plans) — completed 2026-04-27
- [x] Phase 2: Trip Builder (9/9 plans) — completed 2026-05-04
- [x] Phase 3: Public Sharing (3/3 plans) — completed 2026-05-06
- [x] Phase 4: Passkeys (2/2 plans) — completed 2026-05-09
- [x] Phase 5: Internationalization (12/12 plans) — completed 2026-05-15
- [x] Phase 6: Local Infrastructure (6/6 plans) — completed 2026-05-19
- [x] Phase 7: Backend Hardening + KC Config (9/9 plans) — completed 2026-05-24
- [x] Phase 8: OTP + Passkey Campaign (8/8 plans) — completed 2026-05-26
- [x] Phase 9: Playwright Real Auth (7/7 plans) — completed 2026-05-28

</details>

<details>
<summary>✅ v3.0 Quality, Polish & DevX (Phases 10–14) — SHIPPED 2026-06-15</summary>

- [x] Phase 10: Design Tokens + IDP Theme (4/4 plans) — completed 2026-05-31
- [x] Phase 11: Error Handling (4/4 plans) — completed 2026-06-01
- [x] Phase 12: Terraform Expansion + Dev Script (2/2 plans) — completed 2026-06-02
- [x] Phase 13: Security Audit + Documentation (5/5 plans) — completed 2026-06-07
- [x] Phase 14: E2E Expansion + New User Parity (4/4 plans) — completed 2026-06-09

</details>

<details>
<summary>✅ v3.1 E2E Stabilization (Phases 15–19) — SHIPPED 2026-07-23</summary>

- [x] Phase 15: Triage + Config (2/2 plans) — completed 2026-06-21
- [x] Phase 16: Independent Spec Fixes (2/2 plans) — completed 2026-06-22
- [x] Phase 17: OTP + Login Helper (2/2 plans) — completed 2026-06-23
- [x] Phase 18: Passkeys Fixes (2/2 plans) — completed 2026-07-13
- [x] Phase 19: Session + Closure (2/2 plans) — completed 2026-07-23

Full outcome: 242 passed, 25 skipped (documented deferrals), 0 failed. See `.planning/milestones/v3.1-ROADMAP.md` for phase-by-phase detail.

</details>

### v3.2 Security & Code Health Hardening (candidate — not started)

Synthesized from `ANALISIS-REPO.md` (7 passes, ~85 actionable findings) and `codex-review.md` (both in repo root). Full findings, per-item verification status, and rationale in `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`. To formalize: run `/gsd-new-milestone` when ready to start v3.2, which turns this draft into real phases via `/gsd-plan-phase`.

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
*Full v3.1 phase details in `.planning/milestones/v3.1-ROADMAP.md`*
