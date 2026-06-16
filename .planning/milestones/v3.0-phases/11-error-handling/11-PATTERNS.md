# Phase 11: Error Handling - Pattern Map

**Mapped:** 2026-05-31
**Files analyzed:** 10 (2 new, 8 modified)
**Analogs found:** 9 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `frontend/src/modules/toast.ts` | module/utility | event-driven | `frontend/src/modules/dom.ts` | role-match |
| `frontend/src/api/client.ts` | service | request-response | self (modify in place) | exact |
| `frontend/src/styles/main.css` | config/styles | — | `.status-msg--*` block (lines 521-531) | exact |
| `frontend/src/pages/dashboard.ts` | page/entry-point | CRUD | self (modify in place) | exact |
| `frontend/src/pages/trip-edit.ts` | page/entry-point | CRUD | self (modify in place) | exact |
| `frontend/src/pages/tripDetail.ts` | page/entry-point | request-response | self (modify in place) | exact |
| `frontend/src/pages/profile.ts` | page/entry-point | request-response | self (modify in place) | exact |
| `backend/src/index.ts` | config/middleware | request-response | self (modify in place) | exact |
| `frontend/tests/toast.test.ts` | test | — | `frontend/tests/utils.test.ts` | role-match |
| `frontend/tests/client.test.ts` | test | — | `frontend/tests/utils.test.ts` | role-match |

---

## Pattern Assignments

### `frontend/src/modules/toast.ts` (module/utility, event-driven)

**Analog:** `frontend/src/modules/dom.ts`

**Imports pattern** (dom.ts lines 1-7 — no imports; theme.ts lines 1-2 for when imports are needed):
```typescript
// dom.ts: zero imports — pure DOM utilities, no side deps
export function setText(el: Element, text: string): void { ... }
export function setStyle(el: HTMLElement, prop: string, value: string): void { ... }

// theme.ts: imports from @/types when type aliases are needed
import type { Theme, ThemeConfig } from '@/types';
```

**Core module pattern** — named exports only, no default export (dom.ts, theme.ts):
```typescript
// theme.ts lines 16-30: public function + private helpers pattern
export function getTheme(): Theme { ... }
export function initTheme(): void {
  // calls private helpers
  applyTheme(theme);
  setupSystemThemeListener();
}
function applyTheme(theme: Theme): void { ... }   // private, no export
function setupSystemThemeListener(): void { ... } // private, no export
```

**Pattern to copy for toast.ts:**
```typescript
// Named type export
export type ToastType = 'error' | 'success' | 'info';

// Two public exports: showToast + installGlobalErrorHandler
export function showToast(message: string, type: ToastType): void {
  const container = getOrCreateContainer();
  const card = buildCard(message, type);
  container.prepend(card);   // newest on top (D-03)
  scheduleAutoDismiss(card);
}

export function installGlobalErrorHandler(): void {
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();  // suppress default console output (ERR-01)
    showToast('An unexpected error occurred', 'error');
  });
}

// Private helpers follow (no export keyword)
function getOrCreateContainer(): HTMLElement { ... }
function buildCard(message: string, type: ToastType): HTMLElement { ... }
function scheduleAutoDismiss(card: HTMLElement): void { ... }
```

**DOM construction pattern** — use `.textContent` not `.innerHTML` for XSS safety (RESEARCH.md security section):
```typescript
// Profile.ts lines 35-36: textContent for user-visible strings
el.textContent = message;
el.className = `status-msg status-msg--${type}`;
```

**Auto-dismiss pattern** — copy from profile.ts `showStatus()` lines 37-38:
```typescript
// profile.ts lines 37-38
el.removeAttribute('hidden');
setTimeout(() => el.setAttribute('hidden', ''), 5000);
// Toast variant: remove element after delay + exit animation
```

---

### `frontend/src/api/client.ts` (service, request-response) — MODIFY

**Analog:** self (modify `request()` at lines 59-85)

**Current request() error block** (client.ts lines 70-73 — to be modified):
```typescript
if (!response.ok) {
  const text = await response.text().catch(() => response.statusText);
  throw new Error(`API error ${response.status}: ${text}`);
}
```

**New ApiError class** — add before the `request()` function, after the `RequestOptions` interface:
```typescript
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? `API error ${status}`);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}
```

**New 401 detection block** — insert BEFORE the existing `if (!response.ok)` block (line 70):
```typescript
if (response.status === 401) {
  showToast('Session expired — redirecting to login', 'info');
  setTimeout(() => { void login('dashboard.html'); }, 1500);
  return new Promise<never>(() => { /* intentionally never resolves */ });
}
```

