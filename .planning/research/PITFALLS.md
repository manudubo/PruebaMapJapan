# Domain Pitfalls — v3.2 Security & Code Health Hardening

**Domain:** Retrofitting security/reliability fixes onto a live, single-owner production system (Cloudflare Workers + Neon backend, Keycloak 26.6.1 IdP, GitHub Pages frontend, Terraform-managed KC realm)
**Researched:** 2026-07-24
**Confidence:** HIGH for items grounded in this repo's actual code/config (Q1, Q2, Q6, Q7, Q8, Q5); MEDIUM for items resting partly on verified external docs applied to this stack (Q3, Q4)

## Scope note

This is **not** a new-feature milestone. `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` is the authoritative scope document (7-pass live-verified audit, ~85 actionable items, phases 20-26 proposed). This file answers one narrower question: **what specifically goes wrong when implementing the fixes already scoped there, against this exact codebase** — not generic security advice. Every pitfall below is grounded in a specific file/line read live from the repo during this research pass, not inferred from the requirement description alone.

---

## Critical Pitfalls

### Pitfall 1: OTP CSPRNG substitution introduces silent modulo bias or an off-by-one range

**What goes wrong:**
The current code is `backend/src/routes/auth.ts:123`:
```ts
const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
```
The naive "one-line fix" people reach for is:
```ts
const code = String(Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2**32) * 1_000_000)).padStart(6, '0');
```
or, worse, a per-digit loop using `Uint8Array` with `% 10`:
```ts
for (let i = 0; i < 6; i++) digits[i] = crypto.getRandomValues(new Uint8Array(1))[0] % 10;
```
The per-digit `Uint8Array % 10` pattern is the one that actually matters: 256 is not evenly divisible by 10 (256 = 25×10 + 6), so digits 0-5 are drawn with probability 26/256 and digits 6-9 with probability 25/256 — a real, measurable bias in the OTP's guessability distribution, defeating part of the reason for moving off `Math.random()` in the first place.

**Why it happens:**
`crypto.getRandomValues` gives you uniformly random *bytes/words*, not a uniformly random number in an arbitrary range. Any `% N` or `/ 2^32 * N` reduction where `N` doesn't evenly divide the source range reintroduces bias — the exact class of bug the CSPRNG swap is supposed to eliminate, just moved one level down.

**How to avoid:**
- Prefer generating the whole 6-digit space at once from a single `Uint32Array(1)` draw and use **rejection sampling** against the largest multiple of 1,000,000 that fits in 2^32 (reject and redraw if the value falls in the biased remainder), OR
- Accept that `Uint32 % 1_000_000` bias is negligible in practice (2^32 / 1,000,000 ≈ 4294.97, so the bias is on the order of 1 part in ~4295 — far smaller than the per-digit `% 10` case) and **explicitly document that this is an accepted, quantified tradeoff** rather than leaving it as an unexamined assumption.
- Do **not** loop per-digit with `Uint8Array` + `% 10` — this is the version that produces a bias large enough to matter (≈4% skew toward low digits).
- Cloudflare Workers' `crypto` global is the standard Web Crypto API (`crypto.getRandomValues`) — no polyfill or `node:crypto` import needed; verify this stays framework-native rather than pulling in a Node-only `crypto.randomInt` (which doesn't exist in the Workers runtime without `nodejs_compat`, and would be a needless coupling to INFRA-03's compat-date change).

**Warning signs:**
- Any per-digit random generation loop using an 8-bit random source and `% 10`.
- A code review comment or test that only checks "is this cryptographically random" without checking "is the *distribution* still uniform after the range reduction."

**Phase to address:** Phase 20 (Critical security)

---

### Pitfall 2: CSP via `<meta http-equiv>` silently breaks the widgets, the map, or both — because the failure is invisible without opening devtools

**What goes wrong:**
This app has no server that can set an HTTP `Content-Security-Policy` header (GitHub Pages serves static files only), so SEC-04 must be a `<meta http-equiv="Content-Security-Policy">` tag. Live-verified integration surface that a CSP must cover on every one of the 9 city pages plus `trip.html`:

| Directive | Must include | Because |
|---|---|---|
| `script-src` | `https://unpkg.com`, `'self'` | Leaflet JS loaded from unpkg CDN on all 9 city/trip pages (`tokyo.html:54` etc.) — this is the exact CDN SEC-15 also wants SRI-pinned in the same milestone, so both fixes must land compatibly, not sequentially in a way that breaks the other |
| `style-src` | `https://unpkg.com`, `'self'`, `'unsafe-inline'` (or hash) | Leaflet CSS from unpkg; `frontend/index.html` has **two inline `<style>` blocks** (lines 18, 36) that a strict `style-src` without `'unsafe-inline'`/hashes will silently drop, breaking the loading-state and countdown styling with no console error a casual glance would catch |
| `script-src` (inline) | `'unsafe-inline'` or per-build hash/nonce | `frontend/index.html` has **two inline `<script>` blocks** (lines 24, 428) — Vite doesn't currently emit CSP hashes/nonces for these, so a meta CSP without `'unsafe-inline'` breaks the countdown/theme-init logic that runs before the bundled JS loads |
| `connect-src` | `http://localhost:8787` / prod backend URL, `http://localhost:8080` / prod Keycloak URL, `https://api.open-meteo.com`, `https://api.allorigins.win`, `https://corsproxy.io`, Nominatim's host | Backend API (`VITE_API_URL`), Keycloak OIDC (`VITE_KEYCLOAK_URL`), weather widget (`widgets.ts:76`), and **both** RSS proxies (`widgets.ts:169-170`, tried in sequence as primary/fallback) — missing *either* proxy doesn't break the widget outright (it falls through to the other), but missing *both* silently empties the news widget with no visible error |
| `img-src` | tile server hosts (OSM/CartoDB per `CLAUDE.md`), `'self'`, `data:` | Map tiles fail to load — visually obvious (blank map), unlike the other failures below |

