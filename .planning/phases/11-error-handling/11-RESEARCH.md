# Phase 11: Error Handling - Research

**Researched:** 2026-05-31
**Domain:** Frontend error handling (toast module, unhandledrejection, ApiError, 401 redirect) + backend onError
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Toast position: top-right corner, fixed, high z-index
- D-02: Auto-dismiss: 4 seconds. All toast types auto-dismiss after 4s
- D-03: Stacking: newest on top, each toast independent
- D-04: Every toast has an explicit close (x) button
- D-05: Toast container injected lazily on first showToast() call
- D-06: Types: 'error' (--jp-danger), 'success' (--jp-success), 'info' (--jp-accent)
- D-07: API error messages always generic: "Something went wrong. Please try again."
- D-08: Success toasts enabled; callers decide message text
- D-09: Unhandled rejection handler always shows "An unexpected error occurred"
- D-10: 401 response: (1) showToast('Session expired — redirecting to login', 'info'), (2) wait 1500ms, (3) call login('dashboard.html')
- D-11: 401 detection centralized in client.ts request() only
- D-12: Post-401 login always lands on dashboard
- D-13: dashboard.ts inline error elements (#create-trip-error div, .trips-error p) removed; replaced with showToast()
- D-14: trip-edit.ts catch: showToast('Could not load trip — returning to dashboard', 'error') then redirect after 1500ms
- D-15: profile.ts showStatus() kept as-is
- D-16: tripDetail.ts: existing error handling that shows nothing should use toast; silent success stays silent

### Claude's Discretion
- Exact ApiError class structure (fields beyond status and code, how it extends Error)
- Backend error code names (e.g., 'trip_not_found', 'forbidden', 'validation_error')
- Toast CSS details: min-width, padding, border, font-size, gap, animation implementation
- Whether to export showToast function or toast object with methods
- How dashboard.ts displays loading state (currently "Loading trips..." text — not an error, no toast)

### Deferred Ideas (OUT OF SCOPE)
- Error code to human-readable message mapping
- AuthGuard error UI via toast (Shadow DOM complexity)
- profile.ts showStatus() unification with toast
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ERR-01 | User never sees raw browser error, stack trace, or native browser dialog | unhandledrejection handler + toast retrofit of existing silent catches covers this; note scope boundary below |
| ERR-02 | Centralized toast.ts module with showToast(message, type) | New module following dom.ts/theme.ts pattern; UI-SPEC approved contract |
| ERR-03 | Global unhandledrejection handler in all 4 entry points | window.addEventListener('unhandledrejection') in each init(); recommend DRY helper |
| ERR-04 | ApiError with status + code; backend onError responds with consistent codes | New class in client.ts; onError update in backend/src/index.ts |
| ERR-05 | 401 response triggers auto-redirect to Keycloak login | Centralized in client.ts request(); uses existing login() from keycloak.ts |
</phase_requirements>

---

## Summary

Phase 11 is a focused error-handling retrofit with one new file (`toast.ts`), modifications to four existing frontend entry points, one new class (`ApiError`) in `client.ts`, and a one-line addition to `backend/src/index.ts`. No new dependencies are required — everything uses existing project infrastructure.

The codebase currently has heterogeneous error handling: `dashboard.ts` populates inline DOM elements, `trip-edit.ts` silently redirects on load failure, `tripDetail.ts` has a custom `showError()` that renders an inline card, and `profile.ts` uses `showStatus()` for contextual inline feedback. The retrofit replaces the ad-hoc patterns with `showToast()` while preserving the deliberate silent catches (background enrichment fetches that are non-critical).

The most load-bearing implementation decision is the 401 path: after the toast + setTimeout redirect, `request()` must return a never-resolving promise rather than throwing, so callers do not layer a second "Something went wrong" toast on top of "Session expired."

**Primary recommendation:** Implement toast.ts first (the foundation), then ApiError + 401 in client.ts, then the four entry-point retrofits, then backend onError. Each step is independently releasable.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Toast notifications | Browser/Client | — | Pure DOM manipulation, no server involvement |
| ApiError class | Browser/Client | — | Frontend type; wraps fetch response |
| 401 auto-redirect | Browser/Client | — | Detected in client.ts, triggers keycloak.login() |
| unhandledrejection handler | Browser/Client | — | window event, all 4 entry points |
| Backend onError typed codes | API/Backend | — | Hono error handler in index.ts |

---

## Standard Stack

### Core (all already installed — no new packages needed)
[VERIFIED: codebase grep]

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.x (ES2022 target) | Language | `class ApiError extends Error` safe at ES2015+; ES2022 is confirmed |
| Vitest + jsdom | existing | Test framework | Already configured; toast.ts is DOM-manipulating, jsdom covers it |

No new npm installs required for this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
User action / unhandled promise rejection
         |
         v
  [Entry point catch / unhandledrejection handler]
         |
         v
     showToast(message, type)          <-- toast.ts (new)
         |
         v
  #toast-container (lazily injected into document.body)
         |-- prepend .toast card
         |-- 4s auto-dismiss timer
         |-- close button listener

  [API call path]
  request(path, opts)
         |
         |-- response.status === 401?
         |       |-- showToast('Session expired...', 'info')
         |       |-- setTimeout(login('dashboard.html'), 1500)
         |       `-- return new Promise<never>(() => {})   <-- caller chain halts
         |
         `-- !response.ok?
                 `-- throw new ApiError(status, code, message)
                             |
                             v
                   caller catch block
                             |
                             v
                     showToast('Something went wrong. Please try again.', 'error')
```

### Recommended Project Structure

New file only:
```
frontend/src/
  modules/
    toast.ts          <- new module (matches dom.ts / theme.ts pattern)
  api/
    client.ts         <- ApiError class + 401 detection added
  pages/
    dashboard.ts      <- D-13 retrofit
    trip-edit.ts      <- D-14 retrofit
    tripDetail.ts     <- D-16 retrofit
    profile.ts        <- unhandledrejection handler added only; showStatus() unchanged
```

### Pattern 1: showToast (named export, single function)

Follow the existing module convention established by `dom.ts` (two named function exports, no default export). The simplest pattern that satisfies D-03 and D-04:

```typescript
// Source: CONTEXT.md code_context, established conventions
export type ToastType = 'error' | 'success' | 'info';

export function showToast(message: string, type: ToastType): void {
  const container = getOrCreateContainer();
  const card = buildCard(message, type);
  container.prepend(card);          // newest on top (UI-SPEC)
  scheduleAutoDismiss(card);
}
```

- Container created lazily via `document.getElementById('toast-container') ?? createContainer()` (D-05)
- `container.prepend(card)` for newest-on-top without CSS column-reverse (UI-SPEC: simpler DOM order)

### Pattern 2: ApiError class

```typescript
// Source: CONTEXT.md decisions
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string
  ) {
    super(message ?? `API error ${status}`);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype); // belt-and-suspenders; not required at ES2022 but harmless
  }
}
```

`frontend/tsconfig.json` has `"target": "ES2022"` [VERIFIED: tsconfig.json line 3], so `class extends Error` works correctly without the `Object.setPrototypeOf` fix — but including it is harmless.

### Pattern 3: 401 detection in request()

The critical decision: after triggering the info toast + redirect, the function returns a `Promise<never>` that never resolves. This prevents the caller's catch block from executing and stacking a second toast.

```typescript
// Source: CONTEXT.md D-10, D-11
if (response.status === 401) {
  showToast('Session expired — redirecting to login', 'info');
  setTimeout(() => { void login('dashboard.html'); }, 1500);
  return new Promise<never>(() => { /* intentionally never resolves */ });
}
```

Side effect: `finally` blocks in callers (e.g., `handleCreateTrip` re-enabling the submit button at `dashboard.ts:165`) will not run — acceptable because the page navigates away in 1.5 seconds.

### Pattern 4: unhandledrejection handler (DRY)

Do not inline 4 copies in each init(). Export a single helper from `toast.ts`:

```typescript
// Source: CONTEXT.md D-09, established engineering practices
export function installGlobalErrorHandler(): void {
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault(); // suppress default console output
    showToast('An unexpected error occurred', 'error');
  });
}
```

Call `installGlobalErrorHandler()` once inside each of the 4 `init()` functions. `event.preventDefault()` is required — without it the browser still logs the unhandled rejection to the console, which violates ERR-01.

Note: `unhandledrejection` only covers async promise rejections. Synchronous thrown exceptions fire `window 'error'`, not `unhandledrejection`. The locked scope (D-09) specifies only `unhandledrejection` — do not add a `window 'error'` listener unless the user confirms it is in scope. This is flagged in the Assumptions Log.

### Pattern 5: Backend onError typed codes

The backend currently has:

```typescript
// backend/src/index.ts line 40-43 [VERIFIED: read]
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});
```

`ApiResponse<T>` in `backend/src/types/index.ts` is `{ success, data?, error?, message? }` — no `code` field yet [VERIFIED: read].

To add typed codes, extend `ApiResponse` and update `onError`:

```typescript
// backend/src/types/index.ts — add code field
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;      // typed error code for client consumption
  message?: string;
}

// backend/src/index.ts — onError with code
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error', code: 'internal_error' }, 500);
});
```

**Scope limitation (critical for planner):** `onError` only fires on *thrown* exceptions that bubble out of route handlers. The vast majority of business-logic errors in `trips.ts` and `auth.ts` are *returned* via `c.json({success:false, error:'...'})` — not thrown. These returned errors will never carry a `code` field via `onError`. This is acceptable because the frontend shows generic messages regardless of backend error content (D-07). Do not plan a retrofit of the 20+ inline `c.json` returns in `trips.ts` — that is out of scope.

Suggested `code` values for `onError` only: `'internal_error'`, `'not_found'` (for 404), `'validation_error'` (for zod-validator errors if they bubble).

### Anti-Patterns to Avoid

- **Throwing after 401:** If `request()` throws after the redirect is scheduled, the caller's catch will fire a second toast. Return `new Promise<never>(() => {})` instead.
- **Showing toasts for background enrichment fetches:** The existing silent catches for `getMe()` in `dashboard.ts:419-422` and `profile.ts:285-287` are intentionally silent ("Non-critical"). Do not add toast calls to these.
- **Duplicating the unhandledrejection handler:** Inline copies in 4 files violate DRY. Export one `installGlobalErrorHandler()` from `toast.ts`.
- **Hardcoded hex values:** All toast CSS must use `--jp-*` tokens. No `#` hex values anywhere in the new CSS.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast dismiss animation | Custom animation system | CSS `@keyframes toast-in` + `.toast--exiting` class (from UI-SPEC) | Already designed and approved |
| Token refresh on 401 | Custom retry logic | keycloak.js handles token refresh via `onTokenExpired` callback (already wired in keycloak.ts) | Token refresh happens transparently; 401 from backend = server-side rejection, not expired token |
| Backend error typing | HTTPException or custom exception system | Add `code` to ApiResponse and update onError only | Minimal change; route errors are returned not thrown |

---

## Current Error Handling State (by file)

### frontend/src/api/client.ts
[VERIFIED: read]

Current `request()` error handling:
- Line 70-73: `if (!response.ok)` — reads response body as text, throws `new Error('API error ${status}: ${text}')`
- No 401 detection
- No ApiError class

Changes needed:
1. Add `ApiError` class (new export)
2. Add 401 check *before* the `!response.ok` check — check `response.status === 401` first
3. Import `showToast` and `login` (login already imported in entry points; client.ts needs its own import)

**Import concern:** `client.ts` currently does not import from `toast.ts` or `keycloak.ts`'s `login`. It already imports `getToken` and `isAuthenticated` from `keycloak.ts`. Adding `login` to that import is safe. Adding a `showToast` import from `toast.ts` creates a cross-module dependency but is correct — `toast.ts` has no dependency on `client.ts`.

### frontend/src/pages/dashboard.ts
[VERIFIED: read]

Existing error patterns:
- `handleCreateTrip` catch (line 160-163): writes to `#create-trip-error` element — **D-13: replace with showToast()**
- `getMyTrips()` catch (line 429-436): creates `.trips-error` paragraph in grid — **D-13: replace with showToast()**
- `getMe()` catch (line 419-421): silent, "Non-critical" comment — **keep silent** (background enrichment)
- `initKeycloak()` catch (line 373-375): silent, "Keycloak may not be running" — **keep silent**
- `handleVerifyOtp` / `handleSendOtp` catches: use `#otp-error` element — **not in retrofit scope** (not a client.ts call)

`#create-trip-error` element exists in `dashboard.html` line 216 [VERIFIED: grep]. Removing toast + replacing with showToast requires:
1. `dashboard.ts`: remove `getElementById('create-trip-error')` reads and replace with `showToast()`
2. `dashboard.html`: remove `<p class="error-msg" id="create-trip-error"></p>` element

`.trips-error` is created dynamically in JS (dashboard.ts:431-436), not in HTML — TS-only change.

Success toast scope: `handleCreateTrip` redirects to `trip.html` immediately on success (line 159). A success toast there would never be visible. **No success toast in handleCreateTrip.** D-08 success toasts apply to in-place mutations in trip-edit, not to navigation-triggering creates.

### frontend/src/pages/trip-edit.ts
[VERIFIED: read]

Current error handling:
- Lines 38-40: `catch { window.location.href = 'dashboard.html'; }` — silent redirect on trip load failure
- **D-14:** Replace with `showToast('Could not load trip — returning to dashboard', 'error')` then `setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500)`

### Mutation Call-Site Inventory (trip-edit sub-modules)
[VERIFIED: all 5 sub-module files read — metadata.ts, destinations.ts, days.ts, hotels.ts, activities.ts]

All 5 sub-modules follow the same error pattern: inline `formError`/`confirmError` element shown on API failure, with the form element re-enabled in `finally`. This is contextual feedback inside modal dialogs. **None of these are D-13 or D-14 retrofit targets** — they are not page-level error elements.

The planner must decide which success cases get D-08 toasts. The table below lists every mutation call site:

| Mutation | File | Current error handling | Current success | D-08 toast candidate? |
|----------|------|----------------------|-----------------|----------------------|
| `createTrip` | dashboard.ts | #create-trip-error → **D-13: toast** | navigate to trip.html | No — page navigates immediately |
| `getMyTrips` (read) | dashboard.ts | .trips-error → **D-13: toast** | renders grid | n/a (read, not mutation) |
| `updateTrip` | trip-edit/metadata.ts | #metadata-error inline | setText(saveBtn, 'Saved') + 1.5s reset | Toast optional — button already gives feedback |
| `createDestination` | trip-edit/destinations.ts | formError inline | closeModal() + renderList() | Toast optional — modal closes as confirmation |
| `updateDestination` | trip-edit/destinations.ts | formError inline | closeModal() + renderList() | Toast optional |
| `deleteDestination` | trip-edit/destinations.ts | confirmError inline | close confirm + renderList() | No — destructive; confirm modal already confirms intent |
| `createDay` | trip-edit/days.ts | formError inline | closeModal() + re-render | Toast optional |
| `updateDay` | trip-edit/days.ts | formError inline | closeModal() + re-render | Toast optional |
| `deleteDay` | trip-edit/days.ts | confirmError inline | close + re-render | No — destructive |
| `generateDays` (bulk createDay) | trip-edit/days.ts | genError inline | re-render | Toast optional |
| `upsertHotel` | trip-edit/hotels.ts | formError inline | closeModal() + re-render | Toast optional |
| `deleteHotel` | trip-edit/hotels.ts | confirmError inline | close + re-render | No — destructive |
| `createActivity` | trip-edit/activities.ts | formError inline | closeModal() + re-render | Toast optional |
| `updateActivity` | trip-edit/activities.ts | formError inline | closeModal() + re-render | Toast optional |
| `deleteActivity` | trip-edit/activities.ts | confirmError inline | close + re-render | No — destructive |
| `reorderActivities` | trip-edit/activities.ts | appended error-msg p | optimistic revert | No — invisible action |

**D-08 scope recommendation (planner discretion):** The sub-module mutations already provide immediate visual feedback (modal closes, list re-renders, button state changes). D-08 says "callers decide the message text" — meaning success toasts are opt-in per caller, not mandated everywhere. The planner should decide which mutations warrant an explicit success toast vs relying on existing visual feedback. No inline sub-module error elements need to be replaced with toast.

### frontend/src/pages/tripDetail.ts
[VERIFIED: read]

D-16 net effect: add `installGlobalErrorHandler()` inside `init()`. No existing catch in this file "currently shows nothing" that represents an unhandled user-facing error — they are all either handled by `showError()` or are intentional silent fallbacks.

Detailed state:
- `showError(message)` at line 462-480: renders a custom inline card in `#main-content` with a "Back to dashboard" link — this is appropriate for terminal error states ("no access", "not found") where a toast would disappear before the user could act. **Keep showError() as-is.**
- Slug path catch (line 496-499): calls `showError()` with the raw error message — this currently exposes `(err as Error).message` to the user. However since `showError()` already shows *something*, it does not qualify as "currently shows nothing" per D-16. **Keep as-is.** (The message is already wrapped in an inline card, not a raw browser error.)
- Authenticated trip fetch catch (line 533-535): silent `// Fall through to public` — intentional fallback logic, not a user-visible error path. **Keep silent.**
- "You don't have access" check (line 538-540): calls `showError()` — policy message with navigation link. **Keep as-is.**

**Result:** tripDetail.ts changes are limited to adding `installGlobalErrorHandler()` to `init()`.

### frontend/src/pages/profile.ts
[VERIFIED: read]

Current error handling:
- `loadPasskeys()` catch (line 114-116): inline list message "Could not load passkey list" — out of scope (D-15 keeps showStatus as-is; this is similar inline feedback)
- `getMe()` catch (line 285-287): silent, "Non-critical" — **keep silent**
- `initKeycloak()` catch (line 253-255): silent — **keep silent**
- `showStatus()` (line 28-39): 5s auto-dismiss, CSS class-based — **keep as-is** per D-15

Change needed: add `installGlobalErrorHandler()` call inside `init()`.

---

## CSS Token Verification

[VERIFIED: main.css read, lines 1-103]

All tokens referenced in CONTEXT.md and UI-SPEC.md are confirmed present in `main.css`:

| Token | Light value | Dark value | Status |
|-------|------------|------------|--------|
| `--jp-danger` | `#ff3b30` | `#ff6961` | VERIFIED |
| `--jp-danger-subtle` | `rgba(255,59,48,0.08)` | `rgba(255,105,97,0.14)` | VERIFIED |
| `--jp-success` | `#34c759` | `#30d158` | VERIFIED |
| `--jp-success-subtle` | `rgba(52,199,89,0.1)` | `rgba(48,209,88,0.14)` | VERIFIED |
| `--jp-accent` | `#0071e3` | `#0a84ff` | VERIFIED |
| `--jp-accent-subtle` | `rgba(0,113,227,0.08)` | `rgba(10,132,255,0.15)` | VERIFIED |
| `--jp-text` | `#1d1d1f` | `#f5f5f7` | VERIFIED |
| `--jp-text-secondary` | `#515154` | `#a1a1a6` | VERIFIED |
| `--jp-font` | Inter, -apple-system... | same | VERIFIED |
| `--jp-radius` | `0` | — | VERIFIED |
| `--jp-shadow-lg` | `0 12px 40px rgba(0,0,0,0.12)` | `0 12px 40px rgba(0,0,0,0.5)` | VERIFIED |
| `--jp-shadow-md` | `none` | `none` | VERIFIED — but `none` in both themes |

**Shadow token discrepancy:** CONTEXT.md canonical_refs lists `--jp-shadow-md` as available for toast styling, but it resolves to `none` in both light and dark themes (lines 39, 97-98). The UI-SPEC (approved contract) already overrides this and specifies `--jp-shadow-lg` for toast elevation. The planner must use `--jp-shadow-lg` — the UI-SPEC supersedes the CONTEXT canonical_refs listing on this point.

The `.status-msg--*` pattern (lines 521-530 in main.css) — background: `--jp-*-subtle`, border: `color-mix(in srgb, var(--jp-*) 35%, transparent)`, color: `var(--jp-*)` — is confirmed as the existing pattern that toast types mirror. [VERIFIED: main.css grep]

---

## Runtime State Inventory

Not applicable. This phase is a feature addition + code retrofit with no stored data, live service config, OS-registered state, secrets, or build artifacts containing error-handling concepts. No runtime state inventory needed.

---

## Common Pitfalls

### Pitfall 1: Double-toast on 401
**What goes wrong:** `request()` shows "Session expired" toast, then throws ApiError, then caller's catch shows "Something went wrong" — user sees two toasts.
**Why it happens:** Treating 401 like any other `!response.ok` error.
**How to avoid:** `request()` must `return new Promise<never>(() => {})` after the 401 path. Never throw after the toast + redirect.
**Warning signs:** Two toasts appearing simultaneously when testing 401 scenarios.

### Pitfall 2: finally blocks don't run on never-resolving promise
**What goes wrong:** Submit button stays disabled on dashboard after a 401.
**Why it happens:** `return new Promise<never>(() => {})` in `request()` means the caller's `finally` block in `handleCreateTrip` (line 163-165) never executes.
**How to avoid:** This is acceptable behavior since the page navigates in 1.5s — document it and leave it. Do not try to "fix" it by throwing.
**Warning signs:** None; user never sees the stuck button before redirect.

### Pitfall 3: Retrofitting the wrong catches
**What goes wrong:** Adding showToast() to background/non-critical catches that are intentionally silent.
**Why it happens:** Mechanical application of "all catches get a toast."
**How to avoid:** Only user-action-triggered failures get toasts. Background enrichment catches (`getMe()` in dashboard and profile, `initKeycloak()` fallbacks) stay silent.
**Warning signs:** Toast appears unexpectedly on page load when Keycloak is unavailable in dev mode.

### Pitfall 4: em-dash vs hyphen in toast messages
**What goes wrong:** Tests fail because string comparison uses hyphen-minus (-) instead of em-dash (—).
**Why it happens:** The copywriting contract (UI-SPEC) specifies em-dash (—) in "Session expired — redirecting to login" and "Could not load trip — returning to dashboard."
**How to avoid:** Use the Unicode em-dash character (U+2014) in the string literals, not hyphen-minus (U+002D).
**Warning signs:** Test assertion on toast text fails despite visual similarity.

### Pitfall 5: Toast container z-index conflict
**What goes wrong:** Toast appears behind modal overlays.
**Why it happens:** Overlay z-index may exceed toast container z-index.
**How to avoid:** UI-SPEC specifies `z-index: 3000` for `#toast-container` (above `.overlay` at 2000 and `.navbar` at 1000).
**Warning signs:** Toast is invisible when a modal is open.

### Pitfall 6: Backend onError scope overestimate
**What goes wrong:** Plan includes retrofitting all 20+ inline `c.json({success:false,...})` returns in trips.ts with a `code` field.
**Why it happens:** Confusing "add code to ApiResponse type" with "add code to all responses."
**How to avoid:** `onError` only fires for *thrown* exceptions. Route handlers that return error responses bypass `onError`. Only update `onError` in `index.ts` and the `ApiResponse` type. Per D-07, the frontend shows generic messages regardless.

---

## Code Examples

Verified patterns from existing codebase:

### dom.ts export pattern (follow for toast.ts)
```typescript
// Source: frontend/src/modules/dom.ts [VERIFIED]
export function setText(el: Element, text: string): void { ... }
export function setStyle(el: HTMLElement, prop: string, value: string): void { ... }
// No default export. Named exports only.
```

### showStatus() — closest analog to showToast()
```typescript
// Source: frontend/src/pages/profile.ts lines 28-39 [VERIFIED]
function showStatus(id: string, message: string, type: 'success' | 'error'): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `status-msg status-msg--${type}`;
  el.removeAttribute('hidden');
  setTimeout(() => el.setAttribute('hidden', ''), 5000);
}
// Differences from toast.ts: tied to DOM id, no container injection, 5s not 4s, no close button
```

### login() signature
```typescript
// Source: frontend/src/auth/keycloak.ts line 71 [VERIFIED]
export async function login(redirectUri?: string): Promise<void>
// Usage for 401: login('dashboard.html') — pass relative URL
```

### request() current error throw (to be modified)
```typescript
// Source: frontend/src/api/client.ts lines 70-73 [VERIFIED]
if (!response.ok) {
  const text = await response.text().catch(() => response.statusText);
  throw new Error(`API error ${response.status}: ${text}`);
}
// Phase 11: add 401 check before this block; change throw to throw new ApiError(...)
```

### Existing unhandledrejection pattern (none — new pattern)
No existing handler in any entry point. New pattern to establish:
```typescript
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  showToast('An unexpected error occurred', 'error');
});
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `window.addEventListener('unhandledrejection', ...)` alone satisfies ERR-01 ("no stack trace or native browser dialog"). Synchronous uncaught exceptions fire `window 'error'`, not `unhandledrejection`, and are not in locked scope. | ERR-03 / Common Pitfalls | If user interprets ERR-01 to require `window 'error'` handler too, scope expands by one listener per entry point |
| A2 | All 5 trip-edit sub-module inline error elements (metadata.ts #metadata-error, destinations.ts #dest-form-error / #confirm-error, days.ts #day-form-error / genError, hotels.ts #hotel-form-error, activities.ts #act-form-error / reorder errEl) are contextual form errors inside modal dialogs, excluded from D-13 retrofit scope | Mutation Call-Site Inventory | If these should also use toast, scope expands to 5 additional files with ~10 catch sites |

---

## Open Questions (RESOLVED)

1. **window 'error' handler scope** — RESOLVED: D-09 locks scope to `unhandledrejection` only. ERR-01's "never see a raw browser error" is satisfied by the unhandledrejection handler for async rejections; synchronous throws are out of scope per the locked decisions. Plans implement `installGlobalErrorHandler()` with `unhandledrejection` only and do not add `window 'error'` listeners.

2. **Which trip-edit sub-module mutations get D-08 success toasts** — RESOLVED: `updateTrip` in `metadata.ts` (button feedback "Saved" is subtle; adding a success toast provides clearer confirmation). All other sub-module mutations rely on sufficient existing visual feedback (modal closes, list re-renders). Implemented in plan 11-04 Task 2.

---

## Environment Availability

Step 2.6: SKIPPED. Phase is code/config changes only. All execution happens in the existing Node 22 + Vite + Vitest environment. No external dependencies beyond what is already installed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom |
| Config file | `frontend/vitest.config.ts` |
| Setup file | `frontend/tests/setup.ts` (mocks `matchMedia`) |
| Quick run command | `npm run test:run` (from frontend/) |
| Full suite command | `npm run test:run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERR-02 | showToast() appends .toast card to #toast-container | unit | `npm run test:run -- --reporter=verbose` (toast.test.ts) | Wave 0 gap |
| ERR-02 | showToast() auto-dismisses after 4s (fake timers) | unit | same | Wave 0 gap |
| ERR-02 | Close button removes toast | unit | same | Wave 0 gap |
| ERR-02 | Multiple toasts stack; newest is first child | unit | same | Wave 0 gap |
| ERR-03 | installGlobalErrorHandler() fires showToast on unhandledrejection | unit | same | Wave 0 gap |
| ERR-04 | ApiError has status, code, name='ApiError' | unit | `npm run test:run` (client.test.ts) | Wave 0 gap |
| ERR-05 | request() shows info toast + schedules login on 401; returns never-resolving promise | unit | same | Wave 0 gap |
| ERR-01 | No raw errors visible in any entry point | smoke (manual) | Visual verification post-implementation | Manual |

### Sampling Rate
- **Per task commit:** `npm run test:run && npm run typecheck` (from frontend/)
- **Per wave merge:** `npm run test:run && npm run typecheck`
- **Phase gate:** Full suite green before /gsd-verify-work

### Wave 0 Gaps

- [ ] `frontend/tests/toast.test.ts` — covers ERR-02, ERR-03 (showToast behavior, container injection, stacking, dismiss, installGlobalErrorHandler)
- [ ] `frontend/tests/client.test.ts` — covers ERR-04 (ApiError shape), ERR-05 (401 path: mock fetch returning 401, assert showToast called + login scheduled + returned promise never resolves)

**Test infrastructure notes for Wave 0:**
- `toast.test.ts` needs `document.body` cleanup in `beforeEach` to reset container state between tests. `vi.useFakeTimers()` required for 4s dismiss and 200ms exit animation.
- `client.test.ts` needs `vi.mock('@/auth/keycloak', ...)` to mock `login()` and `vi.spyOn(global, 'fetch')` to mock responses. Mock `showToast` import to assert it's called.
- `frontend/tests/setup.ts` already mocks `matchMedia` — no additions needed for these tests.

---

## Security Domain

This phase has no new authentication mechanisms, cryptography, session management, or input validation beyond what already exists. The 401 redirect uses the existing `login()` function from `keycloak.ts` which enforces PKCE S256.

ASVS V5 (Input Validation): Toast messages are hardcoded strings (D-07, D-09) or caller-supplied strings that are set via `.textContent` (not `innerHTML`). No XSS vector introduced.

No additional ASVS categories apply.

---

## Sources

### Primary (HIGH confidence)
- `frontend/src/api/client.ts` — read directly; request() implementation confirmed
- `frontend/src/pages/dashboard.ts` — read directly; error elements and catches confirmed
- `frontend/src/pages/trip-edit.ts` — read directly; silent redirect confirmed
- `frontend/src/pages/trip-edit/metadata.ts` — read directly; #metadata-error inline error + updateTrip call confirmed
- `frontend/src/pages/trip-edit/destinations.ts` — read directly; formError / confirmError + create/update/deleteDestination calls confirmed
- `frontend/src/pages/trip-edit/days.ts` — read directly; formError / confirmError / genError + create/update/deleteDay + generateDays calls confirmed
- `frontend/src/pages/trip-edit/hotels.ts` — read directly; formError / confirmError + upsertHotel / deleteHotel calls confirmed
- `frontend/src/pages/trip-edit/activities.ts` — read directly; formError / confirmError / reorder errEl + create/update/deleteActivity / reorderActivities calls confirmed
- `frontend/src/pages/tripDetail.ts` — read directly; showError() and silent catches confirmed; no catch "shows nothing"
- `frontend/src/pages/profile.ts` — read directly; showStatus() pattern confirmed
- `frontend/src/auth/keycloak.ts` — read directly; login() signature confirmed
- `frontend/src/modules/dom.ts` — read directly; export pattern confirmed
- `frontend/src/styles/main.css` — read directly; all CSS tokens verified
- `frontend/src/types/index.ts` — read directly; no ApiError yet confirmed
- `backend/src/index.ts` — read directly; onError current state confirmed
- `backend/src/types/index.ts` — read directly; ApiResponse type confirmed (no code field)
- `frontend/tsconfig.json` — read directly; target ES2022 confirmed
- `frontend/vitest.config.ts` — read directly; test setup confirmed
- `frontend/dashboard.html` — grepped; #create-trip-error HTML element confirmed at line 216
- `.planning/phases/11-error-handling/11-CONTEXT.md` — all 16 decisions read
- `.planning/phases/11-error-handling/11-UI-SPEC.md` — approved UI contract read

### Tertiary (LOW confidence — not needed; all findings are VERIFIED from source)
None.

---

## Metadata

**Confidence breakdown:**
- Current code state: HIGH — all 20 source files read directly
- CSS token availability: HIGH — verified from main.css
- Implementation patterns: HIGH — derived from existing conventions in the codebase
- Test strategy: HIGH — existing vitest.config.ts read, gaps identified from requirements
- Backend onError scope: HIGH — trips.ts read, onError limitation documented from source

**Research date:** 2026-05-31
**Valid until:** 2026-07-01 (stable project; 30-day window)