**Updated !response.ok block** — replace lines 70-73:
```typescript
if (!response.ok) {
  const envelope = await response.json().catch(() => null) as { code?: string } | null;
  throw new ApiError(response.status, envelope?.code ?? 'unknown');
}
```

**New imports** — add to the existing import at client.ts line 8:
```typescript
import { getToken, isAuthenticated, login } from '@/auth/keycloak';
import { showToast } from '@/modules/toast';
```

**ApiEnvelope interface update** (client.ts lines 52-57) — add `code?`:
```typescript
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
}
```

---

### `frontend/src/styles/main.css` (styles) — MODIFY

**Analog:** `.status-msg--*` block (main.css lines 521-531)

**Existing pattern to mirror** (main.css lines 521-531):
```css
.status-msg--success {
  background: var(--jp-success-subtle);
  border-color: color-mix(in srgb, var(--jp-success) 35%, transparent);
  color: var(--jp-success);
}
.status-msg--error {
  background: var(--jp-danger-subtle);
  border-color: color-mix(in srgb, var(--jp-danger) 35%, transparent);
  color: var(--jp-danger);
}
```

**Pattern to add** — toast CSS using same token convention, `--jp-radius: 0` (no border-radius), `--jp-shadow-lg` for elevation (NOT `--jp-shadow-md` which resolves to `none`):
```css
/* ---- Toast notifications ---- */
#toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 3000;       /* above overlay(2000) and navbar(1000) */
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  min-width: 280px;
  max-width: 400px;
  background: var(--jp-surface-raised);
  border: 1px solid var(--jp-border-strong);
  border-radius: var(--jp-radius);
  box-shadow: var(--jp-shadow-lg);
  font-family: var(--jp-font);
  font-size: 14px;
  color: var(--jp-text);
  pointer-events: all;
}

.toast--error {
  background: var(--jp-danger-subtle);
  border-color: color-mix(in srgb, var(--jp-danger) 35%, transparent);
  color: var(--jp-danger);
}

.toast--success {
  background: var(--jp-success-subtle);
  border-color: color-mix(in srgb, var(--jp-success) 35%, transparent);
  color: var(--jp-success);
}

.toast--info {
  background: var(--jp-accent-subtle);
  border-color: color-mix(in srgb, var(--jp-accent) 35%, transparent);
  color: var(--jp-accent);
}

.toast-msg {
  flex: 1;
}

.toast-close {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  opacity: 0.7;
}

.toast-close:hover {
  opacity: 1;
}

.toast--exiting {
  opacity: 0;
  transition: opacity 200ms ease;
}
```

---

### `frontend/src/pages/dashboard.ts` (page/entry-point, CRUD) — MODIFY

**Analog:** self

**New import to add** (follow import block pattern at dashboard.ts lines 8-18):
```typescript
import { showToast, installGlobalErrorHandler } from '@/modules/toast';
```

**Replace handleCreateTrip catch** (dashboard.ts lines 160-163):
```typescript
// BEFORE (lines 160-163):
} catch (err) {
  const msg = document.getElementById('create-trip-error');
  if (msg) msg.textContent = (err as Error).message;
}

// AFTER (D-13):
} catch {
  showToast('Something went wrong. Please try again.', 'error');
}
```

**Replace getMyTrips() catch** (dashboard.ts lines 429-437):
```typescript
// BEFORE (lines 429-436):
} catch (err) {
  const grid = document.getElementById('trips-grid');
  if (grid) {
    grid.innerHTML = '';
    const errP = document.createElement('p');
    errP.className = 'trips-error';
    setText(errP, `Could not load trips: ${(err as Error).message}`);
    grid.appendChild(errP);
  }
}

// AFTER (D-13):
} catch {
  showToast('Something went wrong. Please try again.', 'error');
}
```

**Add to init()** (dashboard.ts line 368, inside `async function init()`):
```typescript
async function init(): Promise<void> {
  initTheme();
  installGlobalErrorHandler();   // add this line
  // ...rest of init
```

**HTML change:** Remove `<p class="error-msg" id="create-trip-error"></p>` from `dashboard.html` line 216.

---

### `frontend/src/pages/trip-edit.ts` (page/entry-point, CRUD) — MODIFY

**Analog:** self

**Current imports** (trip-edit.ts lines 1-8):
```typescript
import '@/styles/main.css';
import '@/components/Navbar';
import { initTheme } from '@/modules/theme';
import { initKeycloak, isAuthenticated } from '@/auth/keycloak';
import { getTrip } from '@/api/client';
import { initMetadataSection } from './trip-edit/metadata';
import { initDestinationsSection } from './trip-edit/destinations';
```

**New import to add:**
```typescript
import { showToast, installGlobalErrorHandler } from '@/modules/toast';
```

