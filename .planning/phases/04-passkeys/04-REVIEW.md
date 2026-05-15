---
phase: 04-passkeys
reviewed: 2026-05-07T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - keycloak/docker-compose.yml
  - keycloak/Dockerfile
  - keycloak/realm-export.json
  - frontend/package.json
  - frontend/src/pages/profile.ts
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-07
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 4 delivers the Keycloak 26.6.1 upgrade, WebAuthn Passwordless realm configuration, and the delete-passkey UI. The core logic is sound and the three PASS requirements from the context are implemented correctly. Two critical issues require fixes: an XSS vector in the passkey list renderer and an overly broad OAuth redirect URI in the realm config. Three warnings cover a stale-token risk in fetch calls, a docker-compose/Dockerfile config drift, and a hardcoded RP ID that will break production deployments.

## Critical Issues

### CR-01: XSS in passkey list renderer — unsanitized `userLabel` injected via `innerHTML`

**File:** `frontend/src/pages/profile.ts:74-95`

**Issue:** `list.innerHTML` is assembled by string interpolation that includes `label` (from `c.userLabel`) and `c.id` directly. If a Keycloak account holder sets a passkey label containing HTML (e.g. `<img src=x onerror=alert(1)>`), the payload executes. `dompurify` is already in `dependencies` but is not imported or used in this file. Even though the attacker is limited to their own account today, the pattern breaks under any admin view, future multi-user context, or API compromise.

**Fix:**
```typescript
import DOMPurify from 'dompurify';

// Replace the string-template list builder with DOM construction:
webauthn.forEach((c) => {
  const li = document.createElement('li');
  li.className = 'passkey-item';
  li.dataset.credentialId = c.id;

  const info = document.createElement('div');
  info.className = 'passkey-info';

  const name = document.createElement('span');
  name.className = 'passkey-name';
  name.textContent = c.userLabel ?? 'Passkey';   // textContent is XSS-safe
  info.appendChild(name);

  if (c.createdDate) {
    const meta = document.createElement('span');
    meta.className = 'passkey-meta';
    meta.textContent = `Registrado: ${new Date(c.createdDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    info.appendChild(meta);
  }

  const btn = document.createElement('button');
  btn.className = 'btn btn-danger';
  btn.type = 'button';
  btn.dataset.credentialId = c.id;
  btn.textContent = 'Eliminar';
  btn.addEventListener('click', () => openDeleteConfirm(c.id));

  li.appendChild(info);
  li.appendChild(btn);
  list.appendChild(li);
});
```
Alternatively, keep the template approach but wrap `label` with `DOMPurify.sanitize(label)` and set the `data-credential-id` attribute to `DOMPurify.sanitize(c.id)` — though DOM construction is the safer pattern.

---

### CR-02: Wildcard OAuth redirect URI allows any `*.github.io` subdomain

**File:** `keycloak/realm-export.json:65,71`

**Issue:** The redirect URI `"https://*.github.io/*"` and the matching `post.logout.redirect.uris` accept any GitHub Pages subdomain as a valid callback. An attacker who creates `evil.github.io` can craft an authorization request with `redirect_uri=https://evil.github.io/callback`, and Keycloak will honour it. PKCE (S256 is configured) prevents code injection but the redirect_uri policy itself is non-conformant with OAuth 2.0 BCP (RFC 9700 §2.1), which requires exact-match or narrow-prefix URIs.

**Fix:** Replace the wildcard with the actual GitHub Pages domain:
```json
"redirectUris": [
  "http://localhost:5173/*",
  "https://manudubovis.github.io/PruebaMapJapan/*"
],
"attributes": {
  "pkce.code.challenge.method": "S256",
  "post.logout.redirect.uris": "http://localhost:5173/*##https://manudubovis.github.io/PruebaMapJapan/*"
}
```
If the GitHub org/user slug changes, this must be updated — but that is a known deploy-time step.

---

## Warnings

