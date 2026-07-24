# Phase 19: Session + Closure — Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 4 (3 modified + 1 created)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/playwright.config.ts` | config | request-response | itself (chromium project, lines 22–27) | exact |
| `tests/e2e/trip-edit-integration.spec.ts` | test | CRUD | `tests/e2e/auth.spec.ts` line 197 (`test.skip` at describe scope) | role-match |
| `tests/e2e/new-user-trip-creation.spec.ts` | test | CRUD | `tests/e2e/session-management.spec.ts` line 39 (`base.skip` at file scope) | role-match |
| `.planning/milestones/v3.1-phases/19-session-closure/19-CLOSURE.md` | planning artifact | batch | RESEARCH.md template (D-06) | no codebase analog |

## Pattern Assignments

### `tests/playwright.config.ts` (config, D-03)

**Analog:** same file — chromium project entry (lines 21–28)

**Existing chromium pattern** (lines 21–28, verified):
```typescript
{
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
  testIgnore: ['**/passkeys.spec.ts'],
},
```

**Current firefox/webkit entries** (lines 29–38, missing the storageState spread):
```typescript
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

**After D-03 — replicate chromium spread into both** (exact pattern to copy):
```typescript
{
  name: 'firefox',
  use: {
    ...devices['Desktop Firefox'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
  testIgnore: ['**/passkeys.spec.ts'],
},
{
  name: 'webkit',
  use: {
    ...devices['Desktop Safari'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
  testIgnore: ['**/passkeys.spec.ts'],
},
```

**Safety note:** `tests/e2e/idp-theme.spec.ts` has `test.use({ storageState: { cookies: [], origins: [] } })` unconditionally at its describe scope (verified: line 25). This override activates on firefox/webkit after D-03 — no regression.

---

### `tests/e2e/trip-edit-integration.spec.ts` (test, D-02)

**Analog:** `tests/e2e/auth.spec.ts` line 197 — `test.skip(condition, reason)` at describe scope; same API shape, `test.fixme` for different semantic

**Current file-scope preamble** (lines 9–12, insertion point after these):
```typescript
test.describe.configure({ mode: 'serial' });

// Integration tests include a full Keycloak login round-trip — allow extra time
test.setTimeout(90000);
```

**Insert immediately after `test.setTimeout(90000)`** (D-02 pattern):
```typescript
test.fixme(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration');
```

Placement rule: must appear at file scope before any `test(...)` declarations. All 5 tests in the file share the same missing-backend-integration root cause — file-scope form is more maintainable than per-test. Verify with `npx playwright test trip-edit-integration.spec.ts --list` (all 5 should show as fixme).

---

### `tests/e2e/new-user-trip-creation.spec.ts` (test, D-04)

**Analog:** `tests/e2e/session-management.spec.ts` line 39 — `base.skip(!!process.env.SKIP_REAL_AUTH, ...)` at file scope; same file-scope conditional pattern, callback form for browser fixture injection

**Current file-scope preamble** (lines 5–9):
```typescript
test.describe.configure({ mode: 'serial' });

test.use({
  storageState: path.join(__dirname, '../.auth/new-user.json'),
});
```

**Insert after `test.use({ storageState: ... })` block** (D-04 pattern, Option A — file-scope callback):
```typescript
test.fixme(
  ({ browserName }) => browserName === 'webkit',
  'webkit handles KC redirect differently when building a fresh browser context from new-user.json — environment constraint',
);
```

Placement: file scope, before the `test.describe('New user trip creation flow', ...)` block at line 50. The callback form uses Playwright fixture injection — more reliable than `process.env` parsing for browser-conditional marking. The inner `test.skip(!!process.env.SKIP_REAL_AUTH, ...)` at line 51 (inside describe) is orthogonal and stays unchanged.

---

### `.planning/milestones/v3.1-phases/19-session-closure/19-CLOSURE.md` (planning artifact, D-06)

**Analog:** no codebase analog — use RESEARCH.md D-06 template

**Template structure** (from RESEARCH.md, verified against D-06 requirements):
```markdown
# Phase 19 Closure — v3.1 E2E Stabilization

**Date:** YYYY-MM-DD
**Suite run:** `npx playwright test --trace retain-on-failure --retries 1` (from tests/)
**Result:** X passed, Y skipped, 0 failed

## Per-Spec Status Table

| Spec | Project(s) | Status | Resolution |
|------|-----------|--------|------------|

## Accepted Deferrals

| Spec | Condition | Rationale |
|------|-----------|-----------|
| trip-edit-integration.spec.ts | unconditional | ... |
| new-user-trip-creation.spec.ts | webkit only | ... |
```

Must cover every entry from `15-TRIAGE.md` authoritative failure table (7 entries — see RESEARCH.md Phase 15 Triage → Phase 19 Closure Map). Written only after D-05 run completes — sequential dependency on actual run output.

---

## Shared Patterns

### Conditional file-scope test gate (test.skip / test.fixme)
**Source:** `tests/e2e/auth.spec.ts` line 197, `tests/e2e/session-management.spec.ts` line 39, `tests/e2e/otp.spec.ts` line 29
**Apply to:** D-02 (trip-edit-integration), D-04 (new-user webkit)
```typescript
// Existing pattern (test.skip, env-conditional):
test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');

// D-02 variant (test.fixme, unconditional — different semantic: known broken, will fix):
test.fixme(true, 'reason string required');

// D-04 variant (test.fixme, browser fixture callback):
test.fixme(({ browserName }) => browserName === 'webkit', 'reason string required');
```

### storageState conditional spread
**Source:** `tests/playwright.config.ts` line 25 (chromium project)
**Apply to:** firefox and webkit project entries in same file
```typescript
...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
```

### describe-level storageState override (safety reference)
**Source:** `tests/e2e/auth.spec.ts` lines 209–211
**Relevance:** After D-03, describe-level `test.use({ storageState })` overrides project-level config — this is why auth.spec.ts real-session tests may have already been passing on firefox/webkit via their own describe-level override. D-05 run is authoritative.
```typescript
test.use({
  storageState: path.join(__dirname, '../.auth/user.json'),
});
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/milestones/v3.1-phases/19-session-closure/19-CLOSURE.md` | planning artifact | batch | No closure/milestone-end document exists in this codebase; use RESEARCH.md D-06 template |

---

## Metadata

**Analog search scope:** `tests/` directory — `playwright.config.ts`, `e2e/*.spec.ts`, `e2e/fixtures/*.ts`
**Files scanned:** 7 (playwright.config.ts, trip-edit-integration.spec.ts, new-user-trip-creation.spec.ts, session-management.spec.ts, auth.spec.ts, kc-login-helper.ts, idp-theme.spec.ts via grep)
**Pattern extraction date:** 2026-07-13
