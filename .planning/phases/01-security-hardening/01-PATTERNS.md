# Phase 1: Security Hardening - Pattern Map

**Mapped:** 2026-04-26
**Files analyzed:** 8
**Analogs found:** 6 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `frontend/src/modules/dom.ts` | utility | transform | `frontend/src/modules/theme.ts` (module structure) + `frontend/src/modules/utils.ts:116-124` (textContent pattern) | role-match |
| `frontend/src/pages/dashboard.ts` | page/controller | request-response | self (safe imperative-DOM islands already inside the file) | self-analog |
| `frontend/src/pages/tripDetail.ts` | page/controller | request-response | self (safe createElement chains + buildLegendItem scaffold) | self-analog |
| `frontend/src/modules/map.ts` | utility/view | event-driven | self (safe createElement chains at lines 85-93) | self-analog |
| `backend/src/middleware/cors.ts` | middleware | request-response | self (existing hono cors() config) | self-analog |
| `backend/src/auth/keycloak.ts` | middleware/service | request-response | self (existing private helpers at lines 47-87) | self-analog |
| `backend/wrangler.toml` | config | — | none (pure deletion) | none |
| `keycloak/realm-export.json` | config | — | none (no existing protocolMappers in codebase) | none |

---

## Pattern Assignments

### `frontend/src/modules/dom.ts` (utility, transform) — NEW

**Module structure analog:** `frontend/src/modules/theme.ts` lines 1-22

```typescript
import type { Theme, ThemeConfig } from '@/types';

// small, named exports — no default export, no comments, explicit param/return types
export function getTheme(): Theme { ... }
export function getThemeConfig(theme?: Theme): ThemeConfig { ... }
export function initTheme(): void { ... }
```

**Safe textContent pattern analog:** `frontend/src/modules/utils.ts` lines 116-124

```typescript
export function announceToScreenReader(message: string): void {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.className = 'sr-only';
  el.textContent = message;   // <-- the safe assignment pattern dom.ts setText() wraps
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
```

**Implementation (locked by D-02 — copy verbatim):**

```typescript
// frontend/src/modules/dom.ts
export function setText(el: Element, text: string): void {
  el.textContent = text;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  el.style.setProperty(prop, value);
}
```

No imports needed. Two named exports, explicit types, no default export.

---

### `frontend/src/pages/dashboard.ts` (page, request-response) — EDIT (SEC-01)

**Problem sites (from reading the file):**
- Line 29: `renderTripCard(trip: ApiTrip): string` — string-returning template with 5 injection points
- Line 43: `background-image:url('${trip.cover_image_url}')` — inline style injection
- Line 47: `${trip.name}` inside `<h3>` via innerHTML
- Line 48: `${trip.description}` inside `<p>` via innerHTML
- Line 63-70: `grid.innerHTML = ...` for empty state
- Line 72: `grid.innerHTML = trips.map(...).join('')`
- Line 195: `grid.innerHTML = \`<p ...>${(err as Error).message}</p>\`` — error message injection

**Imperative createElement analog (safe pattern already in file):** `frontend/src/pages/dashboard.ts` lines 75-80

```typescript
function renderUserGreeting(user: ApiUser | null): void {
  const greeting = document.getElementById('dashboard-greeting');
  if (!greeting) return;
  const name = user?.name ?? getUserInfo()?.name ?? null;
  greeting.textContent = name ? `Hola, ${name.split(' ')[0]}` : 'Mis viajes';
}
```

**Analog for converting renderTripCard from string-returning to DOM-building:** `frontend/src/pages/tripDetail.ts` lines 318-329

```typescript
function buildLegendItem(activity: Activity, idx: number, day: Day): HTMLElement {
  const isOptional = !!activity.optional;
  const markerLabel = isOptional ? activity.optional! : idx + 1;
  const markerColor = isOptional ? '#af52de' : day.color;
  const mapsUrl = getMapsUrl(activity.name);
  const item = document.createElement('li');
  item.className = 'legend-item' + (isOptional ? ' is-optional' : '');
  // ... build child elements imperatively, then return item
  return item;
}
```

Copy this scaffold: `createElement` → set `className` → build children → return `HTMLElement`. Change `renderTripCard` signature from `(): string` to `(trip: ApiTrip): HTMLElement`. Change `grid.innerHTML = trips.map(t => renderTripCard(t)).join('')` to `trips.forEach(t => grid.appendChild(renderTripCard(t)))`.

**WARNING — do NOT copy lines 344-351 of buildLegendItem** — `item.innerHTML = ...` at those lines is itself an SEC-01 site, not a safe analog.

**setStyle call for cover_image_url:**

