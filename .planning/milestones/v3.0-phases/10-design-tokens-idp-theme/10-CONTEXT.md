# Phase 10: Design Tokens + IDP Theme - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a unified visual language shared between the app (`frontend/src/styles/main.css`) and Keycloak login pages (`keycloak/themes/japan-trip/login/resources/css/login.css`). This includes:
- Renaming all CSS custom properties in main.css to the `--jp-*` prefix
- Eliminating remaining hardcoded hex/rgba values outside token definitions
- Adding KC email templates (new `email/html/` directory in KC theme)
- Fixing MPA theme flash (FOUC) via inline `<script>` in all HTML heads
- Light/dark tile layer switching on the Leaflet map already works; DESIGN-04 is about persistence, not tile switching

**Out of scope for this phase:**
- Error handling, toast notifications (Phase 11)
- Keycloak account console restyling (React/PatternFly — out of scope per PROJECT.md)
- Any changes to passkey AIA FreeMarker templates (frozen — passkeys.spec.ts must pass unchanged)

</domain>

<decisions>
## Implementation Decisions

### Token Naming — DESIGN-01

- **D-01**: Rename ALL CSS custom properties in `frontend/src/styles/main.css` from current generic names to `--jp-*` prefix. Every reference to old token names in `.ts`, `.html`, and `.css` files must be updated.
  - Mapping: `--bg-primary` → `--jp-bg`, `--bg-secondary` → `--jp-surface`, `--bg-glass` → `--jp-surface`, `--bg-glass-strong` → `--jp-surface-raised`, `--bg-glass-subtle` → `--jp-surface-subtle`, `--border-color` → `--jp-border`, `--border-strong` → `--jp-border-strong`, `--border-glass` → `--jp-border-glass`, `--text-primary` → `--jp-text`, `--text-secondary` → `--jp-text-secondary`, `--text-tertiary` → `--jp-text-tertiary`, `--accent` → `--jp-accent`, `--accent-hover` → `--jp-accent-hover`, `--accent-subtle` → `--jp-accent-subtle`, `--success` → `--jp-success`, `--success-subtle` → `--jp-success-subtle`, `--danger` → `--jp-danger`, `--danger-hover` → `--jp-danger-hover`, `--danger-subtle` → `--jp-danger-subtle`, `--shadow-sm` → `--jp-shadow-sm`, `--shadow-md` → `--jp-shadow-md`, `--shadow-lg` → `--jp-shadow-lg`, `--shadow-glass` → `--jp-shadow-glass`, `--shadow-glass-hover` → `--jp-shadow-glass-hover`, `--radius` → `--jp-radius`, `--blur` → `--jp-blur`, `--blur-strong` → `--jp-blur-strong`, `--gradient-glass` → `--jp-gradient-glass`, `--gradient-shine` → `--jp-gradient-shine`, `--font-sans` → `--jp-font`, `--hotel` → `--jp-hotel`, `--optional` → `--jp-optional`, `--directions` → `--jp-directions`, `--marker-1..8` → `--jp-marker-1..8`
- **D-02**: `login.css` keeps its own independent `--jp-*` definitions. No shared import file between main.css and login.css. Values maintained in sync manually.
- **D-03**: Add new semantic tokens to eliminate remaining hardcoded rgba/hex values in main.css component rules:
  - `--jp-hotel-subtle`: `rgba(255, 149, 0, 0.08)` (used in `.hotel-info`)
  - `--jp-hotel-border`: `rgba(255, 149, 0, 0.2)` (used in `.hotel-info`)
  - `--jp-optional-subtle`: `rgba(175, 82, 222, 0.1)` (used in `.day-btn.has-options:hover`)
  - `--jp-white`: `#fff` / `#ffffff` (used as hardcoded foreground-on-accent in buttons/markers)
  - Note: `#fff` in dark-mode `[data-theme="dark"]` rules stays as-is in the dark overrides for `--jp-*` — those are values, not usages.

### Theme Persistence — DESIGN-04

- **D-04**: Add an inline `<script>` in the `<head>` of all 9 HTML files (before any `<link rel="stylesheet">`) that synchronously reads `localStorage.getItem('theme')` and sets `document.documentElement.setAttribute('data-theme', ...)`. This eliminates the FOUC on MPA navigation.
  - Fallback: if no localStorage value, do not set the attribute (CSS `:root` defaults to light)
  - The existing `initTheme()` in `theme.ts` remains for system preference detection and dynamic switching

### KC Dark Mode — login.css

- **D-05**: KC login pages continue using `@media (prefers-color-scheme: dark)` for dark mode. No sync with app localStorage preference. Users who manually override app theme (light system + dark app) will see KC in light mode. Accepted mismatch — KC flows are transient.

