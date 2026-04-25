# Pitfalls Research

**Domain:** Travel planning web app — Keycloak passkeys + Cloudflare Workers + Neon + GitHub Pages
**Date:** 2026-04-25
**Source:** Derived from codebase analysis (CONCERNS.md, ARCHITECTURE.md, STACK.md, realm-export.json, source files)

---

## Keycloak: Blank RP ID breaks WebAuthn in production
**Severity:** High
**Warning signs:** Passkey registration/assertion throws `DOMException: The relying party ID is not a registrable domain suffix` in the browser console; passkeys work on localhost but fail on the live site.
**Prevention:** Set `webAuthnPolicyPasswordlessRpId` in the Keycloak realm to the exact hostname of the GitHub Pages site (e.g., `manud.github.io`) before the first production deploy. Do not include scheme or path. If using a custom domain, use that hostname instead.
**Phase to address:** Production deployment phase

---

## Keycloak: `browserFlow` defaults to password, passkeys don't auto-trigger
**Severity:** Medium
**Warning signs:** Users land on the standard username/password login form even after registering a passkey; passkeys only appear if the user explicitly selects "Try another way."
**Prevention:** Flip `browserFlow` from `"browser"` to `"browser-passkey"` in the realm config for production. The `apply-local-settings.sh` script already resets it to `"browser"` for local dev (correct — you want password fallback locally). Do this via the Keycloak Admin API or console after Railway deploy, not by changing `realm-export.json` (that would reset everything).
**Phase to address:** Passkeys + IAM phase

---

## CORS: wildcard origin + credentials silently rejected by browsers
**Severity:** High
**Warning signs:** Authenticated API calls work in Postman/curl but silently fail in the browser with a CORS error in the console; `401` never appears because the preflight is rejected before the request is sent.
**Prevention:** Replace `Access-Control-Allow-Origin: *` with the explicit GitHub Pages origin (`https://manud.github.io`). For local dev add `http://localhost:5173`. Use an env var (`ALLOWED_ORIGIN`) injected at build time so the Worker serves the right origin without hardcoding.
**Phase to address:** Security hardening phase (early — blocks production)

---

## JWT audience too broad — `account` client accepted
**Severity:** Medium
**Warning signs:** Tokens issued to the Keycloak Account console client (for passkey management) are accepted by the API — any user who opens the Account console UI gets a token that is valid for API calls, bypassing the intended client scoping.
**Prevention:** In `backend/src/middleware/auth.ts`, change the audience validation from `'account'` to `'japan-trip-api'` (the specific backend client ID). Keycloak embeds the `aud` claim in the token based on the client that requested it.
**Phase to address:** Security hardening phase

---

## XSS via `innerHTML` with user-controlled strings
**Severity:** High
**Warning signs:** A trip with a name like `<img src=x onerror=alert(1)>` renders a script execution alert on the dashboard or trip detail page.
**Prevention:** Replace all `element.innerHTML = userString` patterns in `tripDetail.ts`, `dashboard.ts`, and `map.ts` with `element.textContent = userString` for plain text, or `DOMPurify.sanitize(userString)` for any value that must contain HTML markup. Use `textContent` by default — it's sufficient for all user-provided strings in this app (names, notes, labels).
**Phase to address:** Security hardening phase (or trip builder phase — whichever touches these files first)

---

## `VITE_API_URL` silent localhost fallback in production builds
**Severity:** High
**Warning signs:** The production site loads and authenticates successfully but all API calls 404 or return CORS errors from localhost; no build-time error is raised.
**Prevention:** Add a build-time assertion in `vite.config.ts`:
```typescript
if (process.env.NODE_ENV === 'production' && !process.env.VITE_API_URL) {
  throw new Error('VITE_API_URL must be set for production builds');
}
```
Remove `?? 'http://localhost:8080'` fallbacks from `profile.ts` and any other page that has them.
**Phase to address:** Production deployment phase

---

## Railway Keycloak: no DB = realm config lost on redeploy
**Severity:** High
**Warning signs:** After a Railway redeploy, all users are gone, the realm is reset to defaults, and the realm-export.json customizations (passkey flows, client config) are wiped.
**Prevention:** Provision a Railway PostgreSQL add-on (or Neon database) for Keycloak and set the `KC_DB_*` env vars before the first deploy. Keycloak's `--db=postgres` flag in `railway.toml` already expects this — it just needs the env vars to point at a real DB. Do not rely on H2 (embedded, in-memory) — it's the default when no DB is configured and is ephemeral.
**Phase to address:** Production deployment phase

