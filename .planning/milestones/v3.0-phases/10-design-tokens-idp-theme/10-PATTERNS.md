# Phase 10: Design Tokens + IDP Theme — Pattern Map

**Mapped:** 2026-05-29
**Files analyzed:** 22 (10 modified, 12 created)
**Analogs found:** 22 / 22 (some from in-repo, some from KC 26.6.1 base — labeled below)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `frontend/src/styles/main.css` | config (design tokens) | transform | self (in-place rename) | exact |
| `frontend/src/components/Navbar.ts` | component (Web Component) | request-response | self (in-place rename) | exact |
| `frontend/src/components/SearchBar.ts` | component (Web Component) | request-response | `Navbar.ts` inline CSS style | exact |
| `frontend/src/auth/AuthGuard.ts` | component (Web Component) | request-response | `Navbar.ts` inline CSS style | exact |
| `frontend/src/pages/tripDetail.ts` | component (page) | request-response | `activities.ts` `style.*` pattern | role-match |
| `frontend/src/pages/trip-edit/activities.ts` | component (page module) | request-response | self (in-place rename) | exact |
| `frontend/src/pages/trip-edit/days.ts` | component (page module) | request-response | `activities.ts` | exact |
| `frontend/src/modules/map.ts` | utility (Leaflet) | event-driven | `tripDetail.ts` inline style | role-match |
| `keycloak/themes/japan-trip/login/resources/css/login.css` | config (KC CSS) | transform | self (in-place fix + append) | exact |
| `keycloak/themes/japan-trip/account/resources/css/account.css` | config (KC CSS) | transform | `login.css` | role-match |
| `keycloak/themes/japan-trip/email/theme.properties` | config (KC theme) | — | `login/theme.properties` (in-repo) | exact |
| `keycloak/themes/japan-trip/email/html/template.ftl` | template (FreeMarker) | transform | KC 26.6.1 base `template.ftl` (external) | exact |
| `keycloak/themes/japan-trip/email/html/email-verification.ftl` | template (FreeMarker) | transform | `login/login.ftl` (in-repo) | role-match |
| `keycloak/themes/japan-trip/email/html/email-verification-with-code.ftl` | template (FreeMarker) | transform | `login/login-otp.ftl` (in-repo) | role-match |
| `keycloak/themes/japan-trip/email/html/password-reset.ftl` | template (FreeMarker) | transform | `login/login.ftl` pattern | role-match |
| `keycloak/themes/japan-trip/email/html/executeActions.ftl` | template (FreeMarker) | transform | `login/login.ftl` pattern | role-match |
| `keycloak/themes/japan-trip/email/text/email-verification.ftl` | template (FreeMarker) | transform | KC 26.6.1 base text FTL (external) | role-match |
| `keycloak/themes/japan-trip/email/text/email-verification-with-code.ftl` | template (FreeMarker) | transform | KC 26.6.1 base text FTL (external) | role-match |
| `keycloak/themes/japan-trip/email/text/password-reset.ftl` | template (FreeMarker) | transform | KC 26.6.1 base text FTL (external) | role-match |
| `keycloak/themes/japan-trip/email/text/executeActions.ftl` | template (FreeMarker) | transform | KC 26.6.1 base text FTL (external) | role-match |
| `keycloak/themes/japan-trip/email/messages/messages_es.properties` | config (KC i18n) | — | `login/messages/messages_es.properties` (in-repo) | exact |
| `keycloak/themes/japan-trip/email/messages/messages_en.properties` | config (KC i18n) | — | `login/messages/messages_es.properties` (in-repo) | role-match |

---

## Pattern Assignments

### `frontend/src/styles/main.css` (config, transform)

**Analog:** self — in-place rename

