# Phase 21: Deploy & Build Safety - Research

**Researched:** 2026-07-25
**Domain:** GitHub Actions workflow_run CI gates, Cloudflare Workers compatibility flags, Keycloak Docker healthcheck, npm dependency security
**Confidence:** HIGH (most claims verified via tooling or official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**INFRA-01/02: CI Gate Architecture**
- D-01: Deploy workflows use `workflow_run` trigger — both `deploy-frontend.yml` and `deploy-backend.yml` trigger `on: workflow_run: workflows: [CI] branches: [main] types: [completed]` with gate condition `if: github.event.workflow_run.conclusion == 'success'`
- D-02: The `e2e` job in `ci.yml` gets `continue-on-error: true`
- D-03: A new `test-backend` job is added to `ci.yml` running `npm run test --workspace=backend`
- D-04: `deploy-frontend.yml` gates on `typecheck-frontend` and `test-frontend`; `deploy-backend.yml` gates on `typecheck-backend` and `test-backend`

**INFRA-03: Backend Build Fix**
- D-05: `backend/wrangler.toml` `compatibility_date` bumped from `"2024-01-01"` to `"2024-09-23"`

**INFRA-04: Wrangler Pin**
- D-06: `wrangler ^3.101.0` already in `backend/package.json` devDependencies; deploy workflow changes from `npx wrangler deploy` to `npm run deploy --workspace=backend`

**INFRA-05: KC Healthcheck**
- D-07: Replace `curl -sf http://localhost:8080/realms/japan-trip` with `wget -q --spider http://localhost:8080/health/ready` in `keycloak/docker-compose.yml`
- **(NOTE: This decision has implementation conflicts — see INFRA-05 section below for required deviations)**

**DEP-01: Dependency Bumps**
- D-08: `drizzle-orm` bumped to `^0.45.2`
- D-09: `dompurify` bumped to `^3.4.12`

### Claude's Discretion
- Exact CI yaml structure (job names, caching, node-version) within the `workflow_run` pattern: follow existing ci.yml conventions
- Whether `deploy-backend.yml` should also include `npm run build --workspace=backend` (wrangler dry-run) as an inline gate step

### Deferred Ideas (OUT OF SCOPE)
- None
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Deploy workflows gate on typecheck/build/unit-test CI jobs, excluding e2e | `workflow_run` trigger with `conclusion == 'success'`; `continue-on-error: true` on e2e |
| INFRA-02 | Backend deploy runs typecheck/tests before deploy; backend CI unit-test job exists | New `test-backend` job in ci.yml; `typecheck-backend` already exists |
| INFRA-03 | `wrangler deploy --dry-run` exits 0; `compatibility_date` ≥ 2024-09-23 | VERIFIED: current build fails with 25 errors; error message confirms fix date |
| INFRA-04 | `wrangler` pinned as devDep; no `npx wrangler` in any backend script | VERIFIED: already in devDeps; fix is workflow change only |
| INFRA-05 | KC Docker healthcheck uses method available in quay.io/keycloak/keycloak:26.6.1 | `wget` NOT available; use `/proc/net/tcp` or `/dev/tcp` — see deviation section |
| DEP-01 | drizzle-orm ≥ 0.45.2; dompurify ≥ 3.4.12; runtime vulns resolved | VERIFIED: both versions confirmed on npm; RQBv1 API safe through 0.45.x |
</phase_requirements>

---

## Summary

Phase 21 consists of six independent fixes that span CI workflow configuration, Cloudflare Workers build configuration, Keycloak Docker setup, and npm dependency versions. The work is primarily configuration-level — no new logic is added — but several fixes have non-obvious gotchas that will break the implementation if missed.

The highest-confidence fix is INFRA-03: the current `wrangler deploy --dry-run` fails with 25 errors and the error message itself specifies the `compatibility_date` that resolves it. INFRA-04 is already half-done (wrangler is already a devDep). INFRA-01/02 via `workflow_run` has two critical YAML details (the checkout SHA and the loss of `paths:` filtering) that must be addressed or explicitly accepted.

INFRA-05 has a locked decision (D-07) that is unimplementable as written: `wget` is not in the Keycloak container image and the health endpoint is on port 9000, not 8080. The planner must deviate from the letter of D-07 while honoring its spirit.

DEP-01's drizzle-orm bump is safe for this codebase's query patterns, but the ROADMAP success criterion #5 ("0 HIGH or CRITICAL") cannot be met by drizzle-only bump — hono has 17 HIGH advisories that are unfixed. A hono bump to `^4.12.32` is non-breaking and closes the gap; the planner must decide whether to include it.

**Primary recommendation:** Implement all six changes in a single commit wave. Sequence: INFRA-03 first (fixes the build), then DEP-01 (verify build still passes after drizzle bump), then INFRA-01/02 (CI gate), INFRA-04/05 (workflow and Docker changes). Include hono bump in DEP-01 to satisfy success criterion #5.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CI gate logic | GitHub Actions | — | Workflow configuration; runs outside app tiers |
| Backend build verification | Cloudflare Workers (esbuild) | CI | wrangler dry-run is the build check |
| Wrangler invocation | CI (deploy workflow) | local dev | Script change in package.json affects both |
| Docker healthcheck | Docker Compose | — | Container-local, no app tier involvement |
| npm dependency versions | Backend (prod) / Frontend (prod) | — | package.json changes in respective workspaces |

---

## Standard Stack

### Core Tools in Scope

| Tool | Current Version | Target Version | Role |
|------|----------------|----------------|------|
| wrangler | 3.114.17 (installed) | `^3.101.0` (no change) | CF Workers bundler/deployer |
| drizzle-orm | 0.38.3 | 0.45.2 | ORM for Neon Postgres |
| drizzle-kit | 0.30.1 | 0.30.1 (unchanged, see Pitfall 4) | Migration tooling |
| dompurify | 3.4.1 (frontend) | 3.4.12 | DOM sanitization |
| hono | 4.6.17+ | 4.12.32 (see DEP-01 gap note) | HTTP framework |

**Version verification:** [VERIFIED: `npm view drizzle-orm version` → `0.45.2`; `npm view dompurify version` → `3.4.12`; `npm view hono version` → `4.12.32`]

---

## Architecture Patterns

### System Architecture Diagram

```
push to main
    │
    ▼
CI workflow (ci.yml)
├── typecheck-frontend ─────────────────────┐
├── typecheck-backend ────────────────────────┤
├── test-frontend ──────────────────────────┤
├── test-backend (NEW) ─────────────────────┤  all non-continue-on-error
├── build-backend (RECOMMENDED NEW) ─────────┤  jobs must pass →
└── e2e [continue-on-error: true] ─────────┘  workflow.conclusion = "success"
                                                │
                    ┌───────────────────────────┤
                    ▼                           ▼
        workflow_run trigger             workflow_run trigger
        (deploy-frontend.yml)            (deploy-backend.yml)
                    │                           │
              if: conclusion                if: conclusion
                == 'success'                 == 'success'
                    │                           │
              checkout at                  checkout at
           head_sha (CRITICAL)           head_sha (CRITICAL)
                    │                           │
              build frontend              npm run deploy
              deploy to Pages            (wrangler deploy)
```

### Recommended Project Structure (CI files)

```
.github/workflows/
├── ci.yml              # Add test-backend job; e2e gets continue-on-error: true; add build-backend
├── deploy-frontend.yml # Switch trigger from push to workflow_run; add ref: head_sha to checkout
└── deploy-backend.yml  # Switch trigger from push to workflow_run; npx → npm run deploy; add ref: head_sha
```

### Anti-Patterns to Avoid

- **`actions/checkout@v4` without `ref:` in a `workflow_run` workflow:** Checks out default branch HEAD, not the SHA CI validated. The SHA that CI ran on and the SHA that gets deployed diverge under rapid pushes.
- **Trusting `paths:` filtering carries over to `workflow_run`:** The `workflow_run` event does NOT support `paths:` or `paths-ignore` filters. Every completed CI run on main triggers both deploy workflows.
- **Checking job-level conclusion for e2e:** With `continue-on-error: true`, `needs.e2e.result` will be `"success"` even when e2e fails. There is no field that exposes the actual failure; this is intentional GitHub Actions behavior used to implement D-02.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CI gate | Custom webhook or polling | `workflow_run` trigger + `conclusion == 'success'` | Native GH feature; atomic |
| Node.js compat polyfills | Custom polyfill layer | `compatibility_date = "2024-09-23"` + `nodejs_compat` flag | CF provides verified polyfills |
| KC container tool detection | Bundling curl/wget in image | `/proc/net/tcp` check (cat + grep) | No image modification needed |

---

## INFRA-03: Compatibility Date Deep Dive

### Verified Build Error

Running `npm run build --workspace=backend` (= `wrangler deploy --dry-run`) produces 25 errors: [VERIFIED: local run]

```
ERROR: Could not resolve "events"
  The package "events" wasn't found on the file system but is built into node.
  - Make sure to prefix the module name with "node:" or update your
    compatibility_date to 2024-09-23 or later.
```

The modules failing to resolve: `events`, `fs`, `stream`, `path`, `os`, `util`, `net`, `tls`, and others — all Node.js builtins referenced by `pg-cloudflare` and related packages.

### What `2024-09-23` Activates

Setting `compatibility_date = "2024-09-23"` with `nodejs_compat` flag automatically enables `nodejs_compat_v2`, which: [CITED: developers.cloudflare.com/workers/configuration/compatibility-flags/]

- Bundles Node.js built-in polyfills as first-class modules (no `node:` prefix required)
- Expands the set of importable npm packages (body-parser, jsonwebtoken, etc.)
- Slightly increases Worker bundle size

The `nodejs_compat` flag is already in `wrangler.toml`; only the date needs changing. [VERIFIED: file read]

### Verification After Fix

```bash
cd backend && npm run build   # wrangler deploy --dry-run — must exit 0
npm run typecheck --workspace=backend
```

---

## INFRA-01/02: workflow_run Deep Dive

### Verified YAML Pattern

```yaml
# deploy-frontend.yml and deploy-backend.yml
on:
  workflow_run:
    workflows: [CI]          # must match the `name:` field in ci.yml exactly
    branches: [main]
    types: [completed]

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}  # CRITICAL — see Pitfall 1
```

[CITED: docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_run]

### Gating Mechanism

`workflow_run.conclusion == 'success'` is the WORKFLOW-level conclusion, not a job-level check. This means:
- If any job WITHOUT `continue-on-error: true` fails → conclusion = `failure` → deploy blocked
- If only `e2e` (which has `continue-on-error: true`) fails → conclusion = `success` → deploy proceeds
- D-04's "gates on typecheck-frontend and test-frontend" is satisfied implicitly: those jobs don't have `continue-on-error`, so their failure sets conclusion to `failure`

[VERIFIED: GitHub community discussion — `continue-on-error: true` at job level → workflow conclusion reports `success` even on job failure]

### `continue-on-error: true` Effect

At the **job level**, `continue-on-error: true` means:
- The job runs and shows as failed in the Actions UI
- `needs.e2e.result` reports `"success"` in any dependent jobs [VERIFIED: GH community]
- `github.event.workflow_run.conclusion` reads `"success"` even when e2e fails
- ARCH-09 (Phase 24) removes this flag once e2e is fixed

### Loss of `paths:` Filter — Required Decision

**The current deploy workflows use `paths:` filters:**
- `deploy-frontend.yml` triggers only on changes to `frontend/**` or the workflow file itself
- `deploy-backend.yml` triggers only on changes to `backend/**` or the workflow file itself

**`workflow_run` does NOT support `paths:` or `paths-ignore`** — this is not a configuration option; it is absent from the event's supported filters. [CITED: docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions]

**After the switch:** Every green CI run on `main` triggers BOTH deploy workflows, regardless of which files changed. A docs-only commit will redeploy the Worker and republish Pages.

**Planner decision required:** Either accept this behavior (acceptable for a personal project with low push frequency), or add a `dorny/paths-filter` check step inside the deploy job to gate on relevant files:

```yaml
# Optional mitigation inside the deploy job
- uses: dorny/paths-filter@v3
  id: filter
  with:
    base: ${{ github.event.workflow_run.head_sha }}^
    ref: ${{ github.event.workflow_run.head_sha }}
    filters: |
      relevant:
        - 'frontend/**'
- if: steps.filter.outputs.relevant == 'true'
  run: # ... deploy steps
```

---

## INFRA-04: Wrangler Pin Deep Dive

### Current State (Verified)

`backend/package.json` already has: [VERIFIED: file read]
```json
"devDependencies": {
  "wrangler": "^3.101.0"
}
```

`deploy-backend.yml` currently uses:
```yaml
run: npx wrangler deploy
working-directory: backend
```

### The Single Change Required

Change the deploy step to use the declared devDep:
```yaml
run: npm run deploy --workspace=backend
```

(No `working-directory:` needed since `--workspace=backend` handles it.)

### Exact vs. Range Pin

`^3.101.0` is a **semver caret range**, not an exact version. The installed version is currently `3.114.17`. INFRA-04's requirement says "pinned as a devDependency" — whether this means exact version (`"3.101.0"`) or range (`"^3.101.0"`) is ambiguous. The critical change is eliminating `npx wrangler` (which pulls latest without regard to package.json). [ASSUMED: range satisfies "pinned devDep" intent; planner may choose to add exact version if strict interpretation required]

---

## INFRA-05: Keycloak Healthcheck — Required Deviation from D-07

### D-07 Is Unimplementable As Written

D-07 specifies: `wget -q --spider http://localhost:8080/health/ready`

**Both elements are wrong:**

1. **`wget` is not available** in `quay.io/keycloak/keycloak:26.6.1`. The KC container image is based on `ubi9-micro`, which contains "only enough for a bash shell, and to run Keycloak itself." [CITED: keycloak.org/server/containers — "Due to security measures that remove curl and other packages from the Keycloak container image"]

2. **Port 8080 is wrong.** The KC health endpoint (`/health/ready`) is on the **management port 9000**, not the application port 8080. Port 8080 serves the KC application (login pages, token endpoints, admin console). [CITED: keycloak.org/observability/health — "exposed on the management port 9000 by default"]

### Available Tools in KC Container

Confirmed available: `bash`, `cat`, `grep`, `/proc/net/tcp` [CITED: multiple KC healthcheck discussions; official KC container docs]

`/dev/tcp` (bash TCP redirect): available if `/bin/sh` resolves to bash. In `ubi9-micro`, `/bin/sh` is typically bash-linked, but this is unconfirmed empirically for the KC wrapper. [ASSUMED: /dev/tcp works; use `/proc/net/tcp` as the safe fallback]

### Working Approaches

**Option A — Port check via `/proc/net/tcp` (safest, uses only cat+grep):**

Checks that the KC management port is bound. Port 9000 in hex = `0x2328`. Must check both TCP stacks:

```yaml
healthcheck:
  test: ["CMD-SHELL", "cat /proc/net/tcp6 | grep -q '00000000000000000000000000002328' || cat /proc/net/tcp | grep -q '00000000:2328'"]
  interval: 10s
  timeout: 5s
  retries: 15
  start_period: 30s
```

Port 8080 in hex = `0x1F90` (simpler alternative if management port is not exposed):
```
cat /proc/net/tcp | grep -q '00000000:1F90'
```

**Option B — HTTP health check via bash `/dev/tcp` on port 9000 (checks actual readiness):**

```yaml
healthcheck:
  test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/localhost/9000 && printf 'GET /health/ready HTTP/1.0\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && head -1 <&3 | grep -q '200'"]
  interval: 10s
  timeout: 5s
  retries: 15
  start_period: 30s
```

Use `["CMD", "bash", "-c", "..."]` form (not `CMD-SHELL`) to ensure bash is used (not `/bin/sh`), which is required for `/dev/tcp`.

### KC_HEALTH_ENABLED

The `/health/ready` endpoint requires `KC_HEALTH_ENABLED: "true"` to be set. [CITED: keycloak.org/observability/health]

In `start-dev` mode, health may or may not be enabled by default. Add to `keycloak/docker-compose.yml` environment:
```yaml
KC_HEALTH_ENABLED: "true"
```

This is needed for Option B (HTTP check); not needed for Option A (TCP port check).

### Recommended Implementation

Use **Option A** (port check on 8080 or 9000 via `/proc/net/tcp`) to avoid the bash/sh ambiguity. For the management port approach that aligns with D-07's intent, combine with `KC_HEALTH_ENABLED: "true"` and check port 9000. For the simplest equivalent to the current behavior (port open = KC started), check port 8080.

The planner must choose one and document the deviation from D-07.

---

## DEP-01: Dependency Bumps Deep Dive

### drizzle-orm 0.38.3 → 0.45.2

**API safety:** [VERIFIED: grep of backend/src] The backend uses:
- Standard query builders: `eq`, `and`, `asc`, `desc`, `gt`, `isNull`, `sql`, `inArray` — unchanged
- **Relational query API (RQBv1):** `db.query.trips.findFirst({ with: {...} })`, `db.query.destinations.findFirst(...)` — present in `queries/trips.ts` and `queries/destinations.ts`
- Schema: `pgTable`, `relations` from `drizzle-orm/pg-core` — unchanged

**RQBv1 is NOT removed in 0.45.2.** Removal only occurs in 1.0.x (currently in beta/rc as a separate dist-tag). The `latest` tag on npm is `0.45.2`. [VERIFIED: `npm view drizzle-orm dist-tags`]

**Breaking changes between 0.38.3 and 0.45.2:** [CITED: github.com/drizzle-team/drizzle-orm/releases]
- 0.39.0: No breaking changes (added Bun SQL, WITH clause for INSERT/UPDATE/DELETE)
- 0.43.0: Added cross/lateral joins (no removal)
- 0.44.0: Introduced `DrizzleQueryError` wrapping DB driver errors (adds properties to thrown errors; existing catch blocks that check `error.message` are unaffected)
- 0.45.0: Fixed pg-native Pool detection; $onUpdate SQL values fix

**npm labels 0.45.2 as "breaking change"** (`npm audit fix --force`) because the fix patches a SQL injection in `sql.identifier()` and `sql.as()`. The "breaking" label is npm's conservative policy, not an API surface change. [CITED: github.com/advisories/GHSA-gpj5-g38j-94v9]

**drizzle-kit compatibility concern:** Current drizzle-kit is `^0.30.1`; latest is `0.31.10`. Official guidance aligns drizzle-orm and drizzle-kit major versions. The `db:generate`/`db:migrate` commands may warn or behave unexpectedly with a kit/orm version mismatch. The planner should bump drizzle-kit to `^0.31.10` in the same commit or verify `db:generate` works after the orm bump. [ASSUMED: 0.30.x kit works with 0.45.2 orm for basic schema; not verified]

**Build verification:** `npm run build --workspace=backend` (= `wrangler deploy --dry-run`) verifies TypeScript compilation succeeds after the bump.

### dompurify 3.4.1 → 3.4.12 (frontend)

- Patch-level bump within 3.4.x: no breaking changes [VERIFIED: `npm view dompurify version` → `3.4.12`]
- Frontend audit shows MODERATE severity (9 advisories), NOT HIGH [VERIFIED: `npm audit --workspace=frontend`]
- Change is in `frontend/package.json` dependencies

### hono HIGH Vulns — NOT in DEP-01 Scope, Blocks Success Criterion

[VERIFIED: `npm audit --workspace=backend --omit=dev`]

Current: `"hono": "^4.6.17"`. Audit shows 17 HIGH advisories for hono ≤4.12.26. Latest hono is `4.12.32` [VERIFIED: `npm view hono version`].

**ROADMAP success criterion #5:** "npm audit --workspace=backend --omit=dev shows 0 HIGH or CRITICAL vulnerabilities"

**After drizzle-only bump:** 1 HIGH package remains (hono). Success criterion #5 FAILS.

**Fix:** Bump `"hono": "^4.12.32"` in `backend/package.json`. This is within the existing semver range (`^4.6.17` allows any 4.x.x ≥ 4.6.17), so `npm audit fix` (no `--force`) handles it. The hono advisories are for Lambda/ALB adapters, AWS integrations, JSX SSR, and cookie helpers — none of which this Cloudflare Workers backend uses. The APIs this project uses (routing, middleware, validators) are unaffected. [ASSUMED: hono Cloudflare Workers adapter is unaffected by the listed advisories; planner should verify API surface against advisory list]

**Planner decision:** Include hono bump in DEP-01 scope to satisfy success criterion #5, or explicitly accept that the criterion is not met and file a follow-up.

---

## New CI Job: `test-backend`

### Pattern (follow existing `test-frontend`)

```yaml
test-backend:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
    - run: npm ci --workspace=backend
    - run: npm run test --workspace=backend
```

[CITED: existing ci.yml — typecheck-frontend and test-frontend patterns]

The backend `package.json` has `"test": "vitest run"` [VERIFIED: file read]. Tests are currently vacuous assertions (acknowledged in CONTEXT D-03; Phase 24 ARCH-06 improves them).

---

## Recommended Addition: `build-backend` CI Job

The ROADMAP success criterion explicitly mentions "gate on typecheck/**build**/unit-test CI jobs" (emphasis on build). A `build-backend` job running `npm run build --workspace=backend` in CI:
- Catches `compatibility_date` regressions before they reach the deploy workflow
- Verifies the Worker bundles correctly on every push (not just on deploy)
- Requires no CF credentials (esbuild only, no actual deploy)
- A failing build blocks workflow conclusion → blocks deploys

```yaml
build-backend:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
    - run: npm ci --workspace=backend
    - run: npm run build --workspace=backend
```

This is within "Claude's Discretion" per CONTEXT.md.

---

## Common Pitfalls

### Pitfall 1: Deploying Wrong SHA (Critical Safety Issue)
**What goes wrong:** `workflow_run` + `actions/checkout@v4` with no `ref:` checks out the default branch HEAD at the time the deploy job runs — not the commit CI validated.
**Why it happens:** `workflow_run` trigger context provides `github.event.workflow_run.head_sha` but does not automatically set the checkout ref.
**How to avoid:** Always add `ref: ${{ github.event.workflow_run.head_sha }}` to the checkout step in `workflow_run`-triggered jobs.
**Warning signs:** Rapid consecutive pushes to main; the second commit deploys before CI even runs on the first.

### Pitfall 2: `paths:` Filter Silently Lost
**What goes wrong:** Removing `on: push: paths:` and replacing with `on: workflow_run:` drops all path filtering. Developers expect "docs change = no deploy" but every push now deploys.
**Why it happens:** `workflow_run` does not support `paths:` as a filter key.
**How to avoid:** Explicitly document the behavior change. Optionally add `dorny/paths-filter` as a gate step in the deploy jobs.
**Warning signs:** Noticing deploy notifications for commits that didn't touch frontend/ or backend/.

### Pitfall 3: `workflow_run` Only Fires From Default Branch Workflow File
**What goes wrong:** If you test changes to the deploy workflow on a feature branch, `workflow_run` events are NOT triggered — the dispatch only happens for the default branch's workflow file version.
**Why it happens:** GitHub Actions design: workflow_run reads the event config from the default branch.
**How to avoid:** Merge deploy workflow changes to main before testing. There's no workaround.
**Warning signs:** Deploy job never appears in Actions tab after pushing workflow file changes on a branch.

### Pitfall 4: drizzle-kit / drizzle-orm Version Mismatch
**What goes wrong:** `db:generate` or `db:migrate` may produce incorrect output or schema drift warnings when drizzle-kit 0.30.x is paired with drizzle-orm 0.45.2.
**Why it happens:** drizzle-kit reads the schema definition via drizzle-orm internals; minor version mismatches in type representations can cause misalignment.
**How to avoid:** Bump drizzle-kit to `^0.31.10` alongside drizzle-orm, or run `npm run db:generate` after the bump and verify the generated migration file is empty (no schema drift detected).
**Warning signs:** `drizzle-kit generate` produces an unexpected migration file.

### Pitfall 5: KC Healthcheck Using wget or Port 8080
**What goes wrong:** The healthcheck command `wget ... http://localhost:8080/health/ready` fails silently: container stays `unhealthy` because `wget` is not installed and the health endpoint is on port 9000.
**Why it happens:** D-07 was based on an incorrect assumption about tool availability and port assignment.
**How to avoid:** Use `/proc/net/tcp` port check or bash `/dev/tcp` on port 9000. See INFRA-05 section.
**Warning signs:** `docker compose ps` shows KC as `unhealthy`; KC itself starts fine but healthcheck keeps failing.

### Pitfall 6: `npm audit` Shows 2 HIGH After Phase Completion
**What goes wrong:** After bumping only drizzle-orm, `npm audit --workspace=backend --omit=dev` reports 1 HIGH package remaining (hono ≤4.12.26).
**Why it happens:** DEP-01 scope as defined in CONTEXT covers drizzle-orm and dompurify but not hono.
**How to avoid:** Include `"hono": "^4.12.32"` bump in DEP-01.
**Warning signs:** Success criterion #5 fails verification even though drizzle was bumped.

---

## Code Examples

### workflow_run Trigger (Verified Pattern)

```yaml
# Source: docs.github.com/actions/using-workflows/events-that-trigger-workflows#workflow_run
on:
  workflow_run:
    workflows: [CI]       # must match ci.yml `name:` exactly
    branches: [main]
    types: [completed]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}  # deploy the validated SHA
      # ... rest of deploy steps
```

### continue-on-error at Job Level

```yaml
# Source: ci.yml pattern; behavior verified via GitHub community discussion
e2e:
  runs-on: ubuntu-latest
  continue-on-error: true   # job failure → conclusion stays 'success'
  needs: [typecheck-frontend]
  steps:
    # ... existing e2e steps unchanged
```

### KC Healthcheck (Recommended Fix — Option A)

```yaml
# Option A: TCP port check (safest — no tool requirements beyond cat+grep)
healthcheck:
  test: ["CMD-SHELL", "cat /proc/net/tcp6 | grep -q '00000000000000000000000000002328' || cat /proc/net/tcp | grep -q '00000000:2328'"]
  interval: 10s
  timeout: 5s
  retries: 15
  start_period: 30s
```

```yaml
# Option B: HTTP health check via bash /dev/tcp (checks actual /health/ready response)
# Requires KC_HEALTH_ENABLED: "true" in environment
healthcheck:
  test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/localhost/9000 && printf 'GET /health/ready HTTP/1.0\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && head -1 <&3 | grep -q '200'"]
  interval: 10s
  timeout: 5s
  retries: 15
  start_period: 30s
```

### drizzle-orm Bump

```bash
# In backend/package.json: change "drizzle-orm": "^0.38.3" to "^0.45.2"
# Optionally also: "drizzle-kit": "^0.30.1" to "^0.31.10"
npm install --workspace=backend  # resolves new versions
npm run build --workspace=backend  # verify dry-run still exits 0
npm run typecheck --workspace=backend
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `npx wrangler deploy` (pulls latest) | `npm run deploy` (uses pinned devDep) | Phase 21 | Deterministic deploys |
| `compatibility_date = "2024-01-01"` + nodejs_compat | `compatibility_date = "2024-09-23"` + nodejs_compat (auto-enables v2) | Phase 21 | Workers can import Node.js builtins |
| Deploy on every push to main (CI and deploy in same workflow) | Deploy only after CI gate passes (workflow_run) | Phase 21 | Broken typechecks block deploys |
| KC healthcheck via curl (not available) | KC healthcheck via /proc/net/tcp | Phase 21 | Container reports healthy correctly |
| drizzle-orm 0.38.x (SQL injection in sql.identifier) | drizzle-orm 0.45.2 (patched) | Phase 21 | GHSA-gpj5-g38j-94v9 closed |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `^3.101.0` caret range satisfies INFRA-04 "pinned devDep" intent | INFRA-04 | Success criterion #3 fails; planner may need to use exact version |
| A2 | `/bin/sh` in KC 26.6.1 container resolves to bash (enabling `/dev/tcp`) | INFRA-05 Option B | Option B healthcheck silently fails; fall back to Option A |
| A3 | drizzle-kit 0.30.1 works with drizzle-orm 0.45.2 for `db:generate`/`db:migrate` | DEP-01 | Migrations produce unexpected output; bump drizzle-kit to 0.31.10 preemptively |
| A4 | hono APIs used by this project (CF Workers routing/middleware) are unaffected by hono <=4.12.26 advisories | DEP-01 hono | Existing routes/middleware break after hono bump to 4.12.32; test routes after bump |
| A5 | KC `/health/ready` requires `KC_HEALTH_ENABLED=true` even in start-dev mode | INFRA-05 | Option B healthcheck returns 404; add env var if missing |

---

## Open Questions

1. **KC healthcheck Option A vs B**
   - What we know: Both approaches work in the KC container; Option B checks actual readiness; Option A only checks port is bound
   - What's unclear: Whether `/bin/sh` is bash in ubi9-micro (required for Option B)
   - Recommendation: Use Option A (port 9000 via /proc/net/tcp) unless the container can be tested empirically. Add `KC_HEALTH_ENABLED: "true"` regardless in case a future version switches to Option B.

2. **hono bump scope**
   - What we know: 17 HIGH hono advisories; fix is non-breaking; success criterion #5 requires 0 HIGH
   - What's unclear: Whether the CONTEXT D-08 scope intentionally excluded hono
   - Recommendation: Include hono bump (`^4.12.32`) in DEP-01 to satisfy success criterion #5

3. **`paths:` filter replacement**
   - What we know: `workflow_run` does not support path filters; current workflows are path-filtered
   - What's unclear: Whether this redeploy-on-every-push is acceptable
   - Recommendation: Accept the behavior for a personal project; note in commit message that path filtering is intentionally removed

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | INFRA-05 verification (`docker ps`) | Unknown (was down at research time) | — | — |
| Node.js 22 | CI jobs, local dev | ✓ (CI uses `node-version: '22'`) | 22.x | — |
| npm workspaces | All npm commands | ✓ (package.json uses workspaces) | npm 10.x | — |
| wrangler (local) | INFRA-03 verification | ✓ 3.114.17 | 3.114.17 | — |
| GitHub Actions runner | CI gate | ✓ (ubuntu-latest) | — | — |

**Missing dependencies with no fallback:**
- Docker: success criterion #4 requires `docker ps` showing `healthy`. KC container must be running to verify the healthcheck. Planner must restart the stack before verification.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 (backend + frontend) |
| Config file | `backend/vitest.config.*` (or package.json vitest key) |
| Quick run command | `npm run test --workspace=backend` |
| Full suite command | `npm run test:run --workspace=frontend && npm run test --workspace=backend` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Workflow gate blocks deploy on CI failure | manual | Trigger a failing CI push, verify no deploy | N/A — workflow behavior |
| INFRA-02 | test-backend job runs and is green | manual | Inspect Actions run after merge | N/A — CI job |
| INFRA-03 | `wrangler deploy --dry-run` exits 0 | smoke | `npm run build --workspace=backend` | ✅ (script exists) |
| INFRA-04 | No `npx wrangler` in workflow or scripts | static | `grep -r 'npx wrangler' .github/` | N/A — grep check |
| INFRA-05 | KC container shows `healthy` | manual | `docker ps` | N/A — runtime |
| DEP-01 | 0 HIGH/CRITICAL in backend prod deps | smoke | `npm audit --workspace=backend --omit=dev` | ✅ (npm built-in) |

### Wave 0 Gaps

None — no new test files are required. Verification is configuration-level (workflow YAML, wrangler.toml) and tool-level (npm audit, wrangler dry-run, docker ps).

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | — |
| V6 Cryptography | no | — |
| Supply chain (V14) | yes | Pinned wrangler, npm audit, dependency bumps |

### workflow_run Security Consideration

`workflow_run` grants the triggered workflow the secrets of the TARGET repo (not the source PR). In this project, deploys only trigger when `branches: [main]` CI completes — there are no fork PR scenarios. The `CLOUDFLARE_API_TOKEN` and GitHub Pages tokens are only exposed to workflows triggered by main-branch CI conclusions. [CITED: docs.github.com — "Running untrusted code on the workflow_run trigger may lead to security vulnerabilities"; mitigation: branches filter to main]

---

## Sources

### Primary (HIGH confidence)
- `backend/` codebase — `wrangler.toml`, `package.json`, `src/db/queries/*.ts`, all read directly
- `.github/workflows/ci.yml`, `deploy-frontend.yml`, `deploy-backend.yml` — all read directly
- Local build run: `npm run build --workspace=backend` → 25 errors, confirmed message
- `npm view drizzle-orm version` → `0.45.2`; `npm view dompurify version` → `3.4.12`; `npm view hono version` → `4.12.32`
- `npm audit --workspace=backend --omit=dev` → 2 HIGH packages (drizzle-orm, hono)
- `npm audit --workspace=frontend --omit=dev` → 1 MODERATE package (dompurify)

### Secondary (MEDIUM confidence)
- [GitHub Actions workflow_run docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_run) — trigger syntax, branches filter, conclusion check, paths: limitation
- [Cloudflare Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) — nodejs_compat_v2 activation at 2024-09-23
- [Keycloak observability/health](https://www.keycloak.org/observability/health) — health endpoints on port 9000, KC_HEALTH_ENABLED
- [Keycloak server/containers](https://www.keycloak.org/server/containers) — wget/curl not available in KC image
- GitHub community discussion #41655 — health endpoint on port 9000 confirmed from server logs
- GitHub community discussion #45546 — `continue-on-error: true` at job level → workflow conclusion = success

### Tertiary (LOW confidence)
- drizzle-orm release notes 0.39.0–0.45.0: individual releases checked; breaking change assessment based on limited fetches

---

## Metadata

**Confidence breakdown:**
- INFRA-03 fix: HIGH — verified by actual build failure output
- INFRA-04 state: HIGH — verified by file read
- workflow_run syntax: HIGH — official docs fetched
- continue-on-error behavior: MEDIUM — community discussion, not primary doc
- INFRA-05 KC healthcheck: HIGH (conflict) — official KC docs override CONTEXT D-07
- drizzle-orm API safety: HIGH — grep confirms no breaking API patterns used
- hono audit impact: HIGH — live npm audit confirms HIGH vulns remain

**Research date:** 2026-07-25
**Valid until:** 2026-08-25 (30 days — tools and versions stable)