**Why it happens:**
A CSP added "for security" under time pressure gets written against what the author *remembers* the page loading, not what a `grep` across all 9 HTML files plus `widgets.ts` actually shows. The failure modes are non-uniform: some (map tiles) fail loudly, others (news widget, inline countdown script) fail silently because the code already has try/catch-and-swallow patterns around third-party fetches (this is itself a known gap — see `M-09` in the requirements doc, per-route `catch {}` blocks that discard errors) — so a CSP violation just looks like "the news widget has no items today," not an error.

**How to avoid:**
- Build the `connect-src`/`script-src` allowlist from a `grep` across every HTML entry point and `widgets.ts`, not from memory — the exact origins are enumerated in the table above.
- Test the CSP against `trip.html` specifically — it's flagged in SEC-15 as the one page rendering *another user's* data, so it's the highest-value page to actually verify manually (open devtools console, look for `Refused to ...` CSP violation logs) rather than trust "it built without errors."
- Because `frame-ancestors` is silently ignored inside `<meta>` CSP (browsers require it as an HTTP header), don't rely on the meta CSP for clickjacking protection — that's already partially covered server-side by `backend/src/middleware/security.ts`'s `X-Frame-Options` for API responses, but the static frontend has no such protection and the meta CSP won't add it. Document this gap rather than assuming the meta tag closes it.
- Land this in the **same PR/commit sequence** as SEC-15's Leaflet SRI attributes, since both touch the exact same `<script src="https://unpkg.com/...">` tags across 9 files — doing them as separate, out-of-order phases risks one fix's CSP allowlist not accounting for the other's `integrity`/`crossorigin` attributes (SRI + CSP together is fine, but SRI-without-`crossorigin` on a CDN script silently fails the resource load, which then looks exactly like a CSP block in the network tab, wasting debugging time misattributing the cause).

**Warning signs:**
- News widget renders empty with no console error (proxy blocked by `connect-src`).
- Countdown or theme toggle broken on `index.html` only, other pages fine (inline `<script>` block blocked).
- Map renders but tiles are blank/grey (missing tile host in `img-src`).

**Phase to address:** Phase 20 (SEC-04), coordinated with Phase 23 (SEC-15 Leaflet SRI) — recommend sequencing SEC-04 and SEC-15 as the same work session even though they're in different proposed phases, since they touch the same `<script>` tags.

---

### Pitfall 3: `compatibility_date` bump treated as a one-shot fix instead of an iterative "bump, build, fix next error" loop

