# Phase 10: Design Tokens + IDP Theme — Research

**Researched:** 2026-05-29
**Domain:** CSS design tokens, FreeMarker email templates, Keycloak 26.6.1 theme structure
**Confidence:** HIGH (all findings verified against source files or official KC repo)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01**: Rename ALL CSS custom properties in `frontend/src/styles/main.css` from current generic names to `--jp-*` prefix. Full mapping in CONTEXT.md §D-01.
- **D-02**: `login.css` keeps independent `--jp-*` definitions. No shared import file. Values maintained in sync manually.
- **D-03**: Add four new semantic tokens to eliminate remaining hardcoded rgba/hex in component rules: `--jp-hotel-subtle`, `--jp-hotel-border`, `--jp-optional-subtle`, `--jp-white`.
- **D-04**: Anti-FOUC: inline `<script>` in all 9 HTML `<head>` tags before `<link rel="stylesheet">`, reads `localStorage.getItem('theme')`, sets `data-theme`. Fallback: no localStorage → no attribute set.
- **D-05**: KC login pages use `@media (prefers-color-scheme: dark)` only. No localStorage sync.
- **D-06**: New `keycloak/themes/japan-trip/email/html/` directory with branded HTML email templates.
- **D-07**: Email card layout: "TravelMap" text header + divider, white card, `border-radius: 0`, Inter font via inline styles, `#1d1d1f` text, `#0071e3` accent, `#f5f5f7` body bg. Plain text equivalents in `email/text/`. No dark mode.

### Claude's Discretion
- Token mapping for tokens without login.css equivalents (`--jp-blur`, `--jp-gradient-shine`) — keep in main.css, skip in login.css
- Exact HTML structure of email card (inline style details, padding values)
- Whether to alias `--jp-shadow-glass` and `--jp-shadow-glass-hover` (both are `none`)
- Whether to add `--jp-white: #fff` token or use literal `#fff` where it represents white-on-colored

### Deferred Ideas (OUT OF SCOPE)
- KC account console dark mode (React/PatternFly)
- Cookie-based KC dark mode sync
- Shared token file between main.css and login.css
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DESIGN-01 | No hardcoded hex values in main.css or KC CSS outside `--jp-*` definitions | Full token audit below; list of all residual hardcoded values with proposed resolutions |
| DESIGN-02 | KC login page: Helvetica font, `border-radius: 0`, matching palette, no KC logo | login.css already implements all four; near-zero new work — see §DESIGN-02 status |
| DESIGN-03 | KC email templates apply app typography and color palette via inline styles | Email architecture: override `template.ftl` macro + message properties; file list verified from KC 26.6.1 source |
| DESIGN-04 | Light/dark toggle persists across MPA page navigations; Leaflet switches tile layers | Anti-FOUC script already exists in all 13 HTML files; D-04 spec differs slightly — see §DESIGN-04 mismatch |
</phase_requirements>

---

## Summary

Phase 10 is primarily a rename operation (main.css tokens from old names to `--jp-*`) plus a new build (KC email templates). The rename affects one CSS file, seven TypeScript source files, and the `prefers-contrast` media query block. The email work requires understanding KC 26.6.1's delegation architecture: HTML email bodies live in message property files, not in the `.ftl` files — so branding requires overriding `email/html/template.ftl` for the card chrome AND overriding body message keys in `email/messages/`.

Two findings significantly reshape effort compared to the CONTEXT.md assumptions:

1. D-03's four new tokens do NOT cover all residual hardcoded values. There are 10+ uncovered uses. The planner must extend D-03 or explicitly mark each use out-of-scope.
2. D-04's anti-FOUC work is largely already done — all 13 HTML files already have a functioning localStorage→`data-theme` inline script. The existing script is a superset of D-04's spec. The question is keep-existing vs. replace-with-spec.

DESIGN-02 (KC login visual match) is already satisfied by the current `login.css`.