**Current token definition block** (lines 7–66, light mode):
```css
:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  --bg-primary: #f5f5f7;
  --bg-secondary: #ffffff;
  --bg-glass: #ffffff;
  --bg-glass-strong: #ffffff;
  --bg-glass-subtle: #ffffff;
  --border-color: rgba(0, 0, 0, 0.06);
  --border-strong: rgba(0, 0, 0, 0.1);
  --border-glass: rgba(255, 255, 255, 0.7);
  --text-primary: #1d1d1f;
  --text-secondary: #515154;
  --text-tertiary: #86868b;
  --accent: #0071e3;
  --accent-hover: #0077ed;
  --accent-subtle: rgba(0, 113, 227, 0.08);
  --success: #34c759;
  --success-subtle: rgba(52, 199, 89, 0.1);
  --danger: #ff3b30;
  --danger-hover: #d70015;
  --danger-subtle: rgba(255, 59, 48, 0.08);
  --shadow-sm: none;
  --shadow-md: none;
  --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.12);
  --shadow-glass: none;
  --shadow-glass-hover: none;
  --radius: 0;
  --blur: 0;
  --blur-strong: 0;
  --gradient-glass: var(--bg-secondary);
  --gradient-shine: transparent;
  --hotel: #ff9500;
  --optional: #af52de;
  --directions: #34c759;
  --marker-1: #ff3b30;
  /* ... --marker-2 through --marker-8 ... */
}
```

**Current dark-mode override block** (lines 68–95):
```css
[data-theme="dark"] {
  --bg-primary: #000000;
  --bg-secondary: #1c1c1e;
  --bg-glass: #1c1c1e;
  --bg-glass-strong: #2c2c2e;
  --bg-glass-subtle: #1c1c1e;
  --border-color: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.12);
  --border-glass: rgba(255, 255, 255, 0.1);
  --text-primary: #f5f5f7;
  --text-secondary: #a1a1a6;
  --text-tertiary: #6e6e73;
  --accent: #0a84ff;
  --accent-hover: #409cff;
  --accent-subtle: rgba(10, 132, 255, 0.15);
  /* ... danger, success, shadow overrides ... */
  --gradient-glass: var(--bg-secondary);
  --gradient-shine: transparent;
}
```

**D-01 rename mapping** (apply in both `:root` and `[data-theme="dark"]` blocks):
```
--font-sans           → --jp-font
--bg-primary          → --jp-bg
--bg-secondary        → --jp-surface
--bg-glass            → --jp-surface        (collapse with --bg-secondary)
--bg-glass-strong     → --jp-surface-raised
--bg-glass-subtle     → --jp-surface-subtle
--border-color        → --jp-border
--border-strong       → --jp-border-strong
--border-glass        → --jp-border-glass
--text-primary        → --jp-text
--text-secondary      → --jp-text-secondary
--text-tertiary       → --jp-text-tertiary
--accent              → --jp-accent
--accent-hover        → --jp-accent-hover
--accent-subtle       → --jp-accent-subtle
--success             → --jp-success
--success-subtle      → --jp-success-subtle
--danger              → --jp-danger
--danger-hover        → --jp-danger-hover
--danger-subtle       → --jp-danger-subtle
--shadow-sm           → --jp-shadow-sm
--shadow-md           → --jp-shadow-md
--shadow-lg           → --jp-shadow-lg
--shadow-glass        → --jp-shadow-glass
--shadow-glass-hover  → --jp-shadow-glass-hover
--radius              → --jp-radius
--blur                → --jp-blur
--blur-strong         → --jp-blur-strong
--gradient-glass      → --jp-gradient-glass
--gradient-shine      → --jp-gradient-shine
--hotel               → --jp-hotel
--optional            → --jp-optional
--directions          → --jp-directions
--marker-1..8         → --jp-marker-1..8
```

**D-03 new tokens to append to `:root`** (no dark-mode override specified in CONTEXT — planner decides whether to add dark variants):
```css
--jp-hotel-subtle: rgba(255, 149, 0, 0.08);
--jp-hotel-border: rgba(255, 149, 0, 0.2);
--jp-optional-subtle: rgba(175, 82, 222, 0.1);
--jp-optional-bg: rgba(175, 82, 222, 0.05);
--jp-white: #fff;
--jp-overlay: rgba(0, 0, 0, 0.5);
--jp-accent-border: rgba(0, 113, 227, 0.2);
--jp-marker-dash: rgba(255, 255, 255, 0.6);
```