**Replace silent redirect catch** (trip-edit.ts lines 38-40):
```typescript
// BEFORE (lines 38-40):
} catch {
  window.location.href = 'dashboard.html';
}

// AFTER (D-14):
} catch {
  showToast('Could not load trip — returning to dashboard', 'error');
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
}
```

**Add to init()** (trip-edit.ts line 10, inside `async function init()`):
```typescript
async function init(): Promise<void> {
  initTheme();
  installGlobalErrorHandler();   // add this line
  // ...rest of init
```

---

### `frontend/src/pages/tripDetail.ts` (page/entry-point, request-response) — MODIFY

**Analog:** self

**Import block pattern** (tripDetail.ts lines 12-25 — follow this grouping):
```typescript
import '@/styles/main.css';
import '@/components/Navbar';
import '@/components/SearchBar';
import * as L from 'leaflet';
import { initTheme, getThemeConfig } from '@/modules/theme';
// ...other imports
import { setText, setStyle } from '@/modules/dom';
```

**New import to add** (alongside other `@/modules/*` imports):
```typescript
import { installGlobalErrorHandler } from '@/modules/toast';
```

**Add to init()** (tripDetail.ts line 486, inside `async function init()`):
```typescript
async function init(): Promise<void> {
  initTheme();
  installGlobalErrorHandler();   // add this line
  // ...rest of init
```

**Keep as-is:** `showError()` function at lines 462-480 (terminal error rendering) and all existing catch blocks — they all already show something.

---

### `frontend/src/pages/profile.ts` (page/entry-point, request-response) — MODIFY

**Analog:** self

**Existing import block** (profile.ts lines 1-12):
```typescript
import '@/styles/main.css';
import '@/components/Navbar';
import '@/components/SearchBar';
import { initTheme } from '@/modules/theme';
import { initKeycloak, getUserInfo, logout, keycloak } from '@/auth/keycloak';
import { getMe } from '@/api/client';
```

**New import to add:**
```typescript
import { installGlobalErrorHandler } from '@/modules/toast';
```

**Add to init()** (profile.ts line 249, inside `async function init()`):
```typescript
async function init(): Promise<void> {
  initTheme();
  installGlobalErrorHandler();   // add this line
  // ...rest of init
```

**Keep unchanged:** `showStatus()` at lines 28-39, all existing catches.

---

### `backend/src/index.ts` (config/middleware, request-response) — MODIFY

**Analog:** self

**Current onError handler** (index.ts lines 40-43):
```typescript
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});
```

**Updated onError** — add `code` field:
```typescript
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error', code: 'internal_error' }, 500);
});
```

**Scope boundary (critical):** `onError` only fires for thrown exceptions that bubble out of route handlers. The 20+ inline `c.json({success:false,...})` returns in route files are NOT thrown and bypass `onError`. Do not retrofit those.

**Also update** `backend/src/types/index.ts` — add `code?` to `ApiResponse<T>`:
```typescript
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;      // add this field
  message?: string;
}
```

---

### `frontend/tests/toast.test.ts` (test) — NEW

**Analog:** `frontend/tests/utils.test.ts`

**Test file structure** (utils.test.ts lines 1-2):
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ... } from '@/modules/utils';
```

**Pattern to copy for toast.test.ts:**
```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { showToast, installGlobalErrorHandler } from '@/modules/toast';

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';    // reset container between tests
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends .toast card to #toast-container', () => { ... });
  it('injects container lazily on first call', () => { ... });
  it('prepends newest toast to top', () => { ... });
  it('auto-dismisses after 4 seconds', () => {
    vi.advanceTimersByTime(4000);    // fake timer pattern from utils.test.ts line 36
    ...
  });
  it('close button removes the toast', () => { ... });
  it('applies correct class for each type', () => { ... });
});

describe('installGlobalErrorHandler', () => {
  it('shows error toast on unhandledrejection', () => {
    installGlobalErrorHandler();
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.reject(), reason: 'test' }));
    expect(document.querySelector('.toast--error')).not.toBeNull();
  });
});
```

**Vitest config context** (vitest.config.ts lines 5-10): `globals: true`, `environment: 'jsdom'`, `setupFiles: ['tests/setup.ts']`. `setup.ts` only mocks `matchMedia` — no additions needed.

---

### `frontend/tests/client.test.ts` (test) — NEW

**Analog:** `frontend/tests/utils.test.ts`

**Mock patterns** — follow vi.mock conventions (no existing example in codebase for fetch mocking; use standard vitest pattern):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
  isAuthenticated: vi.fn().mockReturnValue(true),
  login: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/toast', () => ({
  showToast: vi.fn(),
}));

import { ApiError } from '@/api/client';
import { showToast } from '@/modules/toast';
import { login } from '@/auth/keycloak';
```