```typescript
// BEFORE (dashboard.ts line 38):
`background-image:url('${trip.cover_image_url}');...`

// AFTER:
import { setStyle } from '@/modules/dom';
// ...
setStyle(coverEl, 'background-image', `url('${trip.cover_image_url}')`);
```

**Import line to add:**

```typescript
import { setText, setStyle } from '@/modules/dom';
```

Import only the functions actually used. `noUnusedLocals` will fail if you import both but only use one (RESEARCH.md Pitfall 3).

---

### `frontend/src/pages/tripDetail.ts` (page, request-response) — EDIT (SEC-01 + SEC-02)

**Problem sites (from reading the file):**
- Lines 50-61: `tabsEl.innerHTML = sorted.map(...).join('')` — `dest.city_name` injected via innerHTML
- Lines 92-96: `createMarkerIcon` — `label` (could be user-supplied) and `color` (day.color) injected in DivIcon html string
- Lines 108-126: `buildPopup` — `day.label`, `activity.name`, `activity.notes` injected (SEC-02 target)
- Lines 128-144: `buildHotelPopup` — `hotel.name` injected (SEC-02 target)
- Lines 300-306: `dayGroup.innerHTML = ...` — `day.color`, `day.label` injected
- Lines 344-351: `item.innerHTML = ...` — `markerColor`, `markerLabel`, `activity.name`, `noteText` injected
- Lines 363-373: `actionsHtml` inline HTML with URLs + `hotelInfo.innerHTML`
- Line 413-418: `showError` — `message` injected into innerHTML

**Safe imperative-DOM analog already in file (lines 168-178):**

```typescript
const btn = document.createElement('button');
btn.className = 'day-btn' + (day.hasOptions ? ' has-options' : '');
btn.textContent = day.label;
btn.dataset.day = dateKey;
btn.setAttribute('role', 'tab');
btn.setAttribute('aria-selected', 'false');
if (day.hasOptions) btn.title = 'Este día tiene opciones alternativas';
daySelector.appendChild(btn);
```

This is the definitive `createElement` → property assignments → `textContent` → `appendChild` idiom to replicate for tabs and legend items.

**DOMPurify import (SEC-02) — new, no codebase analog:**

```typescript
import DOMPurify from 'dompurify';
```

Add at top of file alongside existing imports. Reference RESEARCH.md Pattern 3 (lines 235-248) for the `return DOMPurify.sanitize(html)` insertion point inside `buildPopup` and `buildHotelPopup`.

**dom.ts import:**

```typescript
import { setText, setStyle } from '@/modules/dom';
```

---

### `frontend/src/modules/map.ts` (utility/view, event-driven) — EDIT (SEC-01 + SEC-02)

**Problem sites (from reading the file):**
- Lines 29-33: `createMarkerIcon` — `color` and `label` in DivIcon html string
- Lines 45-53: `createPopupContent` — `day.label`, `activity.optional`, `activity.name`, `activity.notes` injected (SEC-02 target)
- Lines 56-62: `createHotelPopup` — `hotel.name` injected (SEC-02 target)
- Line 236: `dayGroup.innerHTML = ...` — `day.color`, `day.label` injected
- Line 260: `item.innerHTML = ...` — `markerColor`, `markerLabel`, `activity.name`, `noteText` injected
- Lines 271-273: `hotelInfo.innerHTML = ...` — `hotel.name` injected
- Line 305: overview map popup — `city.name`, `city.dates`, `city.link` injected

**Safe imperative-DOM analog already in file (lines 85-93):**

```typescript
const btn = document.createElement('button');
btn.className = 'day-btn' + (day.hasOptions ? ' has-options' : '');
btn.textContent = day.label;
btn.dataset.day = dateKey;
btn.setAttribute('role', 'tab');
btn.setAttribute('aria-selected', 'false');
if (day.hasOptions) btn.title = 'Este día tiene opciones alternativas';
daySelector.appendChild(btn);
```

Same idiom as tripDetail.ts — copy this pattern for all non-popup innerHTML replacements.

**PLAN BLOCKER — map.ts popup builders (from RESEARCH.md Open Question 1):**
`createPopupContent` (line 45) and `createHotelPopup` (line 56) mirror `buildPopup`/`buildHotelPopup` in tripDetail.ts and call `bindPopup()` with user-controlled HTML strings. D-04 names only tripDetail.ts, but RESEARCH.md states this leaves map.ts popups unsanitized. The planner must resolve this before implementation — recommended action: expand DOMPurify to cover map.ts popup builders as well (same one-line pattern).

**dom.ts import:**

```typescript
import { setText, setStyle } from '@/modules/dom';
```

---