---

### `frontend/src/components/Navbar.ts` (component, request-response)

**Analog:** self — in-place rename

**Current inline CSS pattern** — Shadow DOM `<style>` block inside `render()` (lines 92–295). Representative rules showing token usage style:
```typescript
// lines 98-104: nav background + border
nav {
  background: var(--bg-secondary, #fff);
  border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));
}

// lines 118-119: brand text color
color: var(--text-primary, #1d1d1f);

// lines 130-131: hover with accent tokens
color: var(--accent, #0071e3);
background: var(--accent-subtle, rgba(0, 113, 227, 0.08));

// lines 239-240: login button (note: literal #fff for text — kept as-is per D-01 or → var(--jp-white))
background: var(--accent, #0071e3);
color: #fff;
```

**Rename pattern** — every `var(--old-name, fallback)` becomes `var(--jp-new-name, fallback)`. The fallback values stay unchanged. Complete rename list for Navbar.ts:
```
var(--bg-secondary, ...)      → var(--jp-surface, ...)
var(--border-color, ...)      → var(--jp-border, ...)
var(--text-primary, ...)      → var(--jp-text, ...)
var(--text-secondary, ...)    → var(--jp-text-secondary, ...)
var(--text-tertiary, ...)     → var(--jp-text-tertiary, ...)
var(--accent, ...)            → var(--jp-accent, ...)
var(--accent-subtle, ...)     → var(--jp-accent-subtle, ...)
var(--accent-hover, ...)      → var(--jp-accent-hover, ...)
var(--font-sans, ...)         → var(--jp-font, ...)
```

---

### `frontend/src/components/SearchBar.ts` (component, request-response)

**Analog:** `Navbar.ts` — same Web Component pattern, same Shadow DOM `<style>` inline block

**Current inline CSS pattern** — Shadow DOM `<style>` block inside `render()` (lines 33–317). Representative rules:
```typescript
// line 39: font-family token
font-family: var(--font-sans, 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif);

// lines 64-65: container background + border
background: var(--bg-secondary, #fff);
border: 1px solid var(--border-strong, #d1d1d6);

// line 110: clear button subtle background
background: var(--bg-glass-subtle, #f5f5f7);

// line 139: dropdown background
background: var(--bg-secondary, #fff);

// line 176-177: result hover
background: var(--bg-glass-subtle, #f5f5f7);

// line 190: focus outline
outline: 2px solid var(--accent, #0071e3);

// line 529: highlightMatch — inline style string (not in <style> block)
'<mark style="background:var(--accent);color:white;padding:0 2px;">'
```

**Rename list for SearchBar.ts:**
```
var(--font-sans, ...)        → var(--jp-font, ...)
var(--bg-secondary, ...)     → var(--jp-surface, ...)
var(--bg-glass-subtle, ...)  → var(--jp-surface-subtle, ...)
var(--border-strong, ...)    → var(--jp-border-strong, ...)
var(--border-color, ...)     → var(--jp-border, ...)
var(--text-primary, ...)     → var(--jp-text, ...)
var(--text-tertiary, ...)    → var(--jp-text-tertiary, ...)
var(--accent, ...)           → var(--jp-accent, ...)
var(--accent)                → var(--jp-accent)   ← line 529, no fallback
```

---

### `frontend/src/auth/AuthGuard.ts` (component, request-response)

**Analog:** `Navbar.ts` — same Web Component pattern. AuthGuard uses a module-level template string (`LOADING_TEMPLATE`, lines 19–54) plus an inline template in `_showError()` (lines 101–137).

