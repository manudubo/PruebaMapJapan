# Phase 15: Triage + Config — Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 2
**Analogs found:** 1 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/playwright.config.ts` | config | request-response | `tests/playwright.config.ts` line 39 (`chromium-passkeys` entry) | exact |
| `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md` | — | — | none | no-analog |

## Pattern Assignments

### `tests/playwright.config.ts` (config, project-level test filtering)

**Analog:** Same file — `chromium-passkeys` entry (lines 36-40)

**Existing pattern to mirror** (`tests/playwright.config.ts` lines 36-40):
```typescript
{
  name: 'chromium-passkeys',
  use: { ...devices['Desktop Chrome'] },
  testMatch: ['**/passkeys.spec.ts'],
},
```

`testMatch` uses a glob-array as a sibling key to `use`. `testIgnore` is the same type (`string | RegExp | Array<string | RegExp>`) and goes in the same position.

**Three targets requiring the edit** (`tests/playwright.config.ts` lines 21-40):
```typescript
// BEFORE
{
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
},
{
  name: 'firefox',
  use: { ...devices['Desktop Firefox'] },
},
{
  name: 'webkit',
  use: { ...devices['Desktop Safari'] },
},

// AFTER — add testIgnore as sibling to `use`, not nested inside it
{
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
  testIgnore: ['**/passkeys.spec.ts'],
},
{
  name: 'firefox',
  use: { ...devices['Desktop Firefox'] },
  testIgnore: ['**/passkeys.spec.ts'],
},
{
  name: 'webkit',
  use: { ...devices['Desktop Safari'] },
  testIgnore: ['**/passkeys.spec.ts'],
},
```

**Key constraint:** `testIgnore` must be a sibling of `use`, not nested inside it. The `chromium` entry has a two-key `use` block with a spread conditional — `testIgnore` comes after the closing `}` of that block.

**Smoke check after edit:**
```bash
cd tests
npx playwright test tests/e2e/passkeys.spec.ts --project=firefox --reporter=list
# Expected: "0 tests" (testIgnore excludes the file for this project)
```

---

## Shared Patterns

None. This phase modifies a single config file with a self-contained, non-cross-cutting change.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md` | — | — | Markdown output artifact; format fully specified in `15-RESEARCH.md` lines 181-206; not source code, taxonomy does not apply |

**Planner note for 15-TRIAGE.md:** Use the format from `15-RESEARCH.md` lines 181-206 verbatim. Columns: `| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |`. Status values: `Pass`, `Fail`, `Flaky`, `Skip(reason)`. Failure mode categories: `config-bug`, `contract-mismatch`, `missing-fixture`, `env`, `flaky`, `unknown`. This file is populated by the user after running the triage command — the planner must not pre-populate it.

---

## Metadata

**Analog search scope:** `tests/playwright.config.ts` (same file; no broader search needed)
**Files scanned:** 1
**Pattern extraction date:** 2026-06-21
