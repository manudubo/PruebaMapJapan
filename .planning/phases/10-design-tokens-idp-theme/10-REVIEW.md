---
phase: 10-design-tokens-idp-theme
reviewed: 2026-05-30T18:42:59Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - frontend/src/auth/AuthGuard.ts
  - frontend/src/components/Navbar.ts
  - frontend/src/components/SearchBar.ts
  - frontend/src/modules/map.ts
  - frontend/src/pages/trip-edit/activities.ts
  - frontend/src/pages/trip-edit/days.ts
  - frontend/src/pages/trip-edit/destinations.ts
  - frontend/src/pages/trip-edit/hotels.ts
  - frontend/src/pages/tripDetail.ts
  - frontend/src/styles/main.css
  - keycloak/themes/japan-trip/account/resources/css/account.css
  - keycloak/themes/japan-trip/email/html/email-verification-with-code.ftl
  - keycloak/themes/japan-trip/email/html/email-verification.ftl
  - keycloak/themes/japan-trip/email/html/executeActions.ftl
  - keycloak/themes/japan-trip/email/html/password-reset.ftl
  - keycloak/themes/japan-trip/email/html/template.ftl
  - keycloak/themes/japan-trip/email/messages/messages_en.properties
  - keycloak/themes/japan-trip/email/messages/messages_es.properties
  - keycloak/themes/japan-trip/email/text/email-verification-with-code.ftl
  - keycloak/themes/japan-trip/email/text/email-verification.ftl
  - keycloak/themes/japan-trip/email/text/executeActions.ftl
  - keycloak/themes/japan-trip/email/text/password-reset.ftl
  - keycloak/themes/japan-trip/email/theme.properties
  - keycloak/themes/japan-trip/login/resources/css/login.css
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-05-30T18:42:59Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Phase 10 renamed CSS custom properties from legacy names to the `--jp-*` prefix (DESIGN-01), added 8 new semantic tokens (D-03), and created the Keycloak email theme. The token rename was applied correctly to `main.css`, all four Shadow DOM component files (AuthGuard, Navbar, SearchBar), the KC CSS files, and the page modules — with one critical exception.

The day-color picker in `trip-edit/days.ts` was not updated: it still references `--marker-N` (old names) instead of `--jp-marker-N`. Since the old names no longer exist anywhere in the stylesheet, every color swatch on the day-edit UI will render with no background color — a visible, functional regression.

Two additional warnings cover a duplicate `@media print` block in `main.css` (producing conflicting `border` declarations) and a missing CSS fallback value in `destinations.ts`. Three info-level items cover minor code quality issues.

KC email FTLs are correctly structured: all four HTML delegation files wrap content in `kcSanitize()` with `?no_esc`, the `template.ftl` uses inline styles (correct for email), and both `messages_en.properties` and `messages_es.properties` keep the `{N}` message parameters consistent with what the FTLs pass. No XSS vectors found.

---

## Critical Issues

### CR-01: Color swatches in day editor use renamed-away CSS variables

**File:** `frontend/src/pages/trip-edit/days.ts:7-14, 104, 111`

**Issue:** `COLOR_MAP` keys are `'--marker-1'` through `'--marker-8'`, and the swatch `setStyle()` call on line 111 renders `var(--marker-N)` into inline `background`. The token rename in Phase 10 moved these to `--jp-marker-1` through `--jp-marker-8` in `main.css`. Neither the `:root` block nor any other stylesheet defines `--marker-N` any longer. Every swatch in the day-edit color picker will render with no background color (invisible or white squares in light mode, invisible in dark mode). Selecting a swatch still sets `selectedColor` to the old key name, so the `COLOR_MAP` lookup on save (`COLOR_MAP[selectedColor]`) will also return `undefined`, sending `color_hex: null` to the API instead of the intended hex value.

**Fix:**
```typescript
// days.ts lines 6-15 — update both map and swatch rendering
const COLOR_MAP: Record<string, string> = {
  '--jp-marker-1': '#ff3b30',
  '--jp-marker-2': '#ff9500',
  '--jp-marker-3': '#ffcc00',
  '--jp-marker-4': '#34c759',
  '--jp-marker-5': '#5ac8fa',
  '--jp-marker-6': '#007aff',
  '--jp-marker-7': '#af52de',
  '--jp-marker-8': '#ff2d55',
};

// line 104 — inside the for loop:
const varName = `--jp-marker-${n}`;
```

`REVERSE_COLOR_MAP` is derived from `COLOR_MAP` automatically and needs no separate fix. The `setStyle(swatch, 'background', \`var(${varName})\`)` call on line 111 will then correctly emit `var(--jp-marker-N)`.

---

## Warnings

### WR-01: Duplicate `@media print` block with conflicting `border` declarations

**File:** `frontend/src/styles/main.css:1824-1839, 1919-1927`

**Issue:** There are two separate `@media print` blocks. The first (line 1824) hides UI chrome and sets `.page-card { border: 1px solid #ddd; }`. The second (line 1919) again hides UI chrome (with slightly different selectors) and sets `.page-card { border: 1px solid #000; }`. The second block takes precedence, so the `#ddd` border is never used. This is dead code that creates confusion about the intended print border color, and the duplicated display-none declarations produce unnecessary CSS weight.