**Current inline CSS pattern** — token usages in LOADING_TEMPLATE and _showError():
```typescript
// LOADING_TEMPLATE lines 27-28
font-family: var(--font-sans, 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif);
color: var(--text-secondary, #515154);

// line 32
background: var(--border-color, rgba(0,0,0,0.1));

// line 37
background: var(--accent, #0071e3);

// _showError() lines 111-112
font-family: var(--font-sans, 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif);
color: var(--danger, #ff3b30);

// lines 121-122
background: var(--danger, #ff3b30);
border: 1px solid var(--danger, #ff3b30);

// line 130
background: var(--danger-hover, #d70015);
```

**Rename list for AuthGuard.ts:**
```
var(--font-sans, ...)    → var(--jp-font, ...)
var(--text-secondary, .) → var(--jp-text-secondary, .)
var(--border-color, ...) → var(--jp-border, ...)
var(--accent, ...)       → var(--jp-accent, ...)
var(--danger, ...)       → var(--jp-danger, ...)
var(--danger-hover, ...) → var(--jp-danger-hover, ...)
```

Note: `color: white` literal at line 123 — planner decides whether → `var(--jp-white)` per D-03 extended scope.

---

### `frontend/src/pages/tripDetail.ts` (component, request-response)

**Analog:** `activities.ts` — same imperative `element.style.*` pattern (not a Shadow DOM `<style>` block)

**Current token usages** (imperative style assignments, grep-verified):
```typescript
// line 471
p.style.color = 'var(--text-secondary,#515154)';

// line 476
link.style.color = 'var(--accent,#0071e3)';
```

**Rename list for tripDetail.ts:**
```
var(--text-secondary,#515154)  → var(--jp-text-secondary,#515154)
var(--accent,#0071e3)          → var(--jp-accent,#0071e3)
```

Note: spacing inside `var()` is inconsistent in this file (no spaces after comma). Keep existing spacing style — just rename the token name.

---

### `frontend/src/pages/trip-edit/activities.ts` (component, request-response)

**Analog:** self — in-place rename

**Current token usages** (imperative `element.style.*`, grep-verified):
```typescript
// line 465
emptyP.style.color = 'var(--text-secondary, #515154)';

// line 485
row.style.borderBottom = '1px solid var(--border-color, rgba(0,0,0,0.1))';

// line 545
timeSpan.style.color = 'var(--text-secondary, #515154)';
```

**Rename list for activities.ts:**
```
var(--text-secondary, #515154)      → var(--jp-text-secondary, #515154)
var(--border-color, rgba(0,0,0,0.1)) → var(--jp-border, rgba(0,0,0,0.1))
```

---

### `frontend/src/pages/trip-edit/days.ts` (component, request-response)

**Analog:** `activities.ts` — identical imperative style pattern

**Current token usages** (imperative `element.style.*`, grep-verified):
```typescript
// line 127
swatch.style.borderColor = 'var(--text-primary, #1d1d1f)';

// line 203
s.style.borderColor = 'var(--text-primary, #1d1d1f)';

// line 426
emptyP.style.color = 'var(--text-secondary, #515154)';

// line 441
row.style.borderBottom = '1px solid var(--border-color, rgba(0,0,0,0.1))';

// line 451
colorDot.style.backgroundColor = 'var(--border-color, rgba(0,0,0,0.1))';

// line 474
dateEl.style.color = 'var(--text-secondary, #515154)';
```

**Rename list for days.ts:**
```
var(--text-primary, #1d1d1f)         → var(--jp-text, #1d1d1f)
var(--text-secondary, #515154)       → var(--jp-text-secondary, #515154)
var(--border-color, rgba(0,0,0,0.1)) → var(--jp-border, rgba(0,0,0,0.1))
```

---

### `frontend/src/modules/map.ts` (utility, event-driven)

**Analog:** `tripDetail.ts` — inline style string inside template literal

**Current token usage** (grep-verified line 394):
```typescript
const popupHtml = `<h4>${city.name}</h4><p>${city.dates}</p><p><a href="${city.link}" style="color:var(--accent);">View itinerary</a></p>`;
```

**Rename for map.ts:**
```
var(--accent)  → var(--jp-accent)
```

Note: no fallback value present in this usage — keep as-is (no fallback to add).

---