### `backend/src/middleware/cors.ts` (middleware, request-response) — EDIT (SEC-03)

**Self-analog — current state (lines 1-27):**

```typescript
import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: (origin) => {
    const allowed = [
      'https://manud.github.io',
      'http://localhost:3000',
      'http://localhost:5173',
    ];
    if (!origin || allowed.includes(origin)) {
      return origin ?? '*';   // LINE 18 — BUG: returns '*' for null origin
    }
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: true,           // LINE 26 — dead code, remove
});
```

**Two-change fix:**
1. Line 18: `return origin ?? '*'` → `return origin ?? null`
2. Line 26: remove `credentials: true,` entirely (no replacement)

---

### `backend/src/auth/keycloak.ts` (service/middleware, request-response) — EDIT (SEC-04)

**Target site — current state (lines 192-200):**

```typescript
// Validate audience — must include japan-trip-api or japan-trip-frontend
const validAudiences = ['japan-trip-api', 'japan-trip-frontend', 'account'];
const aud = payload.aud;
if (aud) {
  const audArray = Array.isArray(aud) ? aud : [aud];
  const hasValidAud = audArray.some((a) => validAudiences.includes(a));
  if (!hasValidAud) {
    throw new Error(`JWT audience not accepted: ${JSON.stringify(aud)}`);
  }
}
```

**Change 1 — reduce validAudiences (D-07):**

```typescript
// AFTER:
const validAudiences = ['japan-trip-frontend'];
```

**Change 2 — extract `validateAudience` helper for testability (RESEARCH.md line 460):**

The existing private helper pattern to copy from (`keycloak.ts` lines 47-87) — small, pure functions with typed signatures:

```typescript
function base64urlToArrayBuffer(base64url: string): ArrayBuffer { ... }
function base64urlDecode(base64url: string): string { ... }
async function importRsaPublicKey(jwk: JwkKey): Promise<CryptoKey> { ... }
```

Extract the audience check as a named pure helper following the same style:

```typescript
export function validateAudience(aud: string | string[] | undefined, valid: string[]): boolean {
  if (!aud) return false;
  const audArray = Array.isArray(aud) ? aud : [aud];
  return audArray.some((a) => valid.includes(a));
}
```

Then inside `verifyJwt`, replace lines 194-200 with a call to `validateAudience`. Exporting it allows the unit test (backend Wave 0) to test audience logic without mocking JWKS.

---

### `backend/wrangler.toml` (config) — EDIT (SEC-05)

No pattern needed. Delete lines 13-18 verbatim:

```toml
[[d1_databases]]
# Placeholder — actual database is Neon (PostgreSQL) via DATABASE_URL env var.
# Remove or replace this block if you add a D1 database in the future.
binding = "DB_PLACEHOLDER"
database_name = "placeholder"
database_id = "placeholder"
```

---

## Shared Patterns

### Named exports / module structure
**Source:** `frontend/src/modules/theme.ts` lines 1-14
**Apply to:** `dom.ts` (new file)

Small utility modules in this project use:
- `import type { ... } from '@/types'` at the top if types are needed
- `export function name(param: Type): ReturnType { ... }` — named exports only, no default export
- No comments unless WHY is non-obvious (per CLAUDE.md global rules)

### Imperative DOM construction (safe pattern)
**Source:** `frontend/src/modules/map.ts` lines 85-93 and `frontend/src/pages/tripDetail.ts` lines 168-178
**Apply to:** All innerHTML replacement sites in dashboard.ts, tripDetail.ts, map.ts

Pattern: `createElement` → set `className` directly → set `textContent` for text → `dataset` / `setAttribute` for attributes → `appendChild` to parent. No string concatenation into DOM.

### TypeScript strict mode compliance
**Source:** All existing files
**Apply to:** `dom.ts` and all edits

- Explicit param types and return types on all exported functions
- No `any` unless casting existing `any` patterns already present in the file
- Only import what is used (avoid `noUnusedLocals` failure)

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `keycloak/realm-export.json` | config | — | No existing `protocolMappers` in `clients[0]` of the file (confirmed: empty array). Use RESEARCH.md Pattern 4 (lines 252-266) as the JSON template. |
| `frontend/src/modules/dom.ts` (DOMPurify import) | — | — | No existing `import DOMPurify from 'dompurify'` in codebase. Use RESEARCH.md Pattern 3 (lines 235-248). |

---

## Metadata

**Analog search scope:** `frontend/src/modules/`, `frontend/src/pages/`, `backend/src/middleware/`, `backend/src/auth/`, `backend/`, `keycloak/`
**Files read:** 8 source files + realm-export.json structure probed
**Pattern extraction date:** 2026-04-26
