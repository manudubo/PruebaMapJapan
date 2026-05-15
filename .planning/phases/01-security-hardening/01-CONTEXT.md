# Phase 1: Security Hardening - Context

**Gathered:** 2026-04-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix all user-controlled string injection points in the three required frontend files, harden the backend CORS and JWT configuration, and remove the stale D1 binding from wrangler.toml. Scope is surgical: exactly SEC-01 through SEC-05.

</domain>

<decisions>
## Implementation Decisions

### XSS / innerHTML (SEC-01)

- **D-01:** Scope is the three files named in requirements: `dashboard.ts`, `tripDetail.ts`, `map.ts`. `widgets.ts`, `profile.ts`, and `SearchBar.ts` are deferred — their injection surfaces are lower risk and belong in a cleanup phase.
- **D-02:** Create `frontend/src/modules/dom.ts` as the injection-safe DOM helper. Expose exactly two functions: `setText(el: Element, text: string)` (sets `textContent`) and `setStyle(el: HTMLElement, prop: string, value: string)` (sets via `el.style.setProperty()`). No createElement, no setAttr — minimal API matching the exact SEC-01 use cases.
- **D-03:** Inline style injection sites (`cover_image_url`, `day.color`) are fixed via `setStyle()` using `el.style.setProperty()`. The browser CSS parser rejects script injection via style properties — no external sanitizer needed here.

### DOMPurify / Leaflet popups (SEC-02)

- **D-04:** DOMPurify is used **only** in `buildPopup` and `buildHotelPopup` in `tripDetail.ts`. The `dom.ts` path uses `textContent` which needs no sanitization — clean separation.
- **D-05:** Install via npm: `dompurify` only in `frontend/package.json`. Do NOT install `@types/dompurify` — it is deprecated; DOMPurify 3.x ships its own type definitions. Bundled by Vite, consistent with existing module setup.

### CORS (SEC-03)

- **D-06:** Fix the null-origin fallback in `cors.ts:18` — return `null` instead of `'*'` when origin is null/absent. This makes the response spec-valid with `credentials: true`.

### JWT Audience (SEC-04)

- **D-07:** Accept **only** `japan-trip-frontend` as a valid audience. Remove both `'account'` and `'japan-trip-api'` from `validAudiences` in `keycloak.ts`. Single audience, smaller attack surface.
- **D-08:** Update `keycloak/realm-export.json` to add an audience mapper for the `japan-trip-frontend` client. This ensures local dev Docker setup is consistent with the hardened code after re-import. Code change alone would reject all current tokens.

### Stale D1 Binding (SEC-05)

- **D-09:** Remove the `[[d1_databases]]` block from `backend/wrangler.toml` entirely. No placeholder comment needed.

### Claude's Discretion

- `@types/dompurify` version selection — pick latest compatible with DOMPurify 3.x
- Exact structure of the audience mapper in realm-export.json — standard Keycloak `Audience` protocol mapper targeting `japan-trip-frontend`
- Whether to add `/** @see SEC-01 */` or similar comments on dom.ts functions — keep consistent with project's comment style (no-comment-unless-why-is-nonobvious)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Goals
- `.planning/REQUIREMENTS.md` — SEC-01 through SEC-05 definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 1 — five success criteria that define done

### Files to Modify
- `backend/src/middleware/cors.ts` — CORS bug: `return origin ?? '*'` on line 18 (returns `'*'` for null origin even with credentials: true)
- `backend/src/auth/keycloak.ts` — JWT audience: `validAudiences` array at line 193 includes `'account'` and `'japan-trip-api'`
- `backend/wrangler.toml` — stale `[[d1_databases]]` block to remove
- `frontend/src/pages/tripDetail.ts` — `buildPopup` (line 108) and `buildHotelPopup` (line 128) need DOMPurify; 11+ innerHTML injection sites
- `frontend/src/pages/dashboard.ts` — innerHTML injection sites
- `frontend/src/modules/map.ts` — innerHTML injection sites including day.color and activity.name

### Files to Create
- `frontend/src/modules/dom.ts` — new helper (no existing file)

### Keycloak Config
- `keycloak/realm-export.json` — add audience mapper for `japan-trip-frontend` client

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/modules/utils.ts:51` — has `if (html) el.innerHTML = html;` pattern; this file is NOT in SEC-01 scope but shows the style that dom.ts should replace
- Vite multi-page build already configured — adding dom.ts as a module import will work with no build config changes

### Established Patterns
- Named exports used for utility modules (matching CONVENTIONS.md) — dom.ts should use `export function setText(...)` not default export
- TypeScript strict mode enforced — dom.ts must have explicit param types and return types
- No Prettier/ESLint at root — formatting by convention

### Integration Points
- `frontend/src/modules/dom.ts` will be imported by `dashboard.ts`, `tripDetail.ts`, `map.ts` — standard relative or `@/` alias imports
- DOMPurify imported at top of `tripDetail.ts` via `import DOMPurify from 'dompurify'`
- `keycloak/realm-export.json` is consumed by Docker Compose local setup — changing it requires re-importing the realm in Keycloak admin console

</code_context>

<specifics>
## Specific Ideas

- No specific design references or "I want it like X" guidance given — implementation follows the success criteria in ROADMAP.md exactly.

</specifics>

<deferred>
## Deferred Ideas

- innerHTML in `widgets.ts`, `profile.ts`, `SearchBar.ts` — in-scope for a future cleanup phase, not SEC-01
- CSP response header via Hono middleware — explicitly deferred to future milestone per REQUIREMENTS.md

</deferred>

---

*Phase: 01-security-hardening*
*Context gathered: 2026-04-26*