**Primary recommendation:** Concentrate effort on the token rename (including TS components) and the email template build. Don't rebuild what already exists for DESIGN-02/DESIGN-04.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CSS token definitions | Frontend (CSS) | — | `:root` custom props, `[data-theme="dark"]` overrides |
| Token usage in component styles | Frontend (CSS) | Frontend TS (Web Components) | `var(--token)` in CSS; inline `var(--token, fallback)` in Navbar.ts, SearchBar.ts, etc. |
| Theme persistence across MPA pages | Browser (inline script, runs before CSS) | Frontend TS (theme.ts) | Inline script sets `data-theme` synchronously; theme.ts handles system pref detection and toggle |
| Leaflet tile layer switching | Frontend TS (map.ts) | — | Listens to `theme-changed` event dispatched by theme.ts |
| KC login page styling | Keycloak theme (login.css) | — | PatternFly overrides with `!important`, served by KC |
| KC email template chrome | Keycloak theme (email/html/template.ftl) | — | FreeMarker macro wraps all email bodies |
| KC email body content | Keycloak theme (email/messages/*.properties) | — | `msg()` delegation — bodies are message keys, not in .ftl files |

---

## Standard Stack

### Core (no new packages required)

All changes are in CSS, FreeMarker templates, TypeScript inline styles, and HTML. No npm dependencies are added in this phase.

| Tool | Version | Purpose |
|------|---------|---------|
| Keycloak | 26.6.1 [VERIFIED: keycloak/docker-compose.yml] | IDP, theme host |
| FreeMarker | built-in KC | Email template language |
| Vitest | existing [VERIFIED: frontend/package.json] | Unit tests |
| Playwright | existing [VERIFIED: tests/playwright.config.ts] | E2E tests |

---

## Architecture Patterns

### Token Definition Structure (main.css)

```css
/* Token definitions — hex/rgba values ARE allowed here */
:root {
  --jp-bg: #f5f5f7;
  /* ... all other --jp-* tokens ... */
  --jp-hotel-subtle: rgba(255, 149, 0, 0.08);   /* new D-03 */
  --jp-hotel-border: rgba(255, 149, 0, 0.2);    /* new D-03 */
  --jp-optional-subtle: rgba(175, 82, 222, 0.1); /* new D-03 */
  --jp-white: #fff;                               /* new D-03 — or keep literal */
}

[data-theme="dark"] {
  /* Token overrides — hex/rgba values ARE allowed here */
  --jp-bg: #000000;
  /* ... */
}

/* Component rules — NO hardcoded hex/rgba outside token definitions */
.some-component {
  background: var(--jp-surface);
  color: var(--jp-text);
}
```

[VERIFIED: frontend/src/styles/main.css lines 1-95]

### KC Email Template Architecture

Keycloak 26.6.1 email templates follow a two-layer delegation pattern [VERIFIED: KC 26.6.1 GitHub source]:

```
email/html/template.ftl
  ↑ imported by
email/html/email-verification.ftl   → body = ${kcSanitize(msg("emailVerificationBodyHtml", ...))?no_esc}
email/html/executeActions.ftl       → body = ${kcSanitize(msg("executeActionsBodyHtml", ...))?no_esc}
email/html/password-reset.ftl       → body = ${kcSanitize(msg("passwordResetBodyHtml", ...))?no_esc}
email/html/email-verification-with-code.ftl → body = ${kcSanitize(msg("emailVerificationBodyCodeHtml", code))?no_esc}
```

**Critical:** The `.ftl` files do NOT contain the email body text. Body HTML is in message property files. To brand email bodies with inline styles, you MUST override both:
1. `email/html/template.ftl` — provides the card/header/footer chrome with inline styles
2. `email/messages/messages_es.properties` + `messages_en.properties` — provides the inline-styled paragraph/link HTML for each body key

[VERIFIED: KC 26.6.1 repo — raw.githubusercontent.com/keycloak/keycloak/26.6.1/themes/.../email/html/email-verification.ftl]

### KC Email Theme Directory Structure

```
keycloak/themes/japan-trip/email/         ← CREATE THIS DIRECTORY
├── theme.properties                      ← parent=keycloak
├── html/
│   ├── template.ftl                      ← override with branded card layout
│   ├── email-verification.ftl            ← minimal, delegates to msg()
│   ├── email-verification-with-code.ftl  ← OTP code email
│   ├── password-reset.ftl                ← password reset
│   └── executeActions.ftl                ← admin-triggered actions
├── text/
│   ├── email-verification.ftl            ← plain text fallback
│   ├── email-verification-with-code.ftl
│   ├── password-reset.ftl
│   └── executeActions.ftl
└── messages/
    ├── messages_es.properties            ← defaultLocale — override body HTML keys
    └── messages_en.properties            ← English override
```

Full list of base templates in KC 26.6.1 `html/`: `email-test.ftl`, `email-update-confirmation.ftl`, `email-verification-with-code.ftl`, `email-verification.ftl`, `event-*.ftl` (8 files), `executeActions.ftl`, `identity-provider-link.ftl`, `org-invite.ftl`, `password-reset.ftl`, `template.ftl`, `workflow-notification.ftl` [VERIFIED: KC 26.6.1 GitHub source].

For D-07 scope (OTP verification + email confirmation + password reset), only the 4 templates listed above need overriding. Others inherit from base KC theme via `parent=keycloak`.

### KC Base Email template.ftl (what we override)

```ftl
<#macro emailLayout>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<body>
<#nested>
</body>
</html>
</#macro>
```

[VERIFIED: raw.githubusercontent.com/keycloak/keycloak/26.6.1/themes/src/main/resources/theme/base/email/html/template.ftl]

Our override wraps `<#nested>` in the branded card layout with inline styles.

### Anti-FOUC Pattern (existing — do not replace)

All 13 HTML files already contain this pattern [VERIFIED: grep on all frontend/*.html]:

```html
<!-- Critical CSS to prevent FOUC -->
<style>
  html { background: #f5f5f7; }
  html[data-theme="dark"] { background: #000; }
  body { opacity: 0; transition: opacity 0.15s ease; }
  body.ready { opacity: 1; }
</style>
<script>
  (function() {
    var theme = localStorage.getItem('theme');
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
</script>
```

This is a **superset** of D-04's spec (also handles `prefers-color-scheme` on first visit). See §DESIGN-04 Mismatch below.

---

## Complete Hardcoded Color Audit (DESIGN-01)

### Token definitions (ALLOWED — out of scope for DESIGN-01)
`:root { }`, `[data-theme="dark"] { }`, and `@media (prefers-contrast: high) { :root { } }` blocks contain hex/rgba values legitimately. These must not be flagged by validation.

### Residual hardcoded values in COMPONENT rules

The D-03 decision lists 4 new tokens. The actual file has more uncovered uses:

| Line | Selector | Value | Proposed Resolution |
|------|----------|-------|---------------------|
| 155 | `.city-marker` `color` | `#fff` | → `var(--jp-white)` |
| 320 | `.btn-primary` `color` | `#fff` | → `var(--jp-white)` |
| 347 | `.btn-danger:hover` `color` | `#fff` | → `var(--jp-white)` |
| 473 | `.overlay` `background` | `rgba(0,0,0,0.5)` | → new token `--jp-overlay: rgba(0,0,0,0.5)` |
| 629 | `.top-nav a.is-active` `border-color` | `rgba(0,113,227,0.2)` | → new token `--jp-accent-border: rgba(0,113,227,0.2)` |
| 800 | `.day-btn.active` `color` | `#fff` | → `var(--jp-white)` |
| 811 | `.day-btn.has-options:hover` `background` | `rgba(175,82,222,0.1)` | → `var(--jp-optional-subtle)` (D-03) |
| 817 | `.day-btn.has-options.active` `color` | `#fff` | → `var(--jp-white)` |
| 857 | `.day-group-badge` `color` | `#fff` | → `var(--jp-white)` |
| 928 | `.legend-item.is-optional` | `rgba(175,82,222,0.05)` | → new token `--jp-optional-bg: rgba(175,82,222,0.05)` (distinct from D-03's 0.1) |
| 960 | `.legend-item.is-optional` `background` | `rgba(175,82,222,0.05)` | → `var(--jp-optional-bg)` |
| 983 | `.legend-marker` `color` | `#fff` | → `var(--jp-white)` |
| 1030 | `.legend-action-btn:hover` `color` | `#fff` | → `var(--jp-white)` |
| 1041 | `.legend-action-btn.directions:hover` `color` | `#fff` | → `var(--jp-white)` |
| 1054 | `.hotel-info` `background` | `rgba(255,149,0,0.08)` | → `var(--jp-hotel-subtle)` (D-03) |
| 1055 | `.hotel-info` `border` | `rgba(255,149,0,0.2)` | → `var(--jp-hotel-border)` (D-03) |
| 1075 | `.hotel-info .marker` `color` | `#fff` | → `var(--jp-white)` |
| 1339 | `.calendar-btn:hover` `color` | `#fff` | → `var(--jp-white)` |
| 1428 | `.leaflet-popup-content .optional-badge` `color` | `#fff` | → `var(--jp-white)` |
| 1459 | `.popup-link:hover` `color` | `#fff` | → `var(--jp-white)` |
| 1469 | `.popup-link.directions:hover` `color` | `#fff` | → `var(--jp-white)` |
| 1501 | `.numbered-marker` `color` | `#fff` | → `var(--jp-white)` |
| 1507 | `.numbered-marker.optional` `border` | `rgba(255,255,255,0.6)` | → new token `--jp-marker-dash: rgba(255,255,255,0.6)` |
| 1517 | `.hotel-marker` `color` | `#fff` | → `var(--jp-white)` |
| 1577 | `.route-number` `color` | `#fff` | → `var(--jp-white)` |
| 1861 | `.skip-link` `color: white` | keyword `white` | → `var(--jp-white)` |
| 1829 | `@media print .page-card` `border: 1px solid #ddd` | `#ddd` | PRINT STYLE — acceptable to leave as-is (print CSS, not runtime theme) |
| 1917 | `@media print .page-card` `border: 1px solid #000` | `#000` | PRINT STYLE — acceptable to leave as-is |
| 1874 | `@media (prefers-contrast: high) :root` `--border-color: #000` | `#000` | TOKEN DEFINITION in override block — allowed per DESIGN-01 |
| 1875 | `@media (prefers-contrast: high) :root` `--text-secondary: #333` | `#333` | TOKEN DEFINITION — allowed |
| 1878 | `@media (prefers-contrast: high) [data-theme="dark"]` `--border-color: #fff` | `#fff` | TOKEN DEFINITION — allowed |
| 1879 | `@media (prefers-contrast: high) [data-theme="dark"]` `--text-secondary: #ccc` | `#ccc` | TOKEN DEFINITION — allowed |
| 1904 | `.widget-error` `color: #ff3b30` | `#ff3b30` | → `var(--jp-danger)` (token already defined) |
| 1908 | `[data-theme="dark"] .widget-error` `color: #ff6961` | `#ff6961` | → `var(--jp-danger)` (dark token already defined) |

**Extended D-03 token set required:**

| Token | Value | Usage |
|-------|-------|-------|
| `--jp-hotel-subtle` | `rgba(255,149,0,0.08)` | `.hotel-info` background (D-03 original) |
| `--jp-hotel-border` | `rgba(255,149,0,0.2)` | `.hotel-info` border (D-03 original) |
| `--jp-optional-subtle` | `rgba(175,82,222,0.1)` | `.day-btn.has-options:hover` (D-03 original) |
| `--jp-white` | `#fff` | foreground-on-color in buttons/markers (D-03 original) |
| `--jp-overlay` | `rgba(0,0,0,0.5)` | `.overlay` modal scrim (NEW) |
| `--jp-accent-border` | `rgba(0,113,227,0.2)` | `.top-nav a.is-active` border (NEW) |
| `--jp-optional-bg` | `rgba(175,82,222,0.05)` | `.legend-item.is-optional` subtle bg (NEW — distinct from subtle 0.1) |
| `--jp-marker-dash` | `rgba(255,255,255,0.6)` | `.numbered-marker.optional` dashed border (NEW) |

### account.css hardcoded values (DESIGN-01 scope)

[VERIFIED: keycloak/themes/japan-trip/account/resources/css/account.css]

`account.css` already uses `--jp-*` tokens for most rules. Residual hardcoded values:
- L54: `rgba(0, 113, 227, 0.08)` in nav active state → `var(--jp-accent-subtle)` (if token exists) or new `--jp-accent-subtle`
- L67: `#ffffff` in `.pf-v5-c-button.pf-m-primary` color → `var(--jp-white)`
- L68 (dark variant): implicit through PatternFly override structure

These are inside the CSS, not in token definitions, so they count under DESIGN-01.

---

## DESIGN-02 Status: Already Satisfied

[VERIFIED: keycloak/themes/japan-trip/login/login.css]

Current `login.css` already:
- Removes KC logo via `display: none !important` on `#kc-logo`, `.kc-logo-text`, `#kc-header` (lines 276–283)
- Uses `'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif` font
- Sets `border-radius: 0 !important` on all form elements and cards
- Matches color palette (`#0071e3`, `#1d1d1f`, `#f5f5f7`)
- Already tested by `tests/e2e/idp-theme.spec.ts` which asserts border-radius 0px and Inter font

**Net new work for DESIGN-02: none.** The existing `idp-theme.spec.ts` test already validates these requirements.

---

## DESIGN-04 Mismatch: Anti-FOUC Already Exists

[VERIFIED: grep on all 13 frontend/*.html files — all return 1 localStorage reference each]

All 13 HTML files (`index.html`, `tokyo.html`, `nagoya.html`, `takayama.html`, `kyoto.html`, `osaka.html`, `naoshima.html`, `hakone.html`, `tokyo2.html`, `dashboard.html`, `trip.html`, `trip-edit.html`, `profile.html`) already have the anti-FOUC inline script.

The existing script differs from D-04's spec in one way: it also applies `data-theme=dark` based on `prefers-color-scheme` when there's no localStorage value. D-04 says: "if no localStorage value, do not set the attribute." This is a **behavioral difference** — the existing script is more complete (matches `initTheme()` behavior).

**Recommendation:** Keep the existing script as-is. It is a functional superset of D-04's spec. D-04's "no fallback" behavior would be a regression. Planner should note D-04 as already satisfied.

The inline `<style>` blocks contain `#f5f5f7` and `#000` hardcoded. These are **not subject to DESIGN-01** — CSS custom properties are not loaded at the time this inline style runs. These hardcoded values are structurally required and should be excluded from validation.

---

## TypeScript Files Requiring Token Rename

**D-01 scope extends to `.ts` files.** These files reference old token names via `var(--old-name, fallback)` in inline CSS strings. After renaming in main.css, these fall through to the hardcoded fallback value silently — no error, no visual breakage in light mode, but the dark-mode override never applies.

[VERIFIED: rg search on frontend/src/ *.ts files]

| File | Old tokens referenced |
|------|----------------------|
| `frontend/src/components/Navbar.ts` | `--bg-secondary`, `--border-color`, `--text-primary`, `--accent`, `--accent-subtle`, `--accent-hover`, `--font-sans` |
| `frontend/src/components/SearchBar.ts` | `--bg-glass-subtle`, `--border-color`, `--bg-secondary`, `--accent` |
| `frontend/src/auth/AuthGuard.ts` | `--font-sans`, `--border-color`, `--accent` |
| `frontend/src/pages/tripDetail.ts` | `--accent` |
| `frontend/src/pages/trip-edit/activities.ts` | `--border-color` |
| `frontend/src/pages/trip-edit/days.ts` | `--text-primary`, `--border-color` |
| `frontend/src/modules/map.ts` | `--accent` |

The fallback hex values in these `.ts` files are not "in CSS files" per the literal wording of DESIGN-01 and are unlikely to need changing per DESIGN-01. However, they must be updated to use `--jp-*` names so the tokens resolve correctly — otherwise dark-mode overrides never apply to these components.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| CSS token completeness check | Custom build script | `rg` grep with regex excluding token-definition blocks (see §Validation Architecture) |
| Email HTML rendering | Custom test server | Mailpit at `localhost:8025` (already in docker-compose) |
| KC theme structure | Guess file names | Verified list from KC 26.6.1 source (see §Email Template Architecture) |

---

## Common Pitfalls

### Pitfall 1: Tokenizing print and inline-style-block values
**What goes wrong:** Grep for `#` in main.css flags `#ddd`, `#000` in `@media print` rules and `#f5f5f7` in the inline `<style>` blocks inside HTML `<head>`.
**Why it happens:** Naive "no hex outside `:root`" rule doesn't account for print styles and pre-CSS inline style blocks.
**How to avoid:** Explicitly exclude `@media print` and the HTML `<style>` inline blocks from DESIGN-01 scope. Document that print styles intentionally use neutral hex.

### Pitfall 2: email bodies are in message properties, not .ftl files
**What goes wrong:** Overriding only `template.ftl` without overriding message properties produces a branded card wrapper around un-styled plain-text-like paragraphs.
**Why it happens:** KC 26.6.1 `.ftl` files call `msg("emailVerificationBodyHtml", ...)` — the HTML with `<p>`, `<a>` tags is in the `.properties` files, not in the template.
**How to avoid:** Override both `template.ftl` (card chrome) AND create `email/messages/messages_es.properties` + `messages_en.properties` with inline-styled body keys.

### Pitfall 3: Token rename in main.css without updating TS component inline styles
**What goes wrong:** `var(--bg-secondary, #fff)` in Navbar.ts silently falls through to `#fff` fallback after rename. No compile error. Light mode looks fine; dark mode broken for those components.
**Why it happens:** TypeScript doesn't parse CSS-in-string literals.
**Warning signs:** Dark mode renders correctly on city pages (uses main.css) but incorrectly in the navbar/search bar (uses TS inline styles).

### Pitfall 4: Forgetting `--jp-optional-bg` vs `--jp-optional-subtle` distinct alpha
**What goes wrong:** Creating only one "optional" token at `rgba(175,82,222,0.1)` and using it for both `.day-btn.has-options:hover` (0.1) and `.legend-item.is-optional` (0.05) changes the visual appearance of legend items.
**Why it happens:** D-03 originally listed only `--jp-optional-subtle` at 0.1 without auditing all usages.
**How to avoid:** Use two tokens: `--jp-optional-subtle: rgba(175,82,222,0.1)` for button hover, `--jp-optional-bg: rgba(175,82,222,0.05)` for legend item background.

### Pitfall 5: KC email theme.properties parent value
**What goes wrong:** Setting `parent=base` causes missing messages (KC default message keys live in parent theme). Setting `parent=keycloak` inherits all KC default messages and templates; any un-overridden template falls through to the base theme's implementation.
**How to avoid:** Use `parent=keycloak` in `email/theme.properties`.

---

## Code Examples

### D-01 token rename (search pattern)

```bash
# Find all usages of old tokens in CSS (for verify step)
rg "var\(--(?!jp-)" "C:/path/to/frontend/src/styles/main.css"
```

```bash
# Find usages in TS files
rg "var\(--(?!jp-)" "C:/path/to/frontend/src/" --type ts
```

### KC email template.ftl override structure

```ftl
<#macro emailLayout>
<html lang="${locale.language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Inter,-apple-system,'Helvetica Neue',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <!-- Header -->
        <tr><td style="padding-bottom:8px;">
          <span style="font-size:18px;font-weight:600;color:#1d1d1f;letter-spacing:-0.01em;">TravelMap</span>
        </td></tr>
        <tr><td style="border-top:1px solid #d0d0d5;padding-bottom:24px;"></td></tr>
        <!-- Card -->
        <tr><td style="background:#ffffff;border:1px solid rgba(0,0,0,0.1);border-radius:0;padding:32px;">
          <#nested>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding-top:24px;font-size:12px;color:#86868b;text-align:center;">
          TravelMap — this is an automated message
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
</#macro>
```

[ASSUMED — structure follows D-07 spec; exact padding/spacing at Claude's discretion per CONTEXT.md]

### email/messages/messages_es.properties body key override (example)

```properties
emailVerificationBodyHtml=<p style="margin:0 0 16px;font-size:15px;color:#1d1d1f;line-height:1.6;">Alguien ha creado una cuenta en {2} con esta dirección de email. Si eras tú, haz clic en el enlace siguiente para verificar tu dirección:</p><p style="margin:0 0 16px;"><a href="{0}" style="color:#0071e3;font-weight:500;">Verificar email</a></p><p style="margin:0;font-size:13px;color:#86868b;">Este enlace expirará en {3}. Si no creaste esta cuenta, ignora este mensaje.</p>
passwordResetBodyHtml=<p style="margin:0 0 16px;font-size:15px;color:#1d1d1f;line-height:1.6;">Alguien solicitó restablecer las credenciales de tu cuenta {2}. Haz clic en el enlace siguiente:</p><p style="margin:0 0 16px;"><a href="{0}" style="color:#0071e3;font-weight:500;">Restablecer contraseña</a></p><p style="margin:0;font-size:13px;color:#86868b;">Este enlace expirará en {3}.</p>
emailVerificationBodyCodeHtml=<p style="margin:0 0 16px;font-size:15px;color:#1d1d1f;line-height:1.6;">Introduce el siguiente código para verificar tu dirección de email:</p><p style="margin:0 0 16px;font-size:32px;font-weight:700;color:#1d1d1f;letter-spacing:0.05em;">{0}</p>
executeActionsBodyHtml=<p style="margin:0 0 16px;font-size:15px;color:#1d1d1f;line-height:1.6;">Tu administrador ha solicitado que actualices tu cuenta {2}. Haz clic en el enlace siguiente:</p><p style="margin:0 0 16px;"><a href="{0}" style="color:#0071e3;font-weight:500;">Actualizar cuenta</a></p><p style="margin:0;font-size:13px;color:#86868b;">Este enlace expirará en {3}.</p>
```

[ASSUMED — exact Spanish strings; planner should verify against KC base messages_es.properties for accurate copy]

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Generic token names (`--bg-primary`, `--accent`) | Namespaced tokens (`--jp-bg`, `--jp-accent`) | Avoids collisions in Shadow DOM Web Components |
| Table-based HTML emails | Still table-based (email clients require tables for layout) | No change; tables remain correct approach for email |
| KC login branding via global CSS selectors | KC login branding via `!important` PatternFly overrides | Already implemented in login.css |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | KC `parent=keycloak` in email theme.properties inherits all KC default templates | Email Architecture | Wrong parent breaks all untemplated email flows |
| A2 | `email/messages/messages_es.properties` overrides the base `emailVerificationBodyHtml` etc. message keys | Email Architecture | If KC uses different key resolution order, body override may not apply |
| A3 | DESIGN-02 is fully satisfied by existing login.css | DESIGN-02 Status | If KC 26.6.1 introduced new PatternFly classes not covered by current selectors, some elements might render unstyled |
| A4 | Print media `#ddd`/`#000` are out of scope for DESIGN-01 | Hardcoded Audit | If DESIGN-01 is interpreted strictly, these 2 values would need tokens |
| A5 | Exact Spanish translations in email body key overrides | Code Examples | Wrong text — planner should verify against KC base Spanish bundle |

---

## Open Questions

1. **Should D-04 replace the existing anti-FOUC script or leave it?**
   - What we know: existing script is a functional superset (also handles `prefers-color-scheme`)
   - What's unclear: D-04 spec says "if no localStorage value, do not set attribute" — contradicts existing behavior
   - Recommendation: keep existing script; mark D-04 satisfied. If user intended the exact D-04 spec behavior, they lose system-preference detection on first visit.

2. **Does `--jp-white` become a token or stay as literal `#fff`?**
   - What we know: used 15+ times as foreground-on-color (always white-on-accent/colored, never as a background that themes)
   - Recommendation: add `--jp-white: #fff` as Claude's discretion permits, so all uses are via token

3. **How many email body message keys need overriding?**
   - What we know: DESIGN-03 says "OTP verification, email confirmation" — maps to `emailVerificationBodyCodeHtml` and `emailVerificationBodyHtml`
   - Recommendation: also override `passwordResetBodyHtml` and `executeActionsBodyHtml` for completeness; `event-*` emails are low-priority and can inherit from base

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `npm run build`, `npm run typecheck` | checked below | — | — |
| Keycloak | Email template testing | Docker | 26.6.1 | — |
| Mailpit | Email rendering verification | Docker (docker-compose.yml line 46) | v1.29 | Manual KC mailbox |
| Vitest | Unit test run | existing (package.json) | existing | — |
| Playwright | E2E spec run | existing (tests/) | existing | — |

```bash
# Mailpit UI: http://localhost:8025 (when docker-compose up)
# KC port: localhost:8080
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Unit framework | Vitest |
| E2E framework | Playwright |
| Quick run command | `cd frontend && npm run typecheck && npm run test:run` |
| Full suite command | `cd tests && npx playwright test --project=chromium` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DESIGN-01 | No hardcoded hex in component rules | Static analysis (rg) | See verification commands below | — (not a spec) |
| DESIGN-02 | KC login: Inter font, radius 0, no logo | E2E | `npx playwright test tests/e2e/idp-theme.spec.ts --project=chromium` | Yes |
| DESIGN-03 | KC emails render branded card | Manual (Mailpit UI) | KC → trigger email → check localhost:8025 | Manual only |
| DESIGN-04 | Theme persists across MPA navigation | E2E (ui-consistency.spec.ts) | `npx playwright test tests/e2e/ui-consistency.spec.ts` | Yes |
| Regression | Passkey flows unaffected | E2E | `cd tests && npx playwright test tests/e2e/passkeys.spec.ts --project=chromium-passkeys` | Yes |

### Verification Commands (DESIGN-01)

```bash
# 1. Verify no old token names remain in main.css
rg "var\(--(?!jp-)" "frontend/src/styles/main.css"
# Expected: 0 matches (token definitions use --jp-*; only legacy var() usages are invalid)

# 2. Verify no old token names remain in TS component files
rg "var\(--(?!jp-)" "frontend/src/" --type ts
# Expected: 0 matches

# 3. Verify no hardcoded hex/rgba remain in component rules (outside token definition blocks)
# This requires manual review — a line-number-based approach:
# Lines 1–95: token definitions (allowed)
# Lines 96–end: must use var(--jp-*)
# Exception: @media print blocks (L1811-1831, L1911-1919) and prefers-contrast block (L1872-1881)
# Practical approach: run rg and manually verify each hit falls in an allowed block
rg "#[0-9a-fA-F]{3,8}\b|rgba?\(" "frontend/src/styles/main.css" -n | grep -v "url(\|@import"

# 4. Verify all 9 map HTML files have anti-FOUC script (already present — verify not removed)
for f in index tokyo nagoya takayama kyoto osaka naoshima hakone tokyo2; do
  count=$(grep -c "localStorage.getItem" "frontend/$f.html")
  echo "$f.html: $count"
done

# 5. Build succeeds (catches TS errors from token rename in .ts files)
cd frontend && npm run typecheck && npm run build

# 6. Full unit test suite green
cd frontend && npm run test:run

# 7. idp-theme.spec.ts confirms DESIGN-02 unchanged
cd tests && npx playwright test e2e/idp-theme.spec.ts --project=chromium

# 8. passkeys.spec.ts confirms no KC regression
cd tests && SKIP_REAL_AUTH=0 npx playwright test e2e/passkeys.spec.ts --project=chromium-passkeys
# (KC must be running — use docker-compose up first)
```

### Sampling Rate
- **Per task commit:** `cd frontend && npm run typecheck && npm run test:run`
- **Per wave merge:** Full rg audit + Playwright idp-theme.spec.ts
- **Phase gate:** All verification commands above green before `/gsd-verify-work`

### Wave 0 Gaps
- None for unit tests — existing Vitest suite covers module behavior; token rename is CSS-only and not unit-testable
- No new Playwright spec needed — existing `idp-theme.spec.ts` and `ui-consistency.spec.ts` cover DESIGN-02 and DESIGN-04
- Email template validation is **manual-only** (Mailpit UI) — no automated spec; D-07 acceptance requires human visual review

---

## Security Domain

> security_enforcement: not explicitly false in config — included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 10 is CSS/template only |
| V3 Session Management | No | No session logic changed |
| V4 Access Control | No | No access control changes |
| V5 Input Validation | Partial | KC email template uses `kcSanitize()` — do not bypass |
| V6 Cryptography | No | No crypto changes |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via email body override | Tampering | Keep `kcSanitize()` wrapper in all `.ftl` body calls; inline styles in message properties are HTML-only, never script |
| Style injection via CSS token names | Tampering | Token names are compile-time constants; no user input flows into CSS property names |

---

## Sources

### Primary (HIGH confidence)
- `frontend/src/styles/main.css` — full token audit, line-by-line [VERIFIED]
- `keycloak/themes/japan-trip/login/resources/css/login.css` — DESIGN-02 status [VERIFIED]
- `keycloak/themes/japan-trip/login/theme.properties` — KC login theme structure [VERIFIED]
- `keycloak/themes/japan-trip/account/resources/css/account.css` — DESIGN-01 scope [VERIFIED]
- `keycloak/docker-compose.yml` — KC version 26.6.1 confirmed [VERIFIED]
- `frontend/src/modules/theme.ts` — THEME_KEY='theme', no CSS token refs [VERIFIED]
- All 13 `frontend/*.html` files — anti-FOUC script presence [VERIFIED]
- KC 26.6.1 GitHub source: `themes/src/main/resources/theme/base/email/html/` [VERIFIED: WebFetch]
- KC 26.6.1 `template.ftl` raw content [VERIFIED: raw.githubusercontent.com]
- KC 26.6.1 email message keys (`emailVerificationBodyHtml` etc.) [VERIFIED: WebFetch raw messages]

### Secondary (MEDIUM confidence)
- `tests/e2e/idp-theme.spec.ts` — existing DESIGN-02 test assertions [VERIFIED]
- `tests/e2e/passkeys.spec.ts` — frozen spec, `chromium-passkeys` project [VERIFIED]
- `frontend/src/components/Navbar.ts`, `SearchBar.ts`, `AuthGuard.ts`, `map.ts`, `tripDetail.ts`, `trip-edit/activities.ts`, `trip-edit/days.ts` — old token names in inline CSS [VERIFIED]

### Tertiary (LOW confidence)
- A5: Spanish translations in email body keys — not verified against KC base Spanish bundle

---

## Metadata

**Confidence breakdown:**
- Token audit: HIGH — line-by-line grep of actual file
- DESIGN-02 status: HIGH — confirmed via login.css and idp-theme spec
- DESIGN-04 status: HIGH — confirmed via grep on all HTML files
- KC email architecture: HIGH — verified from KC 26.6.1 raw source
- Email translations: LOW — assumed content, not verified against base
- Extended D-03 token additions: MEDIUM — values verified from main.css, token names are design decisions

**Research date:** 2026-05-29
**Valid until:** 2026-06-29 (stable domain; KC version pinned at 26.6.1)
