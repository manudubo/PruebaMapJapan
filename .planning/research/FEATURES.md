# Feature Research — v3.2 Security & Code Health Hardening

**Domain:** Hardening/remediation milestone for an existing full-stack trip-planner (Hono/Cloudflare Workers + Drizzle + Neon/Postgres backend, Vanilla TS/Vite MPA frontend, Keycloak 26.6.1 IdP). Not a new-feature milestone — this document maps "correct behavior" and standard implementation shape for the five categories the orchestrator flagged as needing the deepest research, cross-referenced against `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` finding IDs.
**Researched:** 2026-07-24
**Confidence:** HIGH for categories 1-3 and 5 (verified against this repo's actual code + stable, well-established patterns); MEDIUM for category 4 (WebSearch-verified, no Context7 entry for this exact stack combination)

**Framing note:** Almost everything below is table-stakes, not differentiators — this is a hardening milestone. Don't force a differentiator framing where none exists; the honest exceptions are called out explicitly (CSP as defense-in-depth, ephemeral test DB as the enabler for all future coverage work).

---

## 1. Cross-level date coherence validation (BIZ-06/07/08/09)

**Status:** Confirmed largest business-logic gap. Verified directly against `backend/src/validation/schemas.ts` and `backend/src/routes/trips.ts` — the audit's characterization holds and is worse than a single-layer fix once you account for `.partial()` PATCH schemas.

### Current state (verified)

`backend/src/validation/schemas.ts` has **zero** `.refine()` calls. Every date field is `z.string().date().nullable().optional()` with no relational check:
- `CreateTripSchema` / `CreateDestinationSchema`: independent `start_date`/`end_date`
- `CreateDaySchema`: single `date`, no relation to parent
- `UpsertHotelSchema`: independent `check_in_date`/`check_out_date`
- Every `UpdateXSchema = CreateXSchema.partial()` — this matters, see below

`backend/src/routes/trips.ts` already has the exact plumbing this validation needs: `resolveDestination()`, `resolveDay()`, and `resolveActivity()` (lines 53-134) walk the ownership chain trip→destination→day→activity and already fetch each parent row before any mutation. **This is the reusable query the audit's BIZ-07 note refers to** — cross-level checks are a few comparisons added after an existing `resolve*` call, not new queries.

### Why this is not a schema-only fix — three separate validation layers

**Layer 1 — same-record coherence (`start_date ≤ end_date`).** This is genuinely a Zod-schema-level fix via `.refine()`, but only for the `Create*` schemas where both fields are always present in the payload semantics:

```ts
export const CreateTripSchema = z.object({
  name: z.string().min(1).max(255),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  // ...
}).refine(
  (data) => !data.start_date || !data.end_date || data.start_date <= data.end_date,
  { message: 'end_date must be on or after start_date', path: ['end_date'] },
);
```

ISO `YYYY-MM-DD` strings compare correctly with `<=` as plain strings (lexicographic order matches chronological order for zero-padded ISO dates) — no `Date` parsing needed here, which sidesteps BIZ-11's timezone footgun entirely for this specific check.

**The `.partial()` trap:** `UpdateTripSchema = CreateTripSchema.partial()` strips the `.refine()` in Zod v3 — `.partial()` is only defined on `ZodObject`, not on the `ZodEffects` wrapper a `.refine()` produces. You cannot call `.partial()` after `.refine()`. The correct shape is to build the partial **first**, then refine the partial:

```ts
export const UpdateTripSchema = CreateTripSchema._def.schema.partial().refine(
  (data) => !data.start_date || !data.end_date || data.start_date <= data.end_date,
  { message: 'end_date must be on or after start_date', path: ['end_date'] },
);
```

(Cleaner in practice: define the base `ZodObject` once, export both `.refine()` and `.partial().refine()` from it, rather than deriving Update from Create.)

But even with that fixed, a **PATCH sending only `end_date`** (the other left unset) cannot be checked against the *stored* `start_date` by a schema `.refine()` at all — the schema only sees the request body, not the database row. So partial-update same-record coherence is **also** an application-layer concern: the route handler must merge the incoming partial with the existing row (already fetched via `resolveDestination`/etc. for authz) before comparing.

**Layer 2 — cross-level (child within parent range) — BIZ-07, the named "largest gap".** This is unambiguously route-layer, not schema-layer, because it requires a DB read of the parent that Zod has no access to. Standard shape:

```ts
tripsRoute.post('/:tripId/destinations', zValidator('json', CreateDestinationSchema), async (c) => {
  // ...
  const trip = await getTripById(db, tripId); // already required for ownership check
  const body = c.req.valid('json');
  if (trip.start_date && body.start_date && body.start_date < trip.start_date) {
    return c.json({ success: false, error: 'Destination cannot start before the trip start date' }, 400);
  }
  if (trip.end_date && body.end_date && body.end_date > trip.end_date) {
    return c.json({ success: false, error: 'Destination cannot end after the trip end date' }, 400);
  }
  // ...
});
```

Same shape for day-within-destination and (per BIZ-07's explicit mention) sibling-destination overlap within a trip — the last one requires fetching *all* sibling destinations, not just the immediate parent, which is a step up in query cost from the others (still cheap at this scale, but worth flagging as a different code shape: a list-and-compare, not a single-row compare).

**Layer 3 — no-op PATCH (BIZ-09).** Separate, simpler fix, same `.refine()` mechanism as Layer 1 but content-agnostic:

```ts
.refine((data) => Object.keys(data).length > 0, { message: 'Request body cannot be empty' })
```

Apply to every `Update*Schema` once the partial-then-refine ordering issue above is resolved.

### Error-shape consistency (verified, worth calling out explicitly)

This repo has **no custom `zValidator` error hook** (checked `backend/src/index.ts` and every `zValidator(...)` call site in `trips.ts`) — validation failures fall through to `@hono/zod-validator`'s default 400 response, which is shaped differently (`{ success: false, error: <ZodError object> }`) from every hand-written route error in this file (`{ success: false, error: '<string message>' }`, ~30 occurrences). Schema-level `.refine()` failures (Layer 1, Layer 3) will inherit the default shape; route-layer checks (Layer 2) you write by hand will naturally match the string-message convention. **Recommendation:** add a shared `zValidator` wrapper with a custom hook that flattens `ZodError` into a single string message, so Layer-1/3 failures and Layer-2 failures return the same shape to the frontend. This is a small, one-time fix that also cleans up `BUG-13`'s `dest: any` cast territory (same file).

### Complexity honestly stated

Not a 1-line fix. Three entity levels (trip/destination/day, four counting activity-vs-day though activities don't carry dates) × two operations (create, partial-update) × up to three relations (self, parent, sibling) = a genuinely multi-route change touching `schemas.ts` and every mutating handler in `trips.ts`. Realistic scope: MEDIUM-HIGH, several route handlers touched, no new infrastructure required (the parent-fetch plumbing already exists via `resolve*`).

### Dependencies

- Reuses `resolveDestination`/`resolveDay` — no new query infrastructure.
- Best validated with real request/response assertions once ARCH-06 (real test DB) lands — hand-verifying 3-level date coherence via `curl` is error-prone; this is a second, independent reason (beyond ARCH-03) to sequence ARCH-06 early.
- BIZ-08 (lat/lng range + `z.coerce.string()` modeling) is a separate `.refine()`/schema fix in the same file, same PR-sized unit of work — bundle if convenient, but it's not the same validation shape (numeric range vs date range) and doesn't share code.

---

## 2. CI-gates-deploy patterns (INFRA-01/02)

**Status:** Confirmed open, verified directly against `.github/workflows/ci.yml`, `deploy-backend.yml`, `deploy-frontend.yml`. The fix pattern itself is standard and small; the landmine is *what* you gate on.

### Current state (verified)

Three independent workflow files, each with its own `on.push` trigger:
- `ci.yml`: `typecheck-frontend`, `typecheck-backend`, `test-frontend` (all independent jobs), and `e2e` (`needs: [typecheck-frontend]` only — not gated on the other two typecheck/test jobs)
- `deploy-backend.yml`: triggers on push-to-main touching `backend/**`, runs `npx wrangler deploy` directly — **no typecheck, no test, no dependency on `ci.yml` at all**
- `deploy-frontend.yml`: same shape for `frontend/**` — build only, no typecheck/test gate, no dependency on `ci.yml`

So INFRA-01 ("no `needs`/`workflow_run` gate on `ci.yml`") and INFRA-02 ("no typecheck/tests before `wrangler deploy`") are the same root cause seen from two angles: the deploy workflows are entirely decoupled from CI.

### Two standard GitHub Actions patterns for gating a deploy on CI

**(a) `workflow_run` — deploy workflow triggered by CI workflow's completion event.**

```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      # ...
```

Real gotchas with this shape (well-documented GitHub Actions pitfalls, not repo-specific): you lose the deploy workflow's own `paths:` filter (the `workflow_run` event fires on *every* CI completion regardless of what changed, so `deploy-backend.yml` would fire even on frontend-only changes unless you add a path check as a job-level condition); you must explicitly checkout `github.event.workflow_run.head_sha`, not `HEAD`, or you deploy the wrong commit; secrets/environment context needs re-declaring since it's a separate workflow run.

**(b) `needs:` — fold the required checks in as jobs inside the deploy workflow itself.**

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - '.github/workflows/deploy-backend.yml'

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci --workspace=backend
      - run: npx tsc --noEmit
        working-directory: backend
      - run: npm run build --workspace=backend   # wrangler deploy --dry-run — catches INFRA-03-class failures
      - run: npm run test --workspace=backend

  deploy:
    needs: [typecheck]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... existing deploy steps unchanged
```

This duplicates a couple of steps already in `ci.yml`'s `typecheck-backend` job, but keeps the deploy workflow self-contained, preserves the existing `paths:` filter, deploys the exact commit that triggered the push, and needs no cross-workflow event wiring.

### The dependency that changes which pattern is safe to ship (critical, not optional context)

`ARCH-09` (Cluster 6) states the `e2e` job in `ci.yml` **has never once passed** in this repo's history — reconfirmed live 2026-07-24, unrelated to the v3.1 real-auth E2E suite (that one runs locally against dev servers; this is the CI-only mocked/`SKIP_REAL_AUTH` job against a `vite preview` build, currently failing on `#trips-grid`/`#dashboard-login-prompt` visibility timeouts).

**This means pattern (a) — gating on `ci.yml`'s overall `workflow_run` success/conclusion — would brick every single deploy**, because `ci.yml` as a whole (or the `e2e` job specifically, depending on how conclusion is computed) has never gone green. **INFRA-01/02 has a hard, blocking dependency on either fixing ARCH-09 first, or explicitly scoping the deploy gate to exclude the `e2e` job** (i.e., gate only on `typecheck-frontend` + `typecheck-backend` + `test-frontend`, or — cleaner — use pattern (b) with only the jobs that are actually known-green as `needs:`). Given ARCH-09 is flagged in the candidate requirements as needing "its own isolated debugging session," the pragmatic sequencing for the roadmap is: **ship INFRA-01/02 using pattern (b), scoped to typecheck+build+unit-test only (deliberately excluding e2e), and track ARCH-09 as a separate, later gate-tightening step** once the CI e2e job is fixed. Document this exclusion explicitly in the workflow (a comment, not a silent gap) so it doesn't quietly become "CI gate but the flaky job is still allowed to fail forever."

### Complexity

LOW for the workflow YAML itself (both patterns are ~20-30 lines, standard GitHub Actions syntax, no new secrets or infra). The real work is the sequencing decision above, not the YAML.

### Dependencies

- **Blocks on / must explicitly scope around ARCH-09** (CI e2e job never green) — see above.
- **INFRA-03** (backend build currently broken — `wrangler deploy --dry-run` fails on `string_decoder`, `compatibility_date` frozen at `2024-01-01`) must land before or alongside this: gating deploy on a typecheck+build job will immediately go red until INFRA-03 is fixed, since `npm run build` in `backend/package.json` *is* `wrangler deploy --dry-run`. These two are natural same-phase companions (Phase 21 in the candidate breakdown already groups them).
- **INFRA-04** (unpinned `npx wrangler`) is an easy one-line addition to the same PR (pin `wrangler` in `backend/package.json` devDependencies) but is logically independent — don't let it block the gating work.

---

## 3. Accessibility fixes (A11Y-01..04)

**Status:** Verified directly against `frontend/src/components/SearchBar.ts`, `frontend/index.html`, `frontend/src/styles/main.css`, `frontend/trip.html`, `frontend/src/pages/tripDetail.ts`, `frontend/tokyo.html`. One of the four audit claims (A11Y-03) needed refinement once checked against actual code — noted below.

### A11Y-01 — `aria-expanded` on a non-interactive `<input>`

**Verified root cause:** `frontend/src/components/SearchBar.ts` (Shadow DOM template, line 331 + lines 582/589) puts `aria-expanded`, `aria-controls`, and `aria-autocomplete="list"` on a plain `<input type="text">` with no `role` attribute. `aria-expanded` is only a valid attribute–role pairing on elements whose implicit or explicit role supports it (`button`, `combobox`, `link`, etc. per the ARIA spec's "Allowed ARIA attributes" table) — a bare `<input>` (implicit role `textbox`) does not support `aria-expanded`, which is exactly what axe's `aria-allowed-attr` rule flags, and it's repeated on 12/13 pages because `<search-bar>` is a shared Web Component.

**Standard correct pattern:** this is already 90% of the way to the WAI-ARIA Authoring Practices **Combobox pattern** (editable combobox with list autocomplete) — it just needs the missing `role`:

```html
<input
  type="text"
  role="combobox"
  aria-expanded="false"
  aria-controls="search-dropdown"
  aria-autocomplete="list"
  aria-haspopup="listbox"
  aria-label="Search activities, places, days"
>
```

Pair with `aria-activedescendant` on the input (pointing at the currently-highlighted result's `id`) when keyboard arrow-navigation moves through the dropdown — check whether `SearchBar.ts` already does keyboard nav; if so this is a one-attribute addition, if not it's a slightly larger keyboard-interaction fix bundled with the ARIA one. The dropdown (`role="listbox"`, already present) and its items (should be `role="option"`) are the other half of the pattern — verify item markup has `role="option"` when implementing.

**Complexity:** LOW (the `role="combobox"` addition itself is a 1-line fix repeated once, since it's a single shared component) but verify the `aria-activedescendant`/keyboard-nav completeness while in the file — don't just silence the linter without checking the fuller pattern is actually met, since a half-implemented combobox role can be worse than no role for screen-reader users.

### A11Y-02 — Contrast violations

**Verified root cause (more specific than the audit's citation):** `frontend/index.html`'s inline `<style>` block uses `var(--text-secondary, #515154)` and `var(--text-tertiary, #86868b)` — **note the missing `jp-` prefix**. The app-wide design token system (`frontend/src/styles/main.css`) defines `--jp-text-secondary` (light: `#515154`, dark: `#a1a1a6`) and `--jp-text-tertiary`, not the unprefixed names `index.html` uses. Since `--text-secondary` is never defined anywhere in the cascade, every reference in `index.html` **always** falls through to its literal fallback (`#515154`) — regardless of `[data-theme="dark"]`.

This is a real, reproducible AA failure, not a borderline call: `index.html` sets `html[data-theme="dark"] { background: #000; }` (confirmed, line 18). `#515154` text on a `#000000` background computes to a contrast ratio of **~2.66:1** — below the WCAG AA 4.5:1 threshold for normal text (and the `.demo-countdown-title`/`.landing-loading > span` text is 13-14px, not large-text-exempt). On the light background it's fine (~7.9:1) — this is a **dark-mode-only regression** caused by a token-naming typo, not a color-choice problem.

**Standard correct pattern:** rename every `var(--text-secondary, ...)` / `var(--text-tertiary, ...)` / `var(--bg-secondary, ...)` / `var(--border-strong, ...)` / `var(--accent, ...)` reference in `index.html` (and check `trip.html`, which has the same unprefixed pattern at lines 43/51/59/71 — same bug, same fix) to the correct `--jp-*` names already defined in `main.css`. This is a find-and-replace fix once identified, not a new design decision — the correct dark-mode-safe colors already exist in the token system, they're just not being referenced.

**Dashboard `.nav-link` and profile page contrast (13 nodes, per audit)** — not independently verified in this pass (not one of the files read); given the pattern found above, check `Navbar.ts` and `profile.html`/`profile.ts` inline styles for the same unprefixed-variable-name class of bug before assuming these need bespoke color changes — likely the same root cause repeated.

**Complexity:** LOW once the root cause is understood (variable renames), but don't undersell the audit step: this needs a systematic grep for `var(--[a-z-]+,` patterns that don't start with `--jp-` across every HTML file, not just the two checked here, since the same copy-paste-without-refactor pattern likely repeats.

### A11Y-03 — Missing `<h1>` in "initial (loading/guest/error) state"

**Audit claim needed refinement — verified against actual code, not assumed.** `trip.html` (lines 89-95) has `<h1 id="trip-title">Loading trip…</h1>` present unconditionally in the static markup — the **loading** state does have an `<h1>`. The actual gap is narrower and different: `frontend/src/pages/tripDetail.ts`'s `showError()` function (lines 466-484) does `main.innerHTML = ''` and rebuilds the entire `<main>` content with only a `<p>` (error message) and an `<a>` (back-to-dashboard link) — **no heading of any kind**, including no `<h1>`. This fires whenever `getPublicTrip(slug)` throws, or `tripId` is missing/invalid from the URL — i.e., the genuine **error state**, not "loading" or "guest" (the guest/slug-view path at line 497-516 keeps the header with its `<h1>` intact and just hides owner-only controls).

**Standard correct pattern:** every distinct page state a screen-reader user can land on needs exactly one `<h1>` reachable in the accessibility tree, even error states — this is a basic WCAG 2.4.6/1.3.1 (heading structure conveys page identity/purpose) requirement, doubly important here because `showError()` wipes `<main>` including the nav landmark's sibling heading:

```ts
function showError(message: string): void {
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'page-card';
  card.style.padding = '32px';
  card.style.textAlign = 'center';

  const h1 = document.createElement('h1');
  h1.textContent = 'Trip unavailable';
  card.appendChild(h1);

  const p = document.createElement('p');
  // ... existing message + link unchanged
}
```

**Complexity:** LOW (a few added lines in one function). Correct the finding's framing when writing REQUIREMENTS.md — it's an error-state gap, not a loading-state gap, so acceptance criteria should target `showError()` specifically, not the whole page's initial render.

### A11Y-04 — `tokyo.html` heading-order and target-size violations

**Heading-order — verified:** `tokyo.html` goes `<h1>Tokyo</h1>` (line 38) directly to `<h3>Activities</h3>` (line 47) — skips `<h2>`. This is the same "Activities" legend heading pattern as `trip.html` (also `<h3>` directly under an `<h1>`, no intervening `<h2>`), so the fix likely needs to be applied consistently across all 9 static city pages plus `trip.html`, not just `tokyo.html` (the audit only ran axe against `tokyo.html` as a representative sample per its methodology, per Cluster 5's framing — worth verifying the other 8 static city pages share the identical template structure, which is very likely given this is a shared-layout MPA).

**Standard correct pattern:** demote `<h3>Activities</h3>` to `<h2>Activities</h2>` (or promote intermediate structure) so the heading tree has no skipped levels — `<h1>` (page/trip title) → `<h2>` (section: Activities) → `<h3>` (if any sub-groupings exist within the legend, e.g. per-day groups) is the WCAG-correct nesting. Since this is a copy-pasted static-page structure across 9 HTML files, this is a find-and-replace across all of them, not a single-file fix — flag that in scoping, don't treat it as `tokyo.html`-only.

**Target-size — not independently verified this pass** (no specific element identified in the files read); standard fix shape is ensuring interactive targets (buttons/tabs/links) meet the WCAG 2.5.8 24×24px minimum (or 44×44px for AAA / mobile-first guidance) via `min-width`/`min-height`/padding on small icon buttons — this repo has several small icon-only controls (`.hotel-btn`, `.clear-btn` in SearchBar, tab buttons) that are plausible candidates; needs its own axe/Lighthouse pass against the current `dist` build to identify exact offenders rather than guessing, since CSS sizing wasn't part of the files read for this research pass.

### Complexity summary for Cluster 5

All four are LOW-complexity, high-leverage fixes (small diffs, no new infrastructure, no new dependencies) — but A11Y-01/02/04 each repeat across multiple files (shared component or copy-pasted static pages), so the *diff size* is larger than the *conceptual* fix. Frame these as "small fix, wide blast radius" rather than "1-line fix" when scoping the phase.

---

## 4. Ephemeral test-database patterns for Vitest + Postgres (ARCH-06 / T-01)

**Status:** Confirmed highest-ROI test fix in the audit. Verified this repo's specific constraints against general Hono+Drizzle+Vitest community patterns (WebSearch-verified, MEDIUM confidence — no single canonical source for this exact stack combination, but the pattern converges across several sources).

### Current state (verified)

`backend/src/routes/public.test.ts` hardcodes `DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb'` in a `mockEnv` object passed to `app.request(path, {}, mockEnv)`. Since that database doesn't exist, every DB-touching assertion degrades to `expect([200, 500]).toContain(res.status)` — a real Postgres is already running locally (`keycloak/docker-compose.yml`'s `postgres` service, port 5432, db name `japan_trip`, user/pass `postgres`/`postgres`) but is **currently used only by Keycloak**, not by the backend test suite.

Two repo-specific constraints that shape the right pattern here (not generic advice):

1. **The Keycloak Postgres instance should not be reused directly for backend tests.** It's already scoped to Keycloak's own schema/data (`KC_DB_URL: jdbc:postgresql://postgres:5432/japan_trip`). The right move is a **second, dedicated test database** on the same Postgres server/container (e.g. `japan_trip_test`), not sharing `japan_trip` — avoids any risk of test runs truncating/mutating Keycloak's tables, and avoids schema collisions since Drizzle's migrations only know about the app schema, not Keycloak's.
2. **Route handlers call `getDb(c.env.DATABASE_URL)` internally** (verified in `trips.ts`, `public.test.ts`) rather than receiving an injected `db` instance — there's no dependency-injection seam for a test-scoped transaction wrapper. This rules out the cleanest isolation pattern (wrap each test in a transaction, roll back after) without a non-trivial refactor to thread a shared `db` handle through `Env`/context. **Realistic near-term shape is migrate-once-per-suite + truncate-between-tests (or between files)**, not per-test transaction rollback — note this explicitly so the phase plan doesn't assume the fancier pattern is free.

### Standard pattern (converged from community sources, adapted to the two constraints above)

```
1. .env.test (or CI env var) sets DATABASE_URL to postgresql://postgres:postgres@localhost:5432/japan_trip_test
2. A one-time setup step (package.json script or Vitest globalSetup) runs drizzle-kit migrate
   against that URL before the suite starts — reuses the existing migrations in backend/src/db/migrations,
   no schema duplication.
3. mockEnv in each *.test.ts file points DATABASE_URL at the real test DB URL instead of the fake one.
4. Between test files (or between tests within a file, via beforeEach), TRUNCATE ... CASCADE the app
   tables (or DELETE FROM in FK-dependency order: activities, days, hotels, destinations, trips, users)
   to reset state without re-running migrations each time.
5. A minimal seed helper (insert one user + one trip fixture) replaces ad-hoc UUIDs like the existing
   VALID_SLUG constant, so tests assert against real rows instead of guessing at UUIDs that will never match.
```

Vitest's `globalSetup` (a file exported via `test.globalSetup` in `vitest.config.ts`, not currently present in `backend/`) is the standard hook point for step 2 — runs once before any test file, separate from per-file `beforeAll`/`beforeEach`.

### ARCH-02 interaction (verified, favorable)

`ARCH-02` notes the dual-driver selection (`node-postgres` locally / `neon-http` in prod) is chosen by a `localhost` substring match on the connection string, not an explicit env var. This is actually a **free win** for the test-DB fix: a `postgresql://postgres:postgres@localhost:5432/japan_trip_test` URL contains `localhost`, so it automatically routes through the same `pg` driver path already used for local dev — no new driver-selection code needed to wire this up. (It's still worth fixing ARCH-02's fragility separately, but it doesn't block or complicate this fix.)

### Complexity

MEDIUM. Not a 1-line fix — needs: a `docker-compose` addition or reuse of the existing Keycloak Postgres container with a second DB created, a migration-run step wired into `package.json`/CI, truncate/seed helpers shared across `*.test.ts` files, and updating every existing `mockEnv` (`public.test.ts`, `auth.test.ts`, `index.test.ts`) to point at the real URL. No new *product* code changes — this is test-infrastructure-only, which is why it's flagged as highest-ROI: it turns already-passing-vacuously assertions into real coverage "for free" once the plumbing exists.

### Dependencies

- **Unblocks ARCH-03** directly (the audit's own framing: "turns this from 'write new tests' into 'point existing infra at real data'") — `trips.ts`'s 1017-line ownership-cascade authorization logic currently has zero unit tests; a real test DB is the prerequisite, not an independent parallel task.
- **Also serves Category 1** (date-coherence validation) — asserting 3-level date coherence logic needs real parent/child rows in a real DB to be meaningful; hand-verifying via manual `curl` calls doesn't scale to the number of edge cases (same-record, cross-level, sibling-overlap × create/update).
- Should land **early** in whichever phase covers architecture/test-quality (candidate Phase 24) — both ARCH-03 and any BIZ-06/07 test coverage are downstream of it.

---

## 5. Service worker cache-versioning tied to build output (SEC-16)

**Status:** Confirmed open, verified against `frontend/public/sw.js` and `frontend/vite.config.ts`.

### Current state (verified)

`frontend/public/sw.js` hardcodes `const CACHE_NAME = 'japan-trip-v3';` at the top of the file. It's a **static file in `public/`**, copied byte-for-byte to `dist/sw.js` by Vite's build — Vite does not process, hash, or template files in `public/` (that's the documented distinction between `public/` and asset imports in Vite's asset-handling model). So there is currently no mechanism, hand-rolled or otherwise, connecting `CACHE_NAME` to anything about the build: the `activate` handler's cache-purge logic (`keys.filter(key => key !== CACHE_NAME)`) is correct in principle but never fires meaningfully, because `CACHE_NAME` never changes between deploys — confirming the audit's framing exactly: returning users can get stuck on a stale cached app version indefinitely, including stale security fixes.

`frontend/package.json` has no `vite-plugin-pwa` or `workbox-*` dependency currently — this would be **new infrastructure** if chosen, not a config tweak to something already present.

### Two standard approaches

**(a) Workbox / `vite-plugin-pwa` (`injectManifest` or `generateSW` mode).** The conventional, off-the-shelf answer: `vite-plugin-pwa` generates a content-hashed precache manifest at build time and derives cache names from a build-time revision automatically — `activate` cleanup is handled by Workbox's own runtime, no hand-written cache-name-diffing needed. This is the "standard" answer in the broader ecosystem, but it's a new dependency, a new build step, and a shift from this project's fully hand-rolled SW (which the team has maintained deliberately — see `INFRA-06`'s note that `EXTERNAL_ASSETS` is dead precache-list code, i.e., there's already SW-maintenance debt independent of this fix). Given the project's stated stack commitment is "Vanilla TypeScript... no framework migration" (a backend-framing constraint in `PROJECT.md`, but the same minimal-dependency ethos has held for the frontend/SW throughout), a hand-rolled fix is more consistent with how the rest of this codebase is built, and is proportionate to the size of the actual bug.

**(b) Hand-rolled: derive `CACHE_NAME` from a build identifier, injected into `sw.js` at build time.** Since `sw.js` lives in `public/` and isn't part of Vite's module graph, it needs to either move into the build pipeline or be post-processed. Two sub-options:

- **Post-build string replace (smallest diff, most consistent with existing patterns):** add a short `scripts/stamp-sw.mjs` (or a few lines in an existing build script) that runs after `vite build`, reads `dist/sw.js`, replaces `'japan-trip-v3'` with a version string derived from `git rev-parse --short HEAD` (or `package.json`'s `version` field, or a timestamp) at build time, and writes it back. Wire into `frontend/package.json`'s `build` script: `"build": "tsc && vite build && node scripts/stamp-sw.mjs"`.
- **Vite `define` + move `sw.js` into the build graph:** relocate `sw.js` out of `public/` into `src/` (e.g. `src/sw.ts`), add it as a Rollup input in `vite.config.ts` (same pattern already used for the multi-page `rollupOptions.input` config), and use Vite's `define` (`__BUILD_ID__: JSON.stringify(...)`) to inject a build-time constant Vite resolves at compile time. This is "more correct" in that the SW becomes a first-class build artifact (also sets up the fix for `INFRA-06`'s dead `EXTERNAL_ASSETS` precache list, and `SEC-15`'s Leaflet-via-npm bundling, which both touch this same file/area) but is a larger structural change than strictly needed to close SEC-16 alone.

**Recommendation given repo conventions and scope:** option (b)'s post-build string-replace is the right-sized fix for SEC-16 in isolation — smallest diff, no new dependency, consistent with the hand-rolled SW already in place. Flag the "move `sw.js` into `src/`" restructure as a *candidate* follow-up if/when `INFRA-06` and `SEC-15` are tackled in the same phase (Cluster 5/candidate Phase 23 groups SEC-15/16/INFRA-06 together already) — bundling the restructure with those would amortize the one-time cost of moving the file into the build graph across three fixes instead of one.

**Second required change (called out in the audit, don't drop it):** SEC-16 isn't just "rotate the cache name" — the audit also flags that HTML/navigation is served **cache-first**, which is the wrong strategy even with correct versioning (a user can still get a stale shell on a slow/interrupted `activate`). The `fetch` handler's `caches.match(event.request).then(cached => cached || fetch(...))` logic should switch to **network-first (or stale-while-revalidate) specifically for navigation requests** (`event.request.mode === 'navigate'`), while non-HTML static assets can safely stay cache-first since their names/hashes change on content change (once bundled through Vite properly). This is a second, independent code change in the same `fetch` handler, not automatically fixed by cache-name versioning alone.

### Complexity

LOW-MEDIUM for the minimal (post-build string-replace) fix: one new small script, one `package.json` build-script edit, plus the separate network-first-for-navigation change to the existing `fetch` handler (a real logic change, not just a rename, so it needs manual verification that offline fallback — `caches.match('./index.html')` on fetch failure — still works). MEDIUM-HIGH if bundled with the `src/sw.ts` restructure alongside INFRA-06/SEC-15.

### Dependencies

- Naturally pairs with **INFRA-06** (dead `EXTERNAL_ASSETS` precache array) and **SEC-15** (Leaflet SRI / bundle via Vite instead of `unpkg.com`) — all three touch the same file and the same "make the SW actually reflect what's shipped" theme. Candidate Phase 23 already groups them; recommend keeping them together rather than splitting SEC-16 into its own phase.
- No dependency on Category 4 (test DB) or Category 1 (date validation) — fully independent, can be sequenced any time relative to those.

---

## Table-stakes vs differentiator framing (all five categories)

| Category | Framing | Why |
|---|---|---|
| 1. Date coherence | Table stakes | A trip-planning app that lets you construct a temporally impossible itinerary is broken, not merely unpolished — this is core-value-adjacent (`PROJECT.md`'s stated core value is building a *complete, correct* itinerary), not a nice-to-have |
| 2. CI-gates-deploy | Table stakes | Baseline engineering hygiene for any project with a deploy pipeline; the interesting content here is the ARCH-09 dependency, not a design choice |
| 3. Accessibility | Table stakes | WCAG AA baseline; none of these are "differentiator" territory, they're correctness bugs in the ARIA/contrast/heading-structure sense |
| 4. Ephemeral test DB | Table stakes, but the one item worth calling a genuine enabler | Doesn't ship user-facing behavior, but is the single highest-leverage item in this list — it's the prerequisite that turns future coverage work (ARCH-03 and beyond) from "write tests" into "point infra at real data" |
| 5. SW cache versioning | Table stakes with one differentiator-adjacent angle | The bug itself (stale cache) is baseline PWA correctness; CSP (SEC-04, adjacent finding) plus this fix together are the closest thing to a genuine "defense in depth" posture improvement in this milestone, worth naming explicitly since it's the one place security hardening compounds rather than just closing individual holes |

## Sources

- Direct repository inspection (HIGH confidence, primary source for all five categories): `backend/src/validation/schemas.ts`, `backend/src/routes/trips.ts`, `backend/src/routes/public.test.ts`, `backend/src/db/schema.ts`, `backend/package.json`, `backend/drizzle.config.ts`, `backend/wrangler.toml`, `keycloak/docker-compose.yml`, `.github/workflows/{ci,deploy-backend,deploy-frontend}.yml`, `frontend/src/components/SearchBar.ts`, `frontend/index.html`, `frontend/trip.html`, `frontend/tokyo.html`, `frontend/src/pages/tripDetail.ts`, `frontend/src/styles/main.css`, `frontend/public/sw.js`, `frontend/vite.config.ts`, `frontend/package.json`
- `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` (source of all finding IDs referenced)
- [Drizzle ORM Testing Guide: Unit & Integration Tests](https://helpmetest.com/blog/drizzle-orm-testing-guide/) — MEDIUM confidence, WebSearch-verified pattern for migrate-once + truncate-between-tests
- [Using in-memory Postgres when testing with vitest · drizzle-orm#4205](https://github.com/drizzle-team/drizzle-orm/issues/4205) — MEDIUM confidence, community discussion confirming real-Postgres-over-mocks is the converged practice
- [Error handling in Validator - Hono official docs](https://hono.dev/examples/validator-error-handling) — HIGH confidence, confirms `zValidator` default hook behavior and custom-hook pattern for consistent error shapes
- WAI-ARIA Authoring Practices Guide (Combobox pattern) — HIGH confidence, stable/well-established spec, used from training knowledge for the `role="combobox"` fix shape
- GitHub Actions `workflow_run` / `needs` documentation — HIGH confidence, stable well-established feature, used from training knowledge; repo-specific gotchas (path-filter loss, `head_sha` checkout) are commonly documented pitfalls, not repo-specific findings
- Vite static asset handling (`public/` vs module graph) — HIGH confidence, stable documented Vite behavior, used from training knowledge to explain why `sw.js` isn't hashed automatically

---
*Feature research for: v3.2 Security & Code Health Hardening*
*Researched: 2026-07-24*