### `keycloak/themes/japan-trip/login/resources/css/login.css` (config, transform)

**Analog:** self — in-place fix + append to `:root`

**Current `:root` token block** (lines 8–24):
```css
:root {
  --jp-bg: #f5f5f7;
  --jp-surface: #ffffff;
  --jp-surface-dark: #1c1c1e;
  --jp-surface-raised-dark: #2c2c2e;
  --jp-text: #1d1d1f;
  --jp-text-dark: #f5f5f7;
  --jp-text-secondary: #515154;
  --jp-text-tertiary: #86868b;
  --jp-border: rgba(0, 0, 0, 0.1);
  --jp-border-strong: #d0d0d5;
  --jp-border-dark: rgba(255, 255, 255, 0.18);
  --jp-accent: #0071e3;
  --jp-accent-hover: #0077ed;
  --jp-danger: #d70015;
  --jp-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
}
```

**Residual hardcoded values to fix** (from RESEARCH hardcoded audit):
```
line 40:  #000000 in @media dark body background   → add --jp-bg-dark: #000000 to :root, use var(--jp-bg-dark)
line 58:  #ffffff in .card-pf background            → var(--jp-surface) (token already in :root at line 10)
line 171: #ffffff in .btn-primary color             → add --jp-white: #ffffff to :root, use var(--jp-white)
line 273: rgba(0,0,0,0.1) in hr, .login-pf-signup  → var(--jp-border) (token already in :root at line 17)
```

**Tokens to append to existing `:root` block:**
```css
--jp-bg-dark: #000000;
--jp-white: #ffffff;
```

---

### `keycloak/themes/japan-trip/account/resources/css/account.css` (config, transform)

**Analog:** `login.css` — same KC PatternFly override structure, same `--jp-*` token usage

**Current `:root` block** (lines 1–15) — already uses `--jp-*` tokens. No changes needed to token definitions.

**Residual hardcoded values in component rules** (from RESEARCH audit):
```
line 54: rgba(0, 113, 227, 0.08) in .pf-v5-c-nav__link active state → var(--jp-accent-subtle)
         NOTE: --jp-accent-subtle is not in account.css :root. Must either add it or use literal.
         Pattern from login.css: login.css also adds needed tokens to its own :root (D-02 — independent definitions)

line 67: #ffffff in .pf-v5-c-button.pf-m-primary color → var(--jp-white)
         Must add --jp-white: #ffffff to account.css :root (same as login.css pattern)
```

**Current usage at line 54 (full context):**
```css
.pf-v5-c-nav__link:hover,
.pf-v5-c-nav__link.pf-m-current,
.pf-v5-c-nav__link.pf-m-current::after {
  color: var(--jp-accent) !important;
  background: rgba(0, 113, 227, 0.08) !important;   /* ← fix this */
}
```

**Current usage at lines 64-67:**
```css
.pf-v5-c-button.pf-m-primary {
  background: var(--jp-accent) !important;
  border-color: var(--jp-accent) !important;
  color: #ffffff !important;   /* ← fix this */
}
```

---

### `keycloak/themes/japan-trip/email/theme.properties` (config, new)

**Analog:** `keycloak/themes/japan-trip/login/theme.properties` (in-repo, exact)

**Analog file content** (full):
```properties
parent=keycloak
import=common/keycloak

styles=css/login.css
kcHtmlClass=login-pf
kcBodyClass=login-pf-background
appUrl=http://localhost:5173/PruebaMapJapan/
locales=es,en
defaultLocale=es
```

**Email theme.properties pattern** — minimal, no styles or KC HTML classes (email has no interactive shell):
```properties
parent=keycloak

locales=es,en
defaultLocale=es
```

Key difference from login: no `styles=`, no `kcHtmlClass`/`kcBodyClass` (email has no login-pf shell). `parent=keycloak` is required (not `base`) to inherit KC default message keys — see RESEARCH Pitfall 5.

---

### `keycloak/themes/japan-trip/email/html/template.ftl` (template, new)

**Analog:** KC 26.6.1 base `template.ftl` (external — not in repo)