---

## Keycloak `KC_HOSTNAME` mismatch breaks JWT issuer validation
**Severity:** High
**Warning signs:** Backend returns 401 for all authenticated requests in production; logs show `JWT issuer mismatch: expected https://myapp.up.railway.app/realms/japan-trip but got https://some-other-host/realms/japan-trip`.
**Prevention:** Set `KC_HOSTNAME` to the exact Railway (or custom domain) URL before deploying. The backend validates the `iss` claim against `{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}` — if the Railway URL and the Keycloak-advertised hostname differ by even a trailing slash or subdomain, every token fails.
**Phase to address:** Production deployment phase

---

## Neon autosuspend: cold start on first request after idle
**Severity:** Low
**Warning signs:** First API call after the app has been idle for >5 minutes takes 500ms–2s; subsequent calls are fast.
**Prevention:** This is expected Neon free tier behavior. Mitigation: add a health endpoint (`GET /api/health`) that queries the DB, and ping it from a periodic uptime monitor (UptimeRobot free tier). This keeps Neon warm for active apps. Not worth engineering around for a personal/portfolio project.
**Phase to address:** Production deployment phase (note in runbook, not a code fix)

---

## Static Japan itinerary data expires
**Severity:** Medium
**Warning signs:** The landing page countdown shows a past date ("Trip was 120 days ago"); the hardcoded `ITINERARY` record references Feb-Mar 2026 dates, which pass before the app is fully built.
**Prevention:** The Japan trip demo should be migrated from `frontend/src/data/itinerary.ts` to the actual DB (as a public trip created by a demo user), served via the existing `/api/public/trips/:id` endpoint. Once migrated, the static data file can be removed and the landing page queries the API instead of importing a TS module.
**Phase to address:** Landing page / demo phase

---

## Missing DELETE route for days
**Severity:** Medium
**Warning signs:** UI allows deleting a day but the request 404s; the `deleteDay` query exists in the backend but the route is not registered.
**Prevention:** Add `DELETE /:tripId/destinations/:destId/days/:dayId` route to `trips.ts`, following the same ownership check pattern as other DELETE routes. This is a 10-line fix. The frontend trip builder UI will need this before days can be deleted from the UI.
**Phase to address:** Trip builder phase (backend fix)

---

## Passkey credential filter misses `webauthn-passwordless` type
**Severity:** Medium
**Warning signs:** Profile page shows "No passkeys registered" even after the user has registered a passwordless passkey; the filter `type === 'webauthn'` only matches standard WebAuthn credentials, not passwordless ones.
**Prevention:** Change the filter in `profile.ts` to:
```typescript
credentials.filter(c => c.type === 'webauthn' || c.type === 'webauthn-passwordless')
```
**Phase to address:** Passkeys + IAM phase

---

## `email` typed required but absent in passkey-only flows
**Severity:** Low
**Warning signs:** `user.ts` middleware stores `email: ''` as sentinel value for passkey-only users; downstream code that checks `if (user.email)` silently fails for these users.
**Prevention:** Make `email` nullable in the DB schema (`text('email')` → `text('email').nullable()`) and in `backend/src/types/index.ts`. Update the middleware to store `null` instead of `''`.
**Phase to address:** Passkeys + IAM phase

---

## Quick Reference

| Pitfall | Severity | Prevention |
|---------|----------|------------|
| Blank WebAuthn RP ID | High | Set `webAuthnPolicyPasswordlessRpId` to production domain |
| CORS `*` + credentials | High | Explicit origin in `cors()` middleware |
| XSS via innerHTML | High | `textContent` for user strings; DOMPurify if HTML needed |
| VITE_API_URL fallback | High | Build-time assertion in `vite.config.ts` |
| Railway Keycloak no DB | High | Provision PostgreSQL, set KC_DB_* env vars |
| KC_HOSTNAME mismatch | High | Set KC_HOSTNAME to Railway URL before first deploy |
| JWT audience too broad | Medium | Validate against `japan-trip-api`, not `account` |
| browserFlow stays on password | Medium | Flip to `browser-passkey` via admin API post-deploy |
| Itinerary data expires | Medium | Migrate to DB as demo public trip |
| Missing DELETE day route | Medium | Add 10-line route to trips.ts |
| Passkey credential filter | Medium | Include `webauthn-passwordless` type in filter |
| Neon autosuspend latency | Low | UptimeRobot ping on health endpoint |
| email nullable vs empty | Low | Make email nullable in schema |
