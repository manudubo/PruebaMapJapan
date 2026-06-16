# Phase 11: Error Handling - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a unified error handling layer for the TravelMap frontend and backend:
- New `frontend/src/modules/toast.ts` — centralized notification module with `showToast(message, type)`
- `ApiError` typed class in `frontend/src/api/client.ts` with `status` and `code` fields
- Global `unhandledrejection` handler in all 4 frontend entry points: `dashboard.ts`, `tripDetail.ts`, `trip-edit.ts`, `profile.ts`
- 401 auto-detection and redirect in `client.ts request()`
- Backend `app.onError()` updated to return consistent error codes

**Out of scope for this phase:**
- Error i18n / translating backend codes to user-readable messages (generic messages only)
- Toast animations beyond basic slide-in/fade-out
- AuthGuard error display (keeps its own inline Shadow DOM error UI)
- profile.ts `showStatus()` — kept as-is (only used for passkey/OTP success feedback)

</domain>

<decisions>
## Implementation Decisions

### Toast Module — ERR-02

- **D-01:** Toast position: top-right corner of the viewport, fixed, above other content (high `z-index`)
- **D-02:** Auto-dismiss: 4 seconds. All toast types (error, success, info) auto-dismiss after 4s
- **D-03:** Stacking: multiple toasts stack vertically with newest on top. Each toast is independent — no replacement or queuing
- **D-04:** Close button: every toast has an explicit close (×) button, not just auto-dismiss
- **D-05:** The toast container is injected into `document.body` lazily on first `showToast()` call. No pre-existing HTML required
- **D-06:** Toast types: `'error'` (uses `--jp-danger`), `'success'` (uses `--jp-success`), `'info'` (uses `--jp-accent`). All use CSS tokens from Phase 10

### Error Message Content — ERR-01, ERR-03, ERR-04

- **D-07:** API error messages: always generic — "Something went wrong. Please try again." regardless of status code or backend error string. No backend code translation needed.
- **D-08:** Success toasts: enabled — `showToast('Trip created', 'success')` after successful mutations (createTrip, deleteTrip, etc.). Callers decide the message text
- **D-09:** Unhandled rejection handler: always shows "An unexpected error occurred" — never exposes the rejection reason or stack trace

### 401 Auto-Redirect — ERR-05

- **D-10:** When `client.ts request()` receives a 401 response, it: (1) calls `showToast('Session expired — redirecting to login', 'info')`, (2) waits 1500ms, then (3) calls `login('dashboard.html')` to redirect to Keycloak with dashboard as the post-login redirect
- **D-11:** 401 detection is centralized in `client.ts request()` — not in individual page catch blocks
- **D-12:** After successful login following a 401, the user always lands on dashboard (not the page where the 401 occurred)

### Retrofit Scope

- **D-13:** `dashboard.ts` inline error elements (`#create-trip-error` div, `.trips-error` paragraph) are removed and replaced with `showToast()` calls
- **D-14:** `trip-edit.ts` catch block: instead of silent redirect, shows `showToast('Could not load trip — returning to dashboard', 'error')` then redirects after 1500ms
- **D-15:** `profile.ts` `showStatus()` is kept as-is — passkey/OTP success/error feedback stays inline contextually (not replaced by toast)
- **D-16:** `tripDetail.ts` — any existing error handling that currently shows nothing should use toast for errors; success cases that currently show nothing can remain silent

### Claude's Discretion

- Exact `ApiError` class structure (fields beyond `status` and `code`, how it extends Error)
- Backend error code names returned from `app.onError()` and route error handlers (e.g., `'trip_not_found'`, `'forbidden'`, `'validation_error'`)
- Toast CSS details: min-width, padding, border, font-size, gap between stacked toasts, slide-in/fade-out animation implementation
- Whether to export a single `showToast` function or a full object `toast.error()`, `toast.success()`
- How `dashboard.ts` displays loading state while trips are fetching (currently shows "Loading trips..." text — this is not an error state, no toast needed)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Error Handling — ERR-01 through ERR-05 (exact acceptance criteria)
- `.planning/ROADMAP.md` §Phase 11 — success criteria and scope

### Key frontend files
- `frontend/src/api/client.ts` — current request() implementation; ApiError and 401 detection go here
- `frontend/src/pages/dashboard.ts` — D-13: remove inline error divs, use toast
- `frontend/src/pages/trip-edit.ts` — D-14: replace silent redirect with toast-then-redirect
- `frontend/src/pages/tripDetail.ts` — add unhandledrejection handler; retrofit any silent catches
- `frontend/src/pages/profile.ts` — add unhandledrejection handler; showStatus() stays

### Key backend files
- `backend/src/index.ts` — app.onError() to be updated with typed error codes

### CSS tokens from Phase 10
- `frontend/src/styles/main.css` — `--jp-danger`, `--jp-success`, `--jp-accent`, `--jp-surface-raised`, `--jp-text`, `--jp-font`, `--jp-border`, `--jp-shadow-md` available for toast styling

### Auth pattern
- `frontend/src/auth/keycloak.ts` — `login()` function signature for the 401 redirect

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `profile.ts:showStatus(id, message, type)` — closest existing analog to toast: 5s auto-dismiss, `status-msg--error/success` CSS classes. Toast module can follow similar pattern but detached from DOM element IDs
- `frontend/src/auth/keycloak.ts:login(redirectUri)` — used in 401 redirect; already accepts a redirect URI
- `frontend/src/modules/dom.ts:setText()` — safe text setter, use in toast module if needed

### Established Patterns
- Naming: new module at `frontend/src/modules/toast.ts` following camelCase module convention
- Export style: named export `export function showToast(message: string, type: ToastType): void`
- CSS custom properties: all styles via `--jp-*` tokens, no hardcoded hex values in the new toast module
- `border-radius: 0` — matches Phase 10 minimalist aesthetic; toast should use 0 border-radius
- Error handling: catch blocks use bare `catch` when error is not used, `catch (err)` when forwarded

### Integration Points
- Toast container: append to `document.body` on first call; subsequent calls append toast cards to the container
- `unhandledrejection` handler: `window.addEventListener('unhandledrejection', ...)` in each of the 4 entry points' `init()` functions
- 401 in `client.ts`: check `response.status === 401` before the existing `if (!response.ok)` throw — handle separately

</code_context>

<specifics>
## Specific Ideas

- Toast card structure (for planner reference):
  ```
  <div class="toast toast--{type}"> 
    <span class="toast-msg">{message}</span>
    <button class="toast-close" aria-label="Dismiss">×</button>
  </div>
  ```
  Container: `<div id="toast-container">` fixed top-right, stacked vertically with gap
- 401 toast message: `'Session expired — redirecting to login'` (type: `'info'`)
- trip-edit redirect toast message: `'Could not load trip — returning to dashboard'` (type: `'error'`)

</specifics>

<deferred>
## Deferred Ideas

- Error code → human-readable message mapping (e.g., 'trip_not_found' → 'Trip not found') — user chose generic messages for now; translation map could be added in a future phase
- AuthGuard error UI via toast — AuthGuard uses Shadow DOM so injecting into body toast container is tricky; kept as inline Shadow DOM error for now
- profile.ts showStatus() unification with toast — kept separate by user decision; could be merged in a cleanup phase

</deferred>

---

*Phase: 11-error-handling*
*Context gathered: 2026-05-31*