**KC 26.6.1 base template.ftl structure** (from RESEARCH, verified against raw.githubusercontent.com):
```ftl
<#macro emailLayout>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<body>
<#nested>
</body>
</html>
</#macro>
```

**Override pattern** — same `<#macro emailLayout>` name, wraps `<#nested>` in branded card with inline styles per D-07:
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
        <tr><td style="padding-bottom:8px;">
          <span style="font-size:18px;font-weight:600;color:#1d1d1f;letter-spacing:-0.01em;">TravelMap</span>
        </td></tr>
        <tr><td style="border-top:1px solid #d0d0d5;padding-bottom:24px;"></td></tr>
        <tr><td style="background:#ffffff;border:1px solid rgba(0,0,0,0.1);border-radius:0;padding:32px;">
          <#nested>
        </td></tr>
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

Exact padding/spacing at Claude's discretion per CONTEXT.md §Claude's Discretion. Use table-based layout — required for email client compatibility (RESEARCH §State of the Art).

---

### `keycloak/themes/japan-trip/email/html/email-verification.ftl` (template, new)

**Analog (in-repo):** `keycloak/themes/japan-trip/login/login.ftl` — same FTL delegation pattern: `<#import "template.ftl" as layout>` then call the layout macro and delegate body to `msg()`.

**In-repo analog structure** (login.ftl lines 1–71):
```ftl
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=...; section>
    <#if section="header">
        ${msg("loginAccountTitle")}
    <#elseif section="form">
        ...
    </#if>
</@layout.registrationLayout>
```

**Email FTL pattern** (structurally simpler — no sections, just body delegation):
```ftl
<#import "template.ftl" as layout>
<@layout.emailLayout>
  ${kcSanitize(msg("emailVerificationBodyHtml",link, linkExpiration, realmName, linkExpirationFormatter(linkExpiration)))?no_esc}
</@layout.emailLayout>
```

Key points:
- `kcSanitize(...)?no_esc` is required — prevents double-escaping of HTML in message body (see RESEARCH Pitfall 2 / security note)
- The body HTML lives in `messages_es.properties` under key `emailVerificationBodyHtml`
- No `section` blocks needed — email template has a single layout zone (`<#nested>`)

---

### `keycloak/themes/japan-trip/email/html/email-verification-with-code.ftl` (template, new)

**Analog:** `login/login-otp.ftl` (in-repo) for structural pattern; KC 26.6.1 base `email-verification-with-code.ftl` for body delegation

**Pattern:**
```ftl
<#import "template.ftl" as layout>
<@layout.emailLayout>
  ${kcSanitize(msg("emailVerificationBodyCodeHtml",code))?no_esc}
</@layout.emailLayout>
```

---

### `keycloak/themes/japan-trip/email/html/password-reset.ftl` (template, new)

**Analog:** `login/login.ftl` structural pattern (in-repo)

**Pattern:**
```ftl
<#import "template.ftl" as layout>
<@layout.emailLayout>
  ${kcSanitize(msg("passwordResetBodyHtml",link, linkExpiration, realmName, linkExpirationFormatter(linkExpiration)))?no_esc}
</@layout.emailLayout>
```

---

### `keycloak/themes/japan-trip/email/html/executeActions.ftl` (template, new)

**Analog:** `login/login.ftl` structural pattern (in-repo)

**Pattern** [VERIFIED: KC 26.6.1 base executeActions.ftl]:
```ftl
<#outputformat "plainText">
<#assign requiredActionsText><#if requiredActions??><#list requiredActions><#items as reqActionItem>${msg("requiredAction.${reqActionItem}")}<#sep>, </#sep></#items></#list></#if></#assign>
</#outputformat>

<#import "template.ftl" as layout>
<@layout.emailLayout>
${kcSanitize(msg("executeActionsBodyHtml",link, linkExpiration, realmName, requiredActionsText, linkExpirationFormatter(linkExpiration)))?no_esc}
</@layout.emailLayout>
```

---