### Email Templates — DESIGN-03

- **D-06**: Create a new `keycloak/themes/japan-trip/email/html/` directory with branded HTML email templates for all login-flow emails (email verification, OTP, password reset, and any others in KC default email themes for v26.6.1).
- **D-07**: Email template design: full branded card layout.
  - Header: "TravelMap" text + 1px horizontal divider below
  - Card: white background, 1px border, `border-radius: 0`, max-width ~560px, centered
  - Typography: `Inter, -apple-system, 'Helvetica Neue', sans-serif` via inline styles
  - Colors inline (no external CSS — email clients require inline): `#1d1d1f` text, `#0071e3` links/accent, `#f5f5f7` body background
  - Footer: minimal, no logo
  - No dark mode in emails (email clients have inconsistent support)
  - Must have a plain text equivalent (`email/text/` directory)

### Claude's Discretion

- Token mapping decisions for tokens that don't have an exact login.css equivalent (e.g., `--jp-blur`, `--jp-gradient-shine`) — keep them in main.css with `--jp-*` prefix, skip adding to login.css
- Exact HTML structure of email card (inline style details, padding values)
- Whether to alias `--jp-shadow-glass` and `--jp-shadow-glass-hover` (both are currently `none`) — can collapse or keep as-is
- Whether to add a `--jp-white: #fff` token or use literal `#fff` where it represents "white on colored background" (a true neutral, not a palette token)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §DESIGN — DESIGN-01 through DESIGN-04 (exact acceptance criteria)
- `.planning/ROADMAP.md` §Phase 10 — success criteria and scope

### Key source files
- `frontend/src/styles/main.css` — current token definitions and all component rules to rename
- `keycloak/themes/japan-trip/login/resources/css/login.css` — existing `--jp-*` definitions; reference for token values
- `frontend/src/modules/theme.ts` — `initTheme()`, `toggleTheme()`, `updateMapTheme()` — do not break event dispatch
- All 9 HTML files: `index.html`, `tokyo.html`, `nagoya.html`, `takayama.html`, `kyoto.html`, `osaka.html`, `naoshima.html`, `hakone.html`, `tokyo2.html` — each needs the anti-FOUC inline script

### KC Theme structure
- `keycloak/themes/japan-trip/login/` — existing login page templates
- `keycloak/themes/japan-trip/login/footer.ftl` — shared KC login footer (reference)
- KC email template structure for v26.6.1: researcher should verify default template file names before creating new ones

### Testing constraint
- `passkeys.spec.ts` — MUST pass after any Keycloak theme change (AIA templates are frozen; no changes to passkey flow FTL files)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/modules/theme.ts`: `initTheme()`, `toggleTheme()`, `updateMapTheme()` — all working; only the token rename in CSS affects these (no TS changes needed unless `theme.ts` references specific token names via JS, which it doesn't)
- `frontend/src/modules/map.ts`: `updateMapTheme()` already handles tile layer switching on `theme-changed` event — no changes needed here for Phase 10

### Established Patterns
- Theme via `data-theme` attribute on `<html>`: `[data-theme="dark"]` CSS overrides in main.css — keep this pattern
- `localStorage.getItem('theme')` key is `'theme'` — inline script must use this exact key
- KC login page: all styles via `login.css` with `!important` overrides of PatternFly defaults — keep `!important` pattern
- `--jp-*` namespace already established in login.css — main.css joins this namespace

### Integration Points
- Anti-FOUC inline script goes into all 9 HTML `<head>` tags, before `<link rel="stylesheet">`
- New KC email templates require `keycloak/themes/japan-trip/email/html/` and `email/text/` directories + `theme.properties` in `email/`
- `account.css` in `keycloak/themes/japan-trip/account/resources/css/` — check if it also uses hardcoded hex values that need updating (DESIGN-01 scope covers "Keycloak CSS files")

</code_context>

<specifics>
## Specific Ideas

- Email header: "TravelMap" as plain text (no image/SVG), followed by `<hr style="border: none; border-top: 1px solid #d0d0d5; margin: 12px 0 24px;">` — matches the minimalist aesthetic
- Inline script pattern for anti-FOUC:
  ```html
  <script>
    (function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t)})();
  </script>
  ```
  Must be inline (not `src=`), must be before CSS links, must be minimal to not block rendering

</specifics>

<deferred>
## Deferred Ideas

- KC account console dark mode styling (React/PatternFly — out of scope per PROJECT.md)
- Cookie-based KC dark mode sync (user accepted prefers-color-scheme mismatch)
- Shared token file between main.css and login.css (user chose independent definitions)

</deferred>

---

*Phase: 10-design-tokens-idp-theme*
*Context gathered: 2026-05-29*