**ApiError shape tests:**
```typescript
describe('ApiError', () => {
  it('has status, code, and name=ApiError', () => {
    const err = new ApiError(404, 'not_found');
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.name).toBe('ApiError');
    expect(err instanceof Error).toBe(true);
  });
});
```

**401 path test:**
```typescript
describe('request() 401 handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 })
    );
  });

  it('shows info toast and schedules login redirect', async () => {
    const { getMyTrips } = await import('@/api/client');
    // request() returns a never-resolving promise — race with a timeout
    const result = Promise.race([
      getMyTrips(),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 100)),
    ]);
    await vi.runAllTimersAsync();
    expect(showToast).toHaveBeenCalledWith(
      'Session expired — redirecting to login',
      'info'
    );
    expect(login).toHaveBeenCalledWith('dashboard.html');
    await expect(result).resolves.toBe('timeout');
  });
});
```

---

## Shared Patterns

### Module export convention
**Source:** `frontend/src/modules/dom.ts` lines 1-7, `frontend/src/modules/theme.ts` lines 16-44
**Apply to:** `toast.ts`
- Named exports only — no `export default`
- Public functions first, private helpers below (no `export` keyword on helpers)
- Types exported with `export type`

### CSS token convention
**Source:** `frontend/src/styles/main.css` lines 521-531 (`.status-msg--*`)
**Apply to:** toast CSS block in `main.css`
- All colors via `--jp-*` tokens — never hardcoded hex
- Subtle backgrounds: `var(--jp-{type}-subtle)`
- Borders: `color-mix(in srgb, var(--jp-{type}) 35%, transparent)`
- Text: `var(--jp-{type})`
- Shadow: `var(--jp-shadow-lg)` (NOT `--jp-shadow-md` which resolves to `none`)
- Border-radius: `var(--jp-radius)` which is `0`

### Page init() structure
**Source:** `frontend/src/pages/dashboard.ts` lines 367-377, `frontend/src/pages/trip-edit.ts` lines 10-19
**Apply to:** all 4 entry-point modifications
```typescript
async function init(): Promise<void> {
  initTheme();
  installGlobalErrorHandler();   // add as second call
  // ... page-specific init
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

### Silent catch pattern
**Source:** `frontend/src/pages/dashboard.ts` lines 417-421, `frontend/src/pages/profile.ts` lines 285-287
**Apply to:** all 4 entry-point modifications (do NOT add toast to these)
```typescript
try {
  user = await getMe();
} catch {
  // Non-critical — keep silent
}
```

### Bare catch vs named catch
**Source:** `frontend/src/pages/trip-edit.ts` line 19, `frontend/src/pages/dashboard.ts` line 373
**Apply to:** all Phase 11 catch blocks
```typescript
} catch { /* continue */ }         // when error value is not used
} catch (err) { ... }              // when err is forwarded or inspected
```

### Test fake timer pattern
**Source:** `frontend/tests/utils.test.ts` lines 33-35
**Apply to:** `toast.test.ts` (4s dismiss), `client.test.ts` (1500ms redirect)
```typescript
beforeEach(() => { vi.useFakeTimers(); });
vi.advanceTimersByTime(4000);
vi.runAllTimersAsync();
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All files have sufficient analog coverage |

---

## Critical Implementation Notes for Planner

1. **Em-dash in string literals:** Use Unicode `—` (—) not hyphen-minus (-) in toast messages "Session expired — redirecting to login" and "Could not load trip — returning to dashboard". Test assertions must match exactly.

2. **401 returns never-resolving promise:** `return new Promise<never>(() => {})` — never throw after 401. This prevents double-toast. `finally` blocks in callers will not run; acceptable since page navigates in 1.5s.

3. **401 check order:** Insert `response.status === 401` check BEFORE the existing `if (!response.ok)` block in `client.ts` line 70.

4. **Toast container z-index:** Must be 3000 (above modal overlay at 2000 and navbar at 1000).

5. **Background catches stay silent:** `getMe()` catches in dashboard.ts (line 419) and profile.ts (line 285), and `initKeycloak()` catches — do NOT add `showToast()` to these.

6. **dashboard.html change required:** Remove `<p class="error-msg" id="create-trip-error"></p>` at line 216 alongside the dashboard.ts changes.

7. **`backend/src/types/index.ts` requires a change** alongside `backend/src/index.ts` — add `code?: string` to `ApiResponse<T>`.

---

## Metadata

**Analog search scope:** `frontend/src/modules/`, `frontend/src/pages/`, `frontend/src/api/`, `frontend/tests/`, `frontend/src/styles/`, `backend/src/`
**Files read:** 15
**Pattern extraction date:** 2026-05-31
