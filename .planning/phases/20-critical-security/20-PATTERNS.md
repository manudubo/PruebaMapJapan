# Phase 20: Critical Security - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `backend/src/routes/auth.ts` | route handler | request-response | itself (surgical edit) | exact |
| `frontend/src/modules/widgets.ts` | module/renderer | event-driven + fetch | itself (surgical edit) | exact |
| `frontend/vite.config.ts` | build config | build-time transform | itself + RESEARCH.md pattern | exact |
| `terraform/cloudflare/main.tf` | infra config | N/A | itself (pure deletion) | exact |
| `terraform/cloudflare/variables.tf` | infra config | N/A | itself (pure deletion) | exact |
| `terraform/cloudflare/local.tfvars.example` | infra config | N/A | itself (pure deletion) | exact |
| `backend/tests/otp-csprng.test.ts` | test | N/A | `backend/src/auth/keycloak.test.ts` | role-match |
| `frontend/tests/widgets-xss.test.ts` | test | N/A | `frontend/tests/dom.test.ts` | role-match |

---

## Pattern Assignments

### `backend/src/routes/auth.ts` (route handler, request-response)

**Change scope:** Single line replacement at line 123. No structural changes.

**Current line 123:**
```typescript
const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
```

**Replacement (D-01):**
```typescript
// bias < 0.023% across Uint32 range — negligible for 6-digit OTP
const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
```

**Why no import is needed** — `crypto.subtle` is already used at line 22 (`crypto.subtle.importKey`) and line 30 (`crypto.subtle.sign`) in the same file. `crypto` is a Cloudflare Workers global; `getRandomValues` is on the same global object.

**Surrounding context** (lines 111–128 — do not modify any line except 123):
```typescript
    const existing = await getLatestUnexpiredOtp(db, userId);
    if (existing) {
      const retryAfter = Math.ceil(
        (existing.expires_at.getTime() - Date.now()) / 1000,
      );
      return c.json(
        { success: false as const, error: 'otp_pending', retryAfter },
        429,
      );
    }

    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'); // LINE 123 — replace this
    const codeHash = await hashOtp(code, c.env.OTP_SECRET);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
```

---

### `frontend/src/modules/widgets.ts` (module, event-driven + fetch)

**Change scope:** `renderList` function (lines 190–203) rewritten; function signature gains `export` keyword. No other functions modified.

**Current renderList** (lines 190–203 — full current implementation):
```typescript
function renderList(container: HTMLElement, items: NewsItem[], type: 'news' | 'events', city: string): void {
  const listItems = items.map(item => {
    const title = cleanTitle(item.title);
    const date = formatDate(item.pubDate);
    let actionBtn = '';
    if (type === 'events') {
      const calUrl = createCalendarUrl(title, item.link, `${city}, Japan`);
      actionBtn = `<a href="${calUrl}" target="_blank" rel="noopener" class="calendar-btn" title="Add to calendar" aria-label="Add ${title} to calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg></a>`;
    }
    return `<li class="widget-list-item"><div class="widget-text-content"><a href="${item.link}" target="_blank" rel="noopener" class="widget-link"><span class="widget-link-title">${title}</span><span class="widget-meta"><span>${item.source}</span><time datetime="${item.pubDate}">${date}</time></span></a></div>${actionBtn}</li>`;
  }).join('');
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<ul class="widget-list" role="list">${listItems}</ul>`;
}
```