### `keycloak/themes/japan-trip/email/text/*.ftl` (4 templates, new)

**Analog:** KC 26.6.1 base text FTL files (external — not in repo)

**Text FTL pattern** — plain text, `<#ftl output_format="plainText">` directive on line 1, no layout macro [VERIFIED: KC 26.6.1 base]:
```ftl
<#ftl output_format="plainText">
${msg("emailVerificationBody",link, linkExpiration, realmName, linkExpirationFormatter(linkExpiration))}
```

No HTML. No `kcSanitize()` wrapper in text templates. The `<#ftl output_format="plainText">` directive must appear on line 1. The message key drops the `Html` suffix — no `Txt` suffix either.

Each file delegates to the corresponding text message key [VERIFIED: KC 26.6.1 base]:
- `email-verification.ftl` → `emailVerificationBody`
- `email-verification-with-code.ftl` → `emailVerificationBodyCode`
- `password-reset.ftl` → `passwordResetBody`
- `executeActions.ftl` → `executeActionsBody` (also needs `requiredActionsText` preamble — copy from html variant above)

---

### `keycloak/themes/japan-trip/email/messages/messages_es.properties` (config, new)

**Analog:** `keycloak/themes/japan-trip/login/messages/messages_es.properties` (in-repo, exact)

**In-repo analog file** (full content, 30 lines):
```properties
#encoding=UTF-8
invalidUserMessage=Nombre de usuario o contraseña inválidos.
accountTemporarilyDisabledMessage=Cuenta temporalmente deshabilitada. Contactá al administrador o intentá de nuevo más tarde.
emailVerifyTitle=Verificación de email
emailVerifyInstruction1=Enviamos un correo a {0} con instrucciones para verificar tu dirección.
emailVerifyInstruction2=¿No recibiste el correo de verificación?
emailVerifyInstruction3=para reenviar el correo.
emailVerifyInstruction4=Para verificar tu email, te vamos a enviar instrucciones a {0}.
emailVerifyResend=Reenviar email
emailVerifySend=Enviar email
loginOtpOneTime=Código de un solo uso
errorTitle=Lo sentimos...
backToApplication=« Volver a la aplicación
doClickHere=Hacé clic aquí
doCancel=Cancelar
doLogIn=Ingresar
loginAccountTitle=Iniciá sesión en tu cuenta
```

**Key observations for email messages_es.properties:**
- `#encoding=UTF-8` header is required (line 1)
- Voice: `vos` conjugation (Argentine Spanish) — `Contactá`, `intentá`, `hacé clic`, `Iniciá`, `¿No recibiste?`, `tenés` — executor must match this register
- Key format: camelCase, no spaces around `=`
- Multi-line values are NOT used in the login analog — keep email body values single-line (email clients handle line wrapping)

**Keys to override in email messages_es.properties** (these are new, not in login bundle):
```
emailVerificationBodyHtml   — inline-styled HTML for email verification link
emailVerificationBody    — plain text fallback
emailVerificationBodyCodeHtml — inline-styled HTML for OTP code display
emailVerificationBodyCode  — plain text OTP fallback
passwordResetBodyHtml       — inline-styled HTML for password reset link
passwordResetBody        — plain text fallback
executeActionsBodyHtml      — inline-styled HTML for admin-triggered actions
executeActionsBody       — plain text fallback
```

**Inline style values to use in HTML body keys** (from D-07):
- Body text: `color:#1d1d1f` / `font-size:15px` / `line-height:1.6`
- Links: `color:#0071e3` / `font-weight:500`
- Secondary text: `color:#86868b` / `font-size:13px`
- Paragraph margin: `margin:0 0 16px`

---

### `keycloak/themes/japan-trip/email/messages/messages_en.properties` (config, new)

**Analog:** `login/messages/messages_es.properties` (in-repo, role-match — no `messages_en.properties` exists in login)

**Pattern:** Identical structure to `messages_es.properties`. Same `#encoding=UTF-8` header. Same body keys. English copy in standard English (not vos/Argentine register). Same inline style values for HTML keys.