### WR-01: Stale token used directly in `fetch` calls — should use `getToken()`

**File:** `frontend/src/pages/profile.ts:55,203`

**Issue:** Both `loadPasskeys()` (line 55) and the delete handler (line 203) read `keycloak.token` directly. This is the raw property on the Keycloak instance and does not trigger a refresh. The exported `getToken()` in `auth/keycloak.ts` calls `keycloak.updateToken(30)` before returning the token. On a profile page that stays open past the 5-minute access token lifetime (configured in realm-export.json line 22), the first passkey action will produce an HTTP 401.

**Fix:**
```typescript
// At top of profile.ts, import getToken:
import { initKeycloak, getUserInfo, logout, keycloak, getToken } from '@/auth/keycloak';

// loadPasskeys(), line 55:
const token = await getToken();

// delete handler, line 203:
headers: { Authorization: `Bearer ${await getToken()}` },
```

---

### WR-02: docker-compose Keycloak service does not connect to postgres

**File:** `keycloak/docker-compose.yml:20-34`

**Issue:** The `keycloak` service has `depends_on: postgres` but no `KC_DB`, `KC_DB_URL`, `KC_DB_USERNAME`, or `KC_DB_PASSWORD` environment variables. Keycloak 26 `start-dev` defaults to an embedded H2 database when these are absent, so `postgres` is started but never used. The `Dockerfile` correctly sets `KC_DB=postgres`, but the compose service uses the upstream image (`quay.io/keycloak/keycloak:26.6.1`) directly, not the custom Dockerfile. This means realm data is lost on every container restart.

**Fix** (option A — make compose actually use postgres):
```yaml
keycloak:
  image: quay.io/keycloak/keycloak:26.6.1
  environment:
    KC_BOOTSTRAP_ADMIN_USERNAME: admin
    KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    KC_HTTP_PORT: 8080
    KC_DB: postgres
    KC_DB_URL: jdbc:postgresql://postgres:5432/japan_trip
    KC_DB_USERNAME: postgres
    KC_DB_PASSWORD: postgres
```

**Fix** (option B — make compose use the Dockerfile so KC_DB=postgres is picked up from the build):
```yaml
keycloak:
  build: .
  ...
```

For a local dev environment where ephemeral state is acceptable, option B is lighter. Choose explicitly to avoid the silent mismatch.

---

### WR-03: `webAuthnPolicyPasswordlessRpId` hardcoded to `"localhost"` — will reject passkeys on production

**File:** `keycloak/realm-export.json:42`

**Issue:** The RP ID `"localhost"` is valid only when the WebAuthn ceremony is performed on `localhost`. Browsers enforce that the RP ID must be a registrable domain suffix of the page's effective domain. Any passkey registered via the GitHub Pages deployment (`manudubovis.github.io`) will fail registration because the RP ID does not match. The 04-CONTEXT.md documents this as a known deployment step, but the current value will silently break production users who try to register passkeys.

**Fix:** This cannot be resolved in a single config file (local dev vs. production need different values). Two options:
1. Document a hard-wired production step: update the RP ID in the Railway Keycloak admin to the production domain before enabling passkeys publicly.
2. Use an environment-variable substitution in a startup script so the compose file and production deployment each supply the correct value.

No code change required for this phase per the CONTEXT.md decision D-02, but the risk should be noted for the production checklist.

---

## Info

### IN-01: `init()` bare call at line 287 not guarded against unhandled rejection

**File:** `frontend/src/pages/profile.ts:287`

**Issue:** `init()` is called without `.catch()`. If an unhandled exception escapes the outer `try/catch` blocks inside `init` (e.g., a synchronous throw in `initTheme()` or `buildDeleteModal()`), it produces an unhandled promise rejection, which is silent in production and may leave the page in a broken state.

**Fix:**
```typescript
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init().catch(console.error); });
} else {
  init().catch(console.error);
}
```

---

_Reviewed: 2026-05-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