**DOM API rewrite pattern** (D-02 — replace lines 190–203 wholesale):
```typescript
export function renderList(container: HTMLElement, items: NewsItem[], type: 'news' | 'events', city: string): void {
  container.setAttribute('aria-busy', 'false');
  const ul = document.createElement('ul');
  ul.className = 'widget-list';
  ul.setAttribute('role', 'list');

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'widget-list-item';

    const div = document.createElement('div');
    div.className = 'widget-text-content';

    const a = document.createElement('a');
    a.setAttribute('href', item.link);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.className = 'widget-link';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'widget-link-title';
    titleSpan.textContent = cleanTitle(item.title);  // textContent — not innerHTML

    const metaSpan = document.createElement('span');
    metaSpan.className = 'widget-meta';

    const sourceSpan = document.createElement('span');
    sourceSpan.textContent = item.source;  // textContent — not innerHTML

    const time = document.createElement('time');
    time.setAttribute('datetime', item.pubDate);
    time.textContent = formatDate(item.pubDate);

    metaSpan.appendChild(sourceSpan);
    metaSpan.appendChild(time);
    a.appendChild(titleSpan);
    a.appendChild(metaSpan);
    div.appendChild(a);
    li.appendChild(div);

    if (type === 'events') {
      const calUrl = createCalendarUrl(cleanTitle(item.title), item.link, `${city}, Japan`);
      const calA = document.createElement('a');
      calA.setAttribute('href', calUrl);  // setAttribute — not innerHTML
      calA.setAttribute('target', '_blank');
      calA.setAttribute('rel', 'noopener');
      calA.className = 'calendar-btn';
      calA.setAttribute('title', 'Add to calendar');
      calA.setAttribute('aria-label', `Add ${cleanTitle(item.title)} to calendar`);
      // SVG is a literal string — not RSS data — safe to use innerHTML here
      calA.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>`;
      li.appendChild(calA);
    }

    ul.appendChild(li);
  }

  container.innerHTML = '';  // clear previous state — safe: no user data
  container.appendChild(ul);
}
```

**Key rules for this rewrite:**
- Every RSS-sourced field (`item.title`, `item.source`, `item.pubDate`, `item.link`, derived `calUrl`) must use `textContent` or `setAttribute` — never template strings into `innerHTML`.
- The SVG literal in the calendar button is a hardcoded string, not RSS data. Using `innerHTML` for it is safe and acceptable.
- `export` keyword is added so the function is importable in tests (Pitfall 5).
- The `container.innerHTML = ''` clear at the bottom contains no user data — safe as-is.

**Import line** (line 3 — no change needed, all helpers already imported):
```typescript
import { getCache, setCache, createElement, cleanTitle, formatDate, isValidItem, createCalendarUrl } from './utils';
```

---

### `frontend/vite.config.ts` (build config, build-time transform)

**Change scope:** Add `cspPlugin` function before `defineConfig`, add it to the `plugins` array. No other config keys modified.

**Current file** (lines 1–52 — full file, no existing plugins array):
```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/PruebaMapJapan/',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    target: 'esnext',
    outDir: 'dist',
    ...
    rollupOptions: { input: { main: ..., tokyo: ..., ... } },
  },
  server: { port: 5173 },
  preview: { port: 5173 },
});
```

**Import addition** — add `Plugin` type to the existing vite import (line 1):
```typescript
import { defineConfig, type Plugin } from 'vite';
```

**cspPlugin function** — insert between the imports and `export default defineConfig(...)`:
```typescript
function cspPlugin(): Plugin {
  const keycloakUrl = process.env['VITE_KEYCLOAK_URL'] ?? 'http://localhost:8080';
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://cdn-icons-png.flaticon.com",
    `connect-src 'self' https://api.allorigins.win https://corsproxy.io https://api.open-meteo.com https://nominatim.openstreetmap.org ${keycloakUrl}`,
    "font-src 'self' https://fonts.gstatic.com",
    `frame-src 'self' ${keycloakUrl}`,
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ');

  return {
    name: 'csp-meta',
    transformIndexHtml(html: string): string {
      return html.replace(
        '<head>',
        `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    },
  };
}
```

**plugins key addition** — in the `defineConfig({...})` object, add after `base`:
```typescript
plugins: [cspPlugin()],
```

**Critical notes:**
- `process.env['VITE_KEYCLOAK_URL']` is read at Vite build time (not runtime). In local dev it defaults to `http://localhost:8080`.
- `frame-ancestors` is NOT supported in `<meta>` CSP tags — do not add it.
- Verify against `npm run build && npm run preview` output, not dev server (Pitfall 1).
- Unregister SW before CSP devtools check (Pitfall 2).

---

### `terraform/cloudflare/main.tf` (infra config, pure deletion)

**Current file** (full 13 lines):
```hcl
resource "cloudflare_worker_secret" "resend_api_key" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "RESEND_API_KEY"
  secret_text = var.resend_api_key
}

resource "cloudflare_worker_secret" "kc_admin_client_secret" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "KC_ADMIN_CLIENT_SECRET"
  secret_text = var.kc_admin_client_secret
}
```

**Delete lines 8–13** (the `kc_admin_client_secret` resource block, including trailing newline). The `resend_api_key` block (lines 1–6) is kept intact.

**Result after edit:**
```hcl
resource "cloudflare_worker_secret" "resend_api_key" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "RESEND_API_KEY"
  secret_text = var.resend_api_key
}
```

---

### `terraform/cloudflare/variables.tf` (infra config, pure deletion)

**Current file** (full 20 lines):
```hcl
variable "cf_account_id" {
  type        = string
  description = "Cloudflare account ID (find in Cloudflare Dashboard → right sidebar)"
}

variable "cf_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API token with Workers:Edit permission"
}

variable "resend_api_key" {
  type      = string
  sensitive = true
}

variable "kc_admin_client_secret" {
  type      = string
  sensitive = true
}
```

**Delete lines 17–20** (the `kc_admin_client_secret` variable block). Lines 1–15 kept intact.

---

### `terraform/cloudflare/local.tfvars.example` (infra config, pure deletion)

**Current file** (4 lines):
```
cf_account_id          = "00000000000000000000000000000000"
cf_api_token           = "REPLACE_WITH_CF_API_TOKEN"
resend_api_key         = "REPLACE_WITH_RESEND_API_KEY"
kc_admin_client_secret = "REPLACE_WITH_KC_ADMIN_CLIENT_SECRET"
```

**Delete line 4** (`kc_admin_client_secret = ...`). Lines 1–3 kept intact.

**Note:** No actual `terraform/cloudflare/*.tfvars` file exists (only `terraform/keycloak/local.tfvars`). Only the `.example` file needs editing.

---

### `backend/tests/otp-csprng.test.ts` (test, CREATE)

**Analog:** `backend/src/auth/keycloak.test.ts`

**Why this analog:** It's the only backend test that uses `vi.stubGlobal('crypto', ...)` to mock the Web Crypto API. The OTP test needs the same pattern to assert that `crypto.getRandomValues` is called and `Math.random` is not.

**Import pattern** (from analog, lines 1–2):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

**Global mock pattern** (from analog, lines 91–101):
```typescript
vi.stubGlobal('crypto', {
  subtle: {
    importKey: vi.fn().mockResolvedValue(fakeCryptoKey),
    verify: vi.fn(),
  },
});
// ...
afterEach(() => {
  vi.unstubAllGlobals();
});
```

**Target test file structure** (file to create at `backend/tests/otp-csprng.test.ts`):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the function under test once it is exported.
// If generateOtp is extracted from auth.ts, import it here.
// Otherwise, test via the crypto global mock that Math.random is not called.

describe('OTP CSPRNG — SEC-01', () => {
  beforeEach(() => {
    vi.stubGlobal('Math', {
      ...Math,
      random: vi.fn(() => { throw new Error('Math.random must not be called'); }),
    });
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((arr: Uint32Array) => {
        arr[0] = 123456789;
        return arr;
      }),
      subtle: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call Math.random during OTP generation', () => {
    // Drive the OTP generation code path and assert Math.random throws = not called.
    // Exact import depends on whether generateOtp is extracted as a helper.
    expect(crypto.getRandomValues).toBeDefined();
    expect(() => Math.random()).toThrow('Math.random must not be called');
  });

  it('produces a 6-digit zero-padded string from getRandomValues output', () => {
    const arr = new Uint32Array(1);
    (crypto.getRandomValues as ReturnType<typeof vi.fn>)(arr);
    const code = String(arr[0]! % 1_000_000).padStart(6, '0');
    expect(code).toMatch(/^\d{6}$/);
    expect(code.length).toBe(6);
  });
});
```

**Backend test runner:** `npm run test` in `backend/` (Vitest, no config file — uses package.json `vitest run`).

---

### `frontend/tests/widgets-xss.test.ts` (test, CREATE)

**Analog:** `frontend/tests/dom.test.ts`

**Why this analog:** It tests DOM security properties — specifically that `innerHTML` setter is not called (`vi.spyOn(el, 'innerHTML', 'set')`). The XSS test needs the same DOM spy pattern to assert malicious content is not injected.

**Secondary analog:** `frontend/tests/utils.test.ts` — shows the import pattern for `@/modules/...` path aliases and the jsdom environment usage (no explicit setup needed; `vitest.config.ts` sets `environment: 'jsdom'`).

**Import pattern** (from analogs):
```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderList } from '@/modules/widgets';
import type { NewsItem } from '@/types';
```

**DOM spy pattern** (from `dom.test.ts`, lines 13–16):
```typescript
const spy = vi.spyOn(el, 'innerHTML', 'set');
// ... run the code under test ...
expect(spy).not.toHaveBeenCalled();
```

**Target test file structure** (file to create at `frontend/tests/widgets-xss.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { renderList } from '@/modules/widgets';
import type { NewsItem } from '@/types';

const xssItem: NewsItem = {
  title: '<img src=x onerror=alert(1)>',
  link: 'https://example.com/news',
  pubDate: new Date().toISOString(),
  source: '<script>alert(2)</script>',
};

describe('renderList XSS prevention — SEC-02', () => {
  it('does not inject malicious title into the DOM as HTML', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'news', 'Tokyo');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders malicious title as literal text', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'news', 'Tokyo');
    expect(container.textContent).toContain('<img src=x');
  });

  it('does not inject malicious source as HTML', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'news', 'Tokyo');
    expect(container.textContent).toContain('<script>alert(2)</script>');
    expect(container.querySelector('script')).toBeNull();
  });

  it('events type: calUrl assigned via setAttribute, not innerHTML', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'events', 'Tokyo');
    const calLink = container.querySelector('.calendar-btn') as HTMLAnchorElement | null;
    expect(calLink).not.toBeNull();
    expect(calLink?.getAttribute('href')).toBeTruthy();
    // href must not contain raw script injection
    expect(calLink?.getAttribute('href')).not.toContain('<script>');
  });
});
```

**jsdom environment:** Provided by `frontend/vitest.config.ts` (`environment: 'jsdom'`). No additional setup needed.
**Path alias:** `@/` maps to `frontend/src/` — same config as all other frontend tests.
**Test runner:** `npm run test:run` in `frontend/`.

---

## Shared Patterns

### crypto global (Web Crypto API)
**Source:** `backend/src/routes/auth.ts` lines 22–31
**Apply to:** `backend/src/routes/auth.ts` (OTP fix) and `backend/tests/otp-csprng.test.ts`
```typescript
// crypto is a Cloudflare Workers global — no import needed
// getRandomValues and subtle are on the same object
crypto.subtle.importKey(...)   // already used at line 22
crypto.getRandomValues(...)    // same global, no new import
```

### vi.stubGlobal for Web Crypto mocking
**Source:** `backend/src/auth/keycloak.test.ts` lines 91–101
**Apply to:** `backend/tests/otp-csprng.test.ts`
```typescript
vi.stubGlobal('crypto', {
  subtle: { importKey: vi.fn(), verify: vi.fn() },
  getRandomValues: vi.fn((arr: Uint32Array) => { arr[0] = 42000000; return arr; }),
});
// Always pair with:
afterEach(() => { vi.unstubAllGlobals(); });
```

### DOM spy pattern (assert innerHTML not called)
**Source:** `frontend/tests/dom.test.ts` lines 13–16
**Apply to:** `frontend/tests/widgets-xss.test.ts`
```typescript
const spy = vi.spyOn(el, 'innerHTML', 'set');
// ... invoke code under test ...
expect(spy).not.toHaveBeenCalled();
```

### Path alias import pattern
**Source:** `frontend/tests/utils.test.ts` lines 3–14
**Apply to:** `frontend/tests/widgets-xss.test.ts`
```typescript
import { functionName } from '@/modules/module-name';
import type { TypeName } from '@/types';
```

### Vitest import line (backend)
**Source:** `backend/src/auth/keycloak.test.ts` line 1
**Apply to:** `backend/tests/otp-csprng.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

---

## No Analog Found

All files have analogs. No entries.

---

## Metadata

**Analog search scope:** `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`, `terraform/cloudflare/`
**Files scanned:** 12 source files + 5 test files
**Pattern extraction date:** 2026-07-24