---

## Shared Patterns

### Web Component Shadow DOM inline CSS — token reference style
**Source:** `frontend/src/components/Navbar.ts` lines 92–295, `SearchBar.ts` lines 33–317
**Apply to:** All TS files with Shadow DOM inline styles (Navbar, SearchBar, AuthGuard)

The pattern is `var(--token-name, hardcoded-fallback)` everywhere. The fallback is always the light-mode value. After rename, the fallback stays unchanged — only the token name changes. Never remove fallbacks.

```typescript
// Pattern: always include fallback
color: var(--jp-text, #1d1d1f);
background: var(--jp-surface, #fff);
border: 1px solid var(--jp-border, rgba(0,0,0,0.1));
```

### Imperative style assignment — token reference style
**Source:** `frontend/src/pages/trip-edit/activities.ts` lines 465, 485, 545
**Apply to:** `tripDetail.ts`, `activities.ts`, `days.ts`, `map.ts`

Imperative assignments use a string with `var(--token-name, fallback)` or `var(--token-name)` (no fallback when inside a template literal in map.ts). Keep the spacing convention of the existing file (activities.ts uses space after comma; map.ts uses no fallback; days.ts uses space after comma).

```typescript
element.style.color = 'var(--jp-text-secondary, #515154)';
element.style.borderBottom = '1px solid var(--jp-border, rgba(0,0,0,0.1))';
```

### KC PatternFly override pattern — `!important` everywhere
**Source:** `keycloak/themes/japan-trip/login/resources/css/login.css` lines 26–283
**Apply to:** All KC CSS edits (login.css, account.css)

All KC theme overrides use `!important` on every property. This is required to override PatternFly defaults. When adding `var(--jp-*)` usages to replace hardcoded values, preserve the `!important`:

```css
color: var(--jp-white) !important;
background: rgba(0, 113, 227, 0.08) !important;  /* before fix */
background: var(--jp-accent-subtle) !important;   /* after fix */
```

### KC dark mode — per-element `@media` overrides, NOT `:root` redefinition
**Source:** `login.css` lines 36–42, 68–76, 90–96, 109–115, 150–162, 219–228
**Apply to:** login.css only (account.css has no dark mode)

login.css does NOT use `[data-theme="dark"]` blocks. It uses `@media (prefers-color-scheme: dark)` to override individual component rules. New token additions go into `:root` (not a separate dark `:root` block). The dark values are expressed as separate tokens (`--jp-bg-dark`, `--jp-surface-dark`) and referenced in `@media` blocks:

```css
:root {
  --jp-bg-dark: #000000;   /* new token to add */
}

@media (prefers-color-scheme: dark) {
  body { background: var(--jp-bg-dark) !important; }
}
```

### KC FTL delegation — `kcSanitize + ?no_esc`
**Source:** `login/login.ftl` line 59 (`kcSanitize(messagesPerField.getFirstError(...))?no_esc`)
**Apply to:** All `email/html/*.ftl` body calls

```ftl
${kcSanitize(msg("bodyHtmlKey", arg1, arg2, ...))?no_esc}
```

The `kcSanitize()` wrapper is required for security. The `?no_esc` suffix tells FreeMarker not to double-escape the already-sanitized HTML. Do not omit either.

---

## No Analog Found

All files have a usable analog. No entries in this section.

---

## Metadata

**Analog search scope:** `frontend/src/`, `keycloak/themes/japan-trip/`
**In-repo files read:** `main.css`, `Navbar.ts`, `SearchBar.ts`, `AuthGuard.ts`, `tripDetail.ts` (grep), `activities.ts` (grep), `days.ts` (grep), `map.ts` (grep), `login.css`, `account.css`, `login/theme.properties`, `login/messages/messages_es.properties`, `login/login.ftl`
**External analogs:** KC 26.6.1 base `template.ftl` (via RESEARCH §KC Base Email template.ftl), KC 26.6.1 base text FTL patterns (via RESEARCH)
**Pattern extraction date:** 2026-05-29