**Fix:** Merge the two blocks into one, pick a single print border (the `#000` one is stronger for print legibility), and remove the first block:

```css
@media print {
  .top-nav, nav,
  .theme-toggle,
  .day-selector,
  .hotel-btn,
  .countdown-container,
  .legend-actions,
  .widgets-section,
  search-bar {
    display: none !important;
  }

  .page-card {
    box-shadow: none;
    border: 1px solid #000;
  }
}
```

### WR-02: Shadow DOM `--jp-white` token used without a fallback value in Navbar and AuthGuard

**File:** `frontend/src/components/Navbar.ts:240`, `frontend/src/auth/AuthGuard.ts:122`

**Issue:** Shadow DOM components inherit CSS custom properties from the host document, which works when `--jp-white` is defined. However, both files use `color: var(--jp-white)` and `color: var(--jp-white)` (respectively) without a fallback value. If the component is embedded in a host that does not load `main.css` (e.g., a test harness, an iframe, a future storybook environment), the property resolves to the initial value (empty), causing affected elements to lose their text color. All other property usages in these same files include fallbacks (e.g., `var(--jp-accent, #0071e3)`), making the missing fallback inconsistent.

**Fix:**
```css
/* Navbar.ts line 240 */
color: var(--jp-white, #fff);

/* AuthGuard.ts line 122 */
color: var(--jp-white, #fff);
```

### WR-03: `destinations.ts` uses `--jp-text-secondary` without a fallback

**File:** `frontend/src/pages/trip-edit/destinations.ts:424`

**Issue:** `dateSpan.style.color = 'var(--jp-text-secondary)'` has no fallback. This element is rendered into the main document (not a Shadow DOM), so it does inherit from `:root`, but the pattern is inconsistent with every other token use in the trip-edit modules (all of which supply fallbacks, e.g. `var(--jp-text-secondary, #515154)`). If the token is ever unset or missing, the element's color defaults to the browser default rather than the intended secondary text color.

**Fix:**
```typescript
dateSpan.style.color = 'var(--jp-text-secondary, #515154)';
```

---

## Info

### IN-01: Navbar scrollbar track uses a bare hardcoded `rgba` value

**File:** `frontend/src/components/Navbar.ts:167`

**Issue:** `.top-nav::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); }` uses a bare hardcoded color. The equivalent token `--jp-border` resolves to `rgba(0,0,0,0.06)` in light mode and `rgba(255,255,255,0.08)` in dark mode. This means the scrollbar track will not invert correctly in dark mode (it will stay dark-tinted instead of light-tinted), which is inconsistent with the main-document scrollbar rule at `main.css:601` that uses `var(--jp-surface-subtle)`.

**Fix:**
```css
.top-nav::-webkit-scrollbar-track {
  background: rgba(0,0,0,0.05); /* → var(--jp-border, rgba(0,0,0,0.05)) */
}
```
Or use the token that matches the main.css rule:
```css
background: var(--jp-border, rgba(0,0,0,0.05));
```

### IN-02: `map.ts` and `tripDetail.ts` use hardcoded `#af52de` for optional markers

**File:** `frontend/src/modules/map.ts:107`, `frontend/src/modules/map.ts:271`, `frontend/src/pages/tripDetail.ts:188`, `frontend/src/pages/tripDetail.ts:337`

**Issue:** Optional marker color is hardcoded as `'#af52de'` in four places across two files. The token `--jp-optional` (`#af52de`) was introduced in Phase 10 to centralize this value. These sites were not updated to read from the token, so if `--jp-optional` is ever adjusted they will diverge.

Note: because these values are set as JavaScript strings passed to `L.DivIcon` / `setStyle()`, they cannot directly use `var()`. The correct fix is to read the computed property at runtime or to define a JS constant mirroring the token:

```typescript
// At module level, e.g. in a shared constants file or at top of map.ts
const OPTIONAL_COLOR = '#af52de'; // mirrors --jp-optional

// Then replace each '#af52de' literal with OPTIONAL_COLOR
const markerColor = isOptional ? OPTIONAL_COLOR : day.color;
```

This is a code quality issue, not a breakage, since the value currently matches the token.

### IN-03: `destinations.ts` `buildModal()` is not guarded against double-call

**File:** `frontend/src/pages/trip-edit/destinations.ts:31-152`

**Issue:** Unlike `activities.ts` and `hotels.ts` (which both check `if (modalOverlay) return;` at the top of their `buildModal()` functions), `destinations.ts:buildModal()` has no such guard. `buildModal()` is called once from `initDestinationsSection()` (line 487) and is not called again in normal flow, so this does not currently cause a bug. However, it's an inconsistency that could lead to duplicate DOM elements being appended to `document.body` if `buildModal()` were ever called a second time (e.g., if `initDestinationsSection()` is invoked twice due to SPA navigation).

**Fix:**
```typescript
function buildModal(): void {
  if (modalOverlay) return;  // add this guard

  const overlay = document.createElement('div');
  // ...
}
```

---

_Reviewed: 2026-05-30T18:42:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