**What goes wrong:**
`backend/wrangler.toml` is frozen at `compatibility_date = "2024-01-01"`. The known, confirmed error is `string_decoder` (a transitive dependency of `pg`/`split2`) needing `nodejs_compat_v2`, which activates at `compatibility_date ≥ 2024-09-23`. The common mistake is bumping the date, seeing the `string_decoder` error disappear, and declaring the fix done — when `wrangler deploy --dry-run` (this project's actual build-verification command, per `INFRA-03`) may surface a **different** unprefixed-Node-builtin error next, because `nodejs_compat_v2` polyfills more of Node's API surface but not all of it, and this project bundles `pg` (confirmed in `backend/package.json`, `"pg": "^8.13.1"`) — a driver with a comparatively large Node API footprint (streams, `net`, `tls`, `events`) compared to a Workers-native driver.

**Why it happens:**
The requirements doc itself is honest about this: "may surface more `nodejs_compat` gaps once fixed, needs a full green build to close." Treating this as "the string_decoder fix" rather than "the compatibility-date fix, verified only by a fully green `wrangler deploy --dry-run`" is the trap — the specific next builtin (if any) can't be predicted from training data or docs; it can only be discovered by actually running the build after the bump.

**How to avoid:**
- Bump the date, run `wrangler deploy --dry-run` (the exact command `INFRA-03` says currently fails), and treat any *new* unprefixed-builtin error the same way as `string_decoder` was diagnosed — don't assume the date bump alone is sufficient without a full clean build.
- Since this project uses both `node-postgres` (`pg`, local dev) and `@neondatabase/serverless` (`neon-http`, prod — per `ARCH-02`'s driver-selection note), verify **both** code paths build, not just whichever one `wrangler deploy --dry-run` happens to statically analyze — a bundler can dead-code-eliminate the unused branch and hide a builtin gap in the other driver until it's actually invoked at runtime.
- Don't pin to the *newest* available `compatibility_date` "to be safe" — pin to the oldest date that fixes the known error (2024-09-23) plus a small buffer, and re-verify; jumping straight to today's date pulls in unrelated compat-flag behavior changes that widen the regression surface for no benefit here.

**Warning signs:**
- `wrangler deploy --dry-run` passes but a route that actually calls the `pg` driver (not just imports it) still throws at runtime in a preview/staging deploy — this indicates a builtin gap the static build didn't catch.
- Any new "Cannot resolve module 'node:...'" or "X is not defined" error after the bump that names a different builtin than `string_decoder`.

**Phase to address:** Phase 21 (Deploy & build safety) — this phase's success criteria should explicitly be "a full green `wrangler deploy --dry-run`," not "the string_decoder error is gone."

---

### Pitfall 4: `drizzle-orm` 0.38→0.45 upgrade — the real gotcha is error-shape wrapping, not a relational-query-API rewrite

**What goes wrong:**
It's tempting to assume this version range includes Drizzle's well-publicized Relational Query Builder v2 rewrite — it does not. Verified directly against the GitHub release notes for every `0.39.0` through `0.45.0` tag: the RQB v2 overhaul is a `v1.0.0-beta`/`rc` concern, entirely outside the `0.38.4 → 0.45.2` range this project is upgrading across. Assuming otherwise and pre-emptively rewriting relational queries would be wasted, risky work outside the actual diff.

What **does** land in this range and is worth checking against this codebase:
- **`0.44.0`: `DrizzleQueryError` wraps all driver errors.** Previously a raw `pg`/`neon-http` driver error propagated directly; after 0.44, it's wrapped, with the original driver error accessible via `.cause` rather than being the thrown object itself. This project's backend currently has **no code that inspects `err.code`** (e.g., Postgres `23505` unique-violation) — confirmed via repo-wide search, only generic `err instanceof Error` checks in `middleware/auth.ts` and `middleware/user.ts` — so this isn't a live landmine today, but it becomes one if `BUG-03`'s first-login race fix is implemented as "catch the unique-violation exception and retry" instead of the requirements doc's recommended `INSERT ... ON CONFLICT (keycloak_id) DO NOTHING` approach: a `catch` block written against the pre-0.44 raw-error shape (`err.code === '23505'`) would need updating to `err.cause?.code` post-upgrade.
- **`0.45.0`: fixed `pg`-native Pool detection in node-postgres transactions.** Worth a smoke-test of any code path using DB transactions with the local `node-postgres` driver, since the fix implies pre-0.45 behavior around transaction/pool detection was buggy in exactly this driver combination.
- **`0.38.4`'s vulnerability itself (`GHSA-gpj5-g38j-94v9`, SQL injection via improperly-escaped identifiers)** — the requirements doc already assesses practical exploitability as low here (all identifiers in this codebase are static schema names, not user input) — the upgrade's value is closing the CVE, not fixing a live bug; don't over-invest in searching for an exploitable path that the audit already ruled out.

**Why it happens:**
Training data and general drizzle-orm search results are saturated with the RQB v2/v1.0 migration content (it's the framework's headline recent change), which bleeds into any query about "drizzle breaking changes" regardless of the actual version range asked about. The fix is checking the *specific* release notes for the *specific* range, not the framework's most-discussed recent change.

**How to avoid:**
- Sequence this upgrade **after** `ARCH-06` (real test DB replacing the mock-DB-that-always-500s) lands — this is already the requirements doc's own stated gate ("blocked on TQ-02/T-01 test coverage existing first, so a regression is catchable"). Don't skip that ordering to save a phase — an upgrade with no real assertions behind it is exactly the scenario ARCH-06 exists to prevent.
- Grep for any `err.code`/`err.cause`/driver-specific error inspection introduced by future work (e.g., a `BUG-03` fix) and write it against the **post-0.44** `DrizzleQueryError` shape from the start, so the drizzle-orm bump and the BUG-03 fix don't fight each other depending on which lands first.
- Re-run `npm audit` after the bump to confirm `GHSA-gpj5-g38j-94v9` is actually closed by 0.45.2, rather than assuming the version-number jump alone resolves it.

**Warning signs:**
- Any new or existing code that does `catch (err) { if (err.code === ...) }` against a Drizzle query result starts silently taking the wrong branch (falls through to the generic-error path instead of the specific one) post-upgrade.
- Local (`node-postgres`) and prod (`neon-http`) driver behavior diverges on a transaction-heavy code path after the bump — test both, not just whichever runs in local dev.

**Phase to address:** Phase 21 (Deploy & build safety), sequenced after Phase 24's `ARCH-06` (real test DB) — this is a case where the proposed phase *numbering* (21 before 24) and the *dependency* (24 should gate part of 21) diverge; flag explicitly when planning Phase 21's task breakdown.

---

### Pitfall 5: Gating deploy on CI via `workflow_run` either silently never blocks, or blocks forever — and this project has a live, confirmed instance of the "blocks forever" failure mode waiting to happen

**What goes wrong:**
Both `deploy-frontend.yml` and (per the requirements doc) `deploy-backend.yml` currently trigger on `push: branches: [main]` with `paths:` filters and zero CI dependency. The two most common ways a naive `workflow_run` retrofit fails:

1. **Silent no-op:** `workflow_run` fires on `types: [completed]` regardless of success/failure unless the deploy job explicitly checks `github.event.workflow_run.conclusion == 'success'`. Forgetting that check means the deploy runs (and can succeed) even when CI failed — worse than the current state, because it now *looks* gated (a `workflow_run` dependency is visible in the YAML) while providing zero actual protection.
2. **Permanent block:** `workflow_run` only fires for the workflow *as defined on the default branch*, and `paths:` filtering doesn't carry over from `push`/`pull_request` events to `workflow_run` — meaning if `ci.yml` itself ever gains a `paths:` filter to speed itself up (a plausible future optimization, not present today), any push that doesn't match those paths means `ci.yml` never runs, which means the `workflow_run` event never fires, which means the deploy workflow **never triggers, permanently, for that class of change** — with no error, just a workflow that silently stops appearing in the Actions history at all.

This project has a **live, already-confirmed instance of failure mode 2's underlying risk**: `ARCH-09` documents that the CI workflow's `e2e` job "has never once passed" since April 2026. If `INFRA-01`/`INFRA-02` gate the deploy workflow on `ci.yml`'s overall success (rather than specifically the `typecheck-frontend`/`typecheck-backend` jobs), **the deploy workflow would never run at all**, because the workflow it's waiting on has a 100% historical failure rate on one of its jobs. This isn't a hypothetical misconfiguration — it's the actual current state of the CI workflow this phase would gate against.

**Why it happens:**
`workflow_run` is a cross-workflow, asynchronous, two-hop trigger (push → ci.yml runs → completion event → deploy.yml evaluates) with no built-in "and it passed" semantics and no `paths:` inheritance — it's a fundamentally different, more failure-prone primitive than a same-workflow `needs:` dependency, and it's easy to reach for it because the deploy and CI workflows are already separate files.

**How to avoid:**
- **Fix `ARCH-09` (CI e2e job's chronic failure) before or as part of this phase, not after.** The requirements doc already flags this explicitly: "ARCH-09... deserves its own debugging session before Phase 21 tries to gate deploys on this same CI workflow." Gating on a currently-red job would make Phase 21's own goal (unblock real deploys) self-defeating.
- **Prefer gating specific jobs, not the whole workflow's conclusion** — e.g., gate on `typecheck-frontend`/`typecheck-backend` (which do pass) rather than `ci.yml`'s aggregate result (which includes the chronically-failing `e2e` job), if a full ARCH-09 fix can't land first.
- **Consider avoiding `workflow_run` entirely** — the simpler, race-free alternative is adding the typecheck/build steps as jobs *within* `deploy-frontend.yml`/`deploy-backend.yml` themselves (same `on: push` trigger, a `needs: [typecheck]` job dependency), which sidesteps the entire class of cross-workflow triggering bugs since everything runs synchronously in one workflow run. Given this repo's CI already duplicates simple `npm run typecheck` calls, inlining them into the deploy workflows is lower-risk than the `workflow_run` chain.
- If `workflow_run` is used anyway: explicitly check `github.event.workflow_run.conclusion == 'success'` in an `if:`, and checkout `ref: ${{ github.event.workflow_run.head_sha }}` (not the default-branch HEAD) so the deployed commit is guaranteed to be the one CI actually tested, not whatever landed on `main` in between.

**Warning signs:**
- After adding the gate, deploy runs disappear from the Actions history entirely for pushes that should have deployed — check the count of deploy-workflow runs per week before/after, don't just check "did the YAML parse."
- A deploy succeeds immediately after a push that you know CI hasn't finished evaluating yet (silent no-op in the other direction).

**Phase to address:** Phase 21 (INFRA-01/INFRA-02), hard-dependent on Phase 24's `ARCH-09` fix landing first — this is the strongest phase-ordering violation in the current draft breakdown and should be called out explicitly when `/gsd-plan-phase` sequences Phase 21's tasks.

---

### Pitfall 6: Cross-level date-coherence validation (BIZ-06/07) rejects existing valid records because every date column in this schema is nullable

**What goes wrong:**
`backend/src/db/schema.ts` defines `start_date`/`end_date` on trips and destinations, and `check_in_date`/`check_out_date` on hotels, **all without `.notNull()`** — confirmed by reading the schema directly. A naive Zod `.refine((data) => data.start_date <= data.end_date)` guard, applied without an explicit null-handling branch, will either:
- Throw/reject when one or both dates are `null` (if the refine doesn't special-case nulls — comparing `null <= someDate` or `someDate <= null` in JS coerces in surprising ways and is not a deliberate "skip validation" decision), breaking the **already-supported, already-in-use** product pattern of adding a destination before its dates are finalized, or
- Worse, silently pass invalid comparisons through if the null-coercion happens to evaluate truthy, giving false confidence that the guard works.

This directly affects real data: a trip can legitimately have a destination with no `end_date` yet (the user hasn't decided how long they're staying), and BIZ-06/07's validation must not make that state impossible to create or update once the guard ships — otherwise this fix breaks a currently-working, currently-in-database use case.

**Why it happens:**
Date-coherence bugs are usually reasoned about from "what's an invalid combination of two dates," which implicitly assumes both dates exist. Retrofitting the guard onto an existing nullable schema requires deliberately reasoning about the *three*-way case (both present and valid, both present and invalid, one-or-both absent) — and the absent case is easy to skip because it wasn't the bug being fixed.

**How to avoid:**
- Write the refine as: skip the comparison entirely when either date is `null`/`undefined` — validate order **only when both values are present**. This matches "don't reject what already exists as valid," not "require both dates."
- For the cross-level checks (day within destination's range, destination within trip's range, destinations non-overlapping — the harder BIZ-07 half), apply the same rule at each level: if the parent record's date range is incomplete (null), the child-level check is a no-op, not a rejection. A trip with no `end_date` set yet cannot have its destinations checked against a range that doesn't exist.
- **Test against a copy of production data, not synthetic complete records** — before shipping, run the new validators (in dry-run/log-only mode first) against every existing trip/destination/hotel row and confirm zero false-positive rejections on data that's currently considered valid. Given this is a single-owner app with a live personal trip already in progress (Feb-Mar 2026 per `CLAUDE.md`), this is a check against *the actual trip this app was built to plan*, not an abstract edge case.
- Consider whether "no validation is deferred to a later PATCH" is itself the more accurate design — i.e., these fields being optional is likely intentional incremental-entry UX (per Cluster 8's framing of this as a demo-parity/business-logic gap, not a data-integrity bug), so the fix should add validation for *actually-provided-but-inconsistent* dates, not require completeness that was never required before.

**Warning signs:**
- Any existing trip in the dev/staging DB fails to load, save, or PATCH after the guard ships, specifically ones known to have partial date data.
- A PATCH request that doesn't touch date fields at all starts failing validation (a sign the refine is evaluating against `null` fields it shouldn't be touching for that request).

**Phase to address:** Phase 25 (Trip-planner business logic & demo parity) — BIZ-07 is flagged there as "the largest business-logic gap," so this pitfall is directly load-bearing for that phase's success criteria, not a side concern.

---

### Pitfall 7: Removing `manage-users` from the `japan-trip-worker` service account breaks the E2E test suite's admin fixture — a live, confirmed dependency, not a hypothetical one

**What goes wrong:**
SEC-14 is framed in the requirements doc as having "zero consumers in the codebase" — true for `backend/src/` (confirmed live via the audit's `grep -rn "KC_ADMIN" backend/src`). But that grep scope excludes the **E2E test suite**, which has a real, active consumer: `tests/e2e/fixtures/kc-admin.ts` authenticates as a Keycloak Admin API client using `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` — and both `tests/.env.test.example` and `backend/.dev.vars.example` set `KC_ADMIN_CLIENT_ID=japan-trip-worker`, the **exact same client** SEC-14 targets. This fixture calls `client.users.deleteCredential(...)`, `createUser`, `deleteUser`, `getUserSessions`, `logoutUser`, and `clearRequiredActions` — all of which require the `manage-users` realm-management client role on the calling service account. `resetCredentials()` (used across the passkey/session E2E specs per the v3.1 retrospective's "resetCredentials clearing stale webauthn-register-passwordless required actions") depends directly on this permission.

Removing `manage-users` from `japan-trip-worker` as a clean one-line Terraform delete, without touching the E2E fixture, will **break the entire E2E admin-management layer** — not the app itself (confirmed zero backend/src consumers), but the test infrastructure that Phase 24's `ARCH-03`/`ARCH-06` work (and every future E2E run) depends on to create/reset/clean up test users between specs.

**Why it happens:**
The "zero consumers" claim is accurate for its stated scope (`backend/src` production code) but the requirements doc's own SEC-14 fix suggestion ("remove the role/secret if the feature is dead") implicitly frames this as an isolated, no-blast-radius change. The E2E suite lives in a different directory (`tests/e2e/`) and uses a different mechanism (direct Admin API client-credentials grant, not the backend's runtime `Env` bindings) than what the original `grep` scoped — so the dependency is real but was outside the query that found "no consumers."

**How to avoid:**
Pick one of two explicit paths, don't default to silent deletion:
1. **Migrate the E2E fixture to a dedicated admin/test service account** (a new Terraform-managed client scoped to `manage-users` for test purposes only, or reuse Keycloak's own `admin-cli`/realm-admin credentials already used elsewhere for KC bootstrap) *before* removing the role from `japan-trip-worker` — this is the option that fully closes SEC-14's stated risk (a prod-facing worker holding realm-wide user-management power) without breaking test infra.
2. **If scoping rather than deleting** (the requirements doc's stated alternative: "scope to minimal roles"), keep `manage-users` (or the specific sub-permissions the E2E fixture actually calls — `manage-users` doesn't have finer client-role granularity in Keycloak's `realm-management` client, so partial scoping isn't available here without a custom client role, which is out of scope per `KC-02`'s "no SPI" decision) and instead address the *secret deployment* half of SEC-14 (don't deploy the credential to prod Cloudflare for a feature the runtime doesn't use) while leaving the local/test-realm grant intact.
3. **Do not** just delete the Terraform resource and run the E2E suite to "see what breaks" — the retrospective's own pattern (v3.1: "Before any worktree→main merge: check main's own git status first... uncommitted state is a silent-data-loss risk") establishes this project's working norm of verifying blast radius *before* a destructive change, not discovering it via CI failure after.

**Warning signs:**
- Any E2E spec using `resetCredentials`, `createUser`, `deleteUser`, `getUserSessions`, or `logoutUser` from the `kc-admin.ts` fixture starts failing with a 403 from the Keycloak Admin API immediately after this Terraform change applies.
- `terraform plan` for this change shows only the one `keycloak_openid_client_service_account_role.worker_manage_users` resource being destroyed — a plan that "looks clean" is not evidence of no blast radius, since the E2E fixture's dependency lives outside Terraform's view entirely (it's a runtime API-call dependency, not a Terraform resource reference).

**Phase to address:** Phase 20 (SEC-14 is scoped there) — but this pitfall means Phase 20's SEC-14 work has a **Phase 24 blast radius** (E2E test infra that Phase 24's `ARCH-03`/`ARCH-06` test-coverage work depends on). Flag this as a cross-phase dependency: either migrate the E2E fixture's credentials as part of Phase 20 itself, or explicitly sequence SEC-14 after confirming Phase 24's test-DB work doesn't also need `japan-trip-worker`'s admin powers for anything not yet inventoried.

---

### Pitfall 8: Restructuring the passkey flow to single-REQUIRED-with-internal-ALTERNATIVEs locks out every user who doesn't already have a passkey registered — including this project's own no-passkey E2E test user

**What goes wrong:**
The current `terraform/keycloak/flows.tf` structure is:
```
browser-passkey (top-level ALTERNATIVE siblings: cookie, passkey-forms, password-forms)
  passkey-forms (subflow, ALTERNATIVE)
    username_form         REQUIRED
    webauthn_passwordless ALTERNATIVE   <- the flagged smell (REQUIRED+ALTERNATIVE same level)
  password-forms (subflow, ALTERNATIVE)
    username_password_form REQUIRED
```
KC-01's proposed fix ("single REQUIRED credential-subflow with webauthn/password as internal ALTERNATIVEs") is correct in *intent*, but the most common way people implement it wrong is flattening `webauthn_passwordless` from `ALTERNATIVE` straight to `REQUIRED` inside a merged subflow **without** wrapping it in a "Condition - user configured" conditional subflow. Keycloak's WebAuthn passwordless authenticator, when set to `REQUIRED` with no registered credential and no conditional guard, **fails the authentication attempt outright** for any user who has no passkey — it does not gracefully fall through to a password prompt. This project's own Terraform already documents a user for exactly this scenario: `terraform/keycloak/main.tf` line 170, the E2E OTP test user, described as "no passkeys registered (D-13)." A naive restructure locks that user (and, more importantly, every real first-time or password-only user, including anyone mid-onboarding before their first passkey registration) out of login entirely.

**Why it happens:**
"REQUIRED credential subflow with alternatives inside" sounds like it should just mean flipping the requirement level, but Keycloak's authenticator evaluation for `REQUIRED` executors doesn't automatically skip based on whether the user has a credential of that type — that skip behavior specifically requires a `conditional-user-configured` (or equivalent "Condition - user configured") execution wrapping the credential-specific authenticator, so the flow tree becomes: `REQUIRED` subflow → conditional subflow (only enters if user has a WebAuthn credential) → `webauthn-authenticator-passwordless` `REQUIRED` inside that conditional, with a sibling `ALTERNATIVE` (or a second conditional) covering the no-credential/password path. Skipping the conditional wrapper is the single most common way this exact restructure breaks login for a subset of users while looking correct in the Terraform diff and passing a quick smoke test with an account that *does* have a passkey.

**How to avoid:**
- Any restructure must explicitly include a `keycloak_authentication_execution` for `conditional-user-configured` (or the flow-tree equivalent) gating the WebAuthn branch — not just a requirement-level change on the existing `webauthn_passwordless` execution.
- Test with **both** account types before considering this done: an account with a registered passkey (should get passwordless login) and an account with none (should fall through to password, not get rejected) — the E2E OTP test user (`main.tf:170`, "no passkeys registered") is already sitting in this repo's Terraform as a ready-made negative-path test fixture; use it deliberately rather than only testing with the passkey-registered E2E user (`main.tf:154`).
- Add the requirements doc's own recommended safeguard: "a negative E2E test asserting username-only auth is impossible" — but pair it with the inverse assertion this pitfall implies: a **positive** E2E test asserting password-only (no-passkey) auth is still *possible*, since that's the exact case a bad restructure breaks.
- **Existing registered WebAuthn credentials are not at risk from this restructure** — Keycloak ties credentials to the user's credential store by type (`webauthn-passwordless`), not to the specific flow-tree structure that authenticates them, so a structural flow change does not invalidate or require re-registration of already-enrolled passkeys. The risk here is entirely about the *login flow's* handling of users without a credential, not about destroying existing ones.
- Because `keycloak_authentication_flow`/`keycloak_authentication_subflow` Terraform resources often force replacement (not in-place update) on structural changes, check the `terraform plan` output for this change carefully — a flow replacement briefly means the realm's `browserFlow` binding needs to still resolve correctly through the apply, and a plan showing unexpected destroy/recreate of the *parent* `browser-passkey` flow (not just the subflow) would mean a window where the binding could be invalid mid-apply. Verify the plan targets only the subflow/execution level, not the top-level flow resource, before applying.

**Warning signs:**
- After the restructure, a password-only account (or a freshly-created account with no passkey yet) cannot complete login at all — not "falls back to password," but errors out or hangs on a WebAuthn prompt with no credential to satisfy it.
- Keycloak logs show the WebAuthn authenticator being invoked (and failing) for a user account known to have zero registered credentials — this indicates the conditional wrapper is missing.

**Phase to address:** Phase 26 (SEC-05..13, SEC-17..25, KC-01) — KC-01 is explicitly called out there as "the one item here worth scheduling deliberately," and this pitfall is the concrete reason why: the failure mode isn't a security regression, it's a full login lockout for a subset of real users, which is a materially different and more urgent risk category than the "smell, not currently breaking" status KC-01 currently carries.

---

## Cross-Phase Ordering Tensions (integration pitfalls that only exist *between* phases)

The proposed 7-phase breakdown (`.planning/v3.2-CANDIDATE-REQUIREMENTS.md`, "Proposed phase breakdown") is scoped correctly per-cluster but has three places where the phase *number order* and the actual *dependency order* diverge. These are easy to miss when planning each phase in isolation:

1. **Phase 20's SEC-14 has a Phase 24 blast radius (Pitfall 7).** Removing `japan-trip-worker`'s `manage-users` role in Phase 20 can silently break the E2E admin fixture that Phase 24's `ARCH-03`/`ARCH-06` test-coverage work (and every E2E-dependent phase after it) relies on. Resolve the E2E fixture's credential source *as part of* Phase 20's SEC-14 task, not as an assumed side effect discovered later.
2. **Phase 21's INFRA-01/02 deploy-gating depends on Phase 24's ARCH-09 fix landing first (Pitfall 5).** Gating deploy on `ci.yml`'s success when `ci.yml`'s `e2e` job has never passed since April 2026 would make deploys permanently blocked — the opposite of INFRA-01/02's goal. `ARCH-09` needs its own debugging session *before* Phase 21 implements the gate, even though ARCH-09 is nominally scoped to Phase 24.
3. **Phase 21's DEP-01 (`drizzle-orm` upgrade) depends on Phase 24's ARCH-06 (real test DB) landing first (Pitfall 4).** The requirements doc already states this explicitly as a blocking dependency — carried forward here because it's the same "phase N depends on phase N+3" shape as tensions 1 and 2, and worth grouping with them when `/gsd-plan-phase` sequences task order across phases 20-26.

If Phase 21 and Phase 20 are executed strictly in numeric order without pulling the relevant Phase 24 items forward (or at minimum verifying them first), two of the three highest-priority phases in this milestone (20 and 21) risk shipping fixes that either break test infrastructure or can't be safely completed at all.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Skipping the "both dates present" null-guard on BIZ-06/07 validators, applying strict validation everywhere | Faster to write, feels "more correct" | Breaks existing partial trip records; support burden fixing rejected legitimate PATCHes | Never — the schema's nullability is a deliberate existing product decision, not an oversight to override |
| Bumping `compatibility_date` to "today" instead of the minimum date that fixes `string_decoder` | One less thing to think about later | Wider, harder-to-predict compat-flag behavior change surface for zero added benefit | Never for this specific fix; acceptable only as a separate, deliberate "modernize compat flags" task with its own verification pass |
| Deleting `manage-users` from `japan-trip-worker` without first checking E2E fixture usage | SEC-14 "closed" in one commit | Breaks the E2E admin layer other phases depend on; discovered late, in CI, not in review | Never — always grep `tests/` in addition to `backend/src` before removing a Terraform-managed IdP permission |
| Restructuring the passkey flow and testing only with a passkey-registered account | Fast, "looks like it works" | Locks out every password-only/no-credential user in production | Never — this project already has a purpose-built no-passkey test user; use it |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| unpkg.com (Leaflet CDN) + meta CSP | Writing `script-src`/`style-src` from memory instead of grepping all 9 HTML files | Grep every HTML entry point for `unpkg.com` references; verify against `trip.html` specifically since it's the cross-user-data page |
| Open-Meteo / allorigins / corsproxy + meta CSP | Allowlisting only one RSS proxy since "it has a fallback anyway" | Both must be in `connect-src` — the fallback only helps if the *primary* proxy itself fails, not if CSP blocks both |
| Keycloak Admin API (`japan-trip-worker` client) | Assuming `backend/src`-scoped grep for consumers covers the whole repo | Also grep `tests/e2e/fixtures/`, `.env.test.example`, and any Terraform root outside `terraform/keycloak/` (`terraform/cloudflare/main.tf` references the same client's outputs) before removing IdP permissions |
| `pg`/`node-postgres` on Cloudflare Workers + `nodejs_compat` | Treating one fixed error as proof the compat-date bump is complete | Full green `wrangler deploy --dry-run` is the actual completion criterion, exercising both the local (`pg`) and prod (`neon-http`) driver code paths |
| GitHub Actions `workflow_run` cross-workflow gating | Gating on a workflow's overall `conclusion` when one of its jobs (here, `e2e`) has a 100% historical failure rate | Fix the chronically-failing job first, or gate on specific passing jobs only, or avoid `workflow_run` entirely in favor of an in-workflow `needs:` dependency |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Per-digit `Uint8Array % 10` OTP generation | Reintroduces ~4% digit-distribution bias, undermining the point of the CSPRNG swap | Draw the full 6-digit range from one `Uint32Array` value with rejection sampling, or explicitly accept and document the smaller `% 1_000_000` bias |
| Meta-tag CSP assumed to provide clickjacking protection | `frame-ancestors` is silently ignored in `<meta>` CSP by browser design — the frontend gets no clickjacking protection from this fix despite appearing to have a CSP | Document that clickjacking protection remains an unaddressed gap for the static frontend (backend API responses already have `X-Frame-Options` per `security.ts`) |
| Scoping-not-deleting `manage-users` as the "safe" SEC-14 fix, without addressing secret deployment | Leaves the actual highest-severity finding (a fully-scoped realm-wide credential deployed to prod Cloudflare for an unused feature) half-fixed | If keeping the role for E2E-fixture reasons, at minimum stop deploying the secret to production Cloudflare where no runtime code consumes it |
| WebAuthn `REQUIRED` without `conditional-user-configured` wrapper | Full login lockout for any account without a registered passkey, not a graceful degradation | Always pair a `REQUIRED` credential-specific authenticator with a conditional-subflow guard when the credential isn't universally provisioned |

## "Looks Done But Isn't" Checklist

- [ ] **SEC-04 (CSP shipped):** Often "done" while the news widget is silently dead — verify `connect-src` includes both `api.allorigins.win` and `corsproxy.io`, and manually check the widget renders items, not just that the build succeeded with no CSP syntax errors.
- [ ] **SEC-14 (manage-users removed):** Often "done" while the E2E admin fixture (`resetCredentials`, `createUser`, etc.) still points at the now-unprivileged `japan-trip-worker` client — run the full E2E suite (not just a `terraform plan` review) before considering this closed.
- [ ] **KC-01 (flow restructured):** Often "done" after testing with one passkey-registered account — verify with the dedicated no-passkey test user (`main.tf:170`) that password-only login still succeeds, and add the requirements doc's suggested negative test (username-only auth is impossible) *plus* a positive test (password-only login still works).
- [ ] **INFRA-03 (compat date bumped):** Often "done" when the known `string_decoder` error disappears — verify a full `wrangler deploy --dry-run` green run, exercising both `pg` (local) and `neon-http` (prod) driver code paths, not just "the one error is gone."
- [ ] **DEP-01 (drizzle-orm upgraded):** Often "done" when `npm install` succeeds and `npm audit` shows the CVE closed — verify against ARCH-06's real test DB (not the vacuous mock-DB tests) that queries still return correct results, especially any transaction-using code path given the 0.45.0 pg-native Pool-detection fix.
- [ ] **BIZ-06/07 (date validation added):** Often "done" when new-record validation works in a fresh test — verify every existing trip/destination/hotel row in a production-data copy still loads and saves without a false-positive rejection, given every relevant date column is nullable.
- [ ] **INFRA-01/02 (deploy gated on CI):** Often "done" when the YAML parses and references `ci.yml` — verify deploy runs actually still appear in Actions history after a real passing push, not just that the gate syntax is valid; check this *especially* if ARCH-09 (chronically-failing e2e job) hasn't been separately fixed first.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| CSP blocks a working integration | LOW | Meta CSP is a static HTML attribute — fix the allowlist and redeploy the frontend; no data migration, no rollback complexity, GitHub Pages redeploy is fast |
| `manage-users` removal breaks E2E suite | LOW-MEDIUM | Terraform re-apply to restore the role is a single `terraform apply` if caught immediately (before the E2E fixture is migrated); MEDIUM if the fixture credentials were already rotated/removed and need reissuing |
| Passkey flow restructure locks out users | HIGH | Users mid-lockout in production is a live incident, not a code-review catch — revert the Terraform flow change immediately (flow resources may force-replace, so revert-apply itself takes a full apply cycle, not an instant rollback); this is the single highest-recovery-cost pitfall in this set and the strongest argument for the dual-account (passkey + no-passkey) test requirement before merging |
| `compatibility_date` bump surfaces a new builtin gap in prod (not caught by dry-run) | MEDIUM | Revert `compatibility_date` in `wrangler.toml` and redeploy — Workers compat dates are simple config, but any runtime writes that happened using the broken code path (e.g., a partially-executed DB write before the crash) need manual data-integrity review |
| drizzle-orm upgrade regresses a query silently (no test catches it) | MEDIUM-HIGH | Cost scales directly with how much of ARCH-06's real-test-DB coverage actually landed first — this is the concrete argument for not skipping that phase-ordering dependency |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|---------------|
| OTP modulo bias (Pitfall 1) | Phase 20 (SEC-01) | Statistical distribution test on generated codes (chi-square or simple bucket-count over N generations) confirming no per-digit skew |
| CSP breaks widgets/map (Pitfall 2) | Phase 20 (SEC-04), coordinated with Phase 23 (SEC-15) | Manual devtools console check on `trip.html` + automated E2E assertion that news widget renders ≥1 item and map tiles load |
| nodejs_compat incremental gaps (Pitfall 3) | Phase 21 (INFRA-03) | Full green `wrangler deploy --dry-run`, both `pg` and `neon-http` code paths exercised |
| drizzle-orm error-shape + driver gotchas (Pitfall 4) | Phase 21 (DEP-01), gated on Phase 24 (ARCH-06) | Real-DB-backed test suite green post-upgrade; `npm audit` confirms `GHSA-gpj5-g38j-94v9` closed |
| workflow_run silent-noop / permanent-block (Pitfall 5) | Phase 21 (INFRA-01/02), gated on Phase 24 (ARCH-09) | Deploy-workflow run count in Actions history unchanged or increased after gate ships, for a known-good push |
| Over-strict date validation on nullable columns (Pitfall 6) | Phase 25 (BIZ-06/07) | Dry-run validators against existing production-data copy show zero false-positive rejections |
| SEC-14 breaks E2E admin fixture (Pitfall 7) | Phase 20 (SEC-14), verify against Phase 24 | Full E2E suite green after the Terraform change, not just `terraform plan` review |
| Passkey flow restructure lockout (Pitfall 8) | Phase 26 (KC-01) | E2E login test passes for both the passkey-registered test user and the dedicated no-passkey test user (`main.tf:170`) |

## Sources

- Live repo reads (HIGH confidence, primary evidence for every pitfall above): `backend/src/routes/auth.ts:123`, `frontend/index.html` (inline `<script>`/`<style>` blocks), `frontend/*.html` + `frontend/public/sw.js` (unpkg/proxy hosts), `frontend/src/modules/widgets.ts`, `backend/wrangler.toml`, `backend/package.json`, `backend/src/db/schema.ts`, `terraform/keycloak/main.tf`, `terraform/keycloak/flows.tf`, `tests/e2e/fixtures/kc-admin.ts`, `tests/.env.test.example`, `backend/.dev.vars.example`, `.github/workflows/{ci,deploy-frontend}.yml`, `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`, `.planning/RETROSPECTIVE.md`
- [MDN: Content-Security-Policy meta http-equiv limitations](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) — MEDIUM confidence, confirms `frame-ancestors` is ignored in meta-tag CSP
- [content-security-policy.com meta examples](https://content-security-policy.com/examples/meta/) — MEDIUM confidence, corroborates the meta-tag directive limitation
- [Cloudflare Workers docs: node-postgres compatibility](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres) — MEDIUM confidence, confirms `nodejs_compat` + compat-date ≥ 2024-09-23 requirement for `pg`-family packages
- [Cloudflare Blog: A year of improving Node.js compatibility in Cloudflare Workers](https://blog.cloudflare.com/nodejs-workers-2025/) — MEDIUM confidence, general framing that `nodejs_compat_v2` is incremental/iterative, not a single fixed set
- drizzle-orm GitHub releases `0.39.0`-`0.45.0` (fetched directly via `gh api repos/drizzle-team/drizzle-orm/releases/tags/<version>`) — HIGH confidence, primary source, directly refutes the RQB-v2-in-this-range assumption and confirms `DrizzleQueryError` (0.44.0) and pg-native Pool fix (0.45.0) as the actual notable changes
- GitHub Actions `workflow_run` event limitations — general community consensus (BSWEN, oneuptime.com deployment-gates guidance) that `workflow_run` lacks built-in success-only semantics and requires an explicit `conclusion` check — MEDIUM confidence, corroborated by GitHub's own documented event behavior
- Keycloak WebAuthn `REQUIRED`+conditional-subflow behavior — MEDIUM confidence, based on standard Keycloak authentication-flow execution semantics (no credential-aware auto-skip on plain `REQUIRED`) cross-referenced against this project's own Terraform structure and the requirements doc's SEC-12/KC-01 framing; recommend validating this specific claim against Keycloak 26.x's authentication SPI docs during Phase 26 planning if a deeper confidence bump is needed before implementation

---
*Pitfalls research for: v3.2 Security & Code Health Hardening milestone*
*Researched: 2026-07-24*
