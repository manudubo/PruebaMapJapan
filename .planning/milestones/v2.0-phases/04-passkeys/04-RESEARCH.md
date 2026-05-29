# Phase 4: Passkeys — Research

**Researched:** 2026-05-06
**Domain:** Keycloak 25→26 upgrade, WebAuthn/passkey configuration, keycloak-js upgrade, Account REST API
**Confidence:** MEDIUM (server behavior verified via official docs and community; some claims require runtime confirmation)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Upgrade Keycloak from 25.0 to **26.6.1** — docker-compose, Dockerfile, keycloak-js ^25.0.0 → ^26.0.0.
- **D-02:** Set `webAuthnPolicyPasswordlessRpId` to `"localhost"` in `keycloak/realm-export.json`.
- **D-03:** Change registration action `'webauthn-register'` → `'webauthn-register-passwordless'` in profile.ts `registerPasskey()`.
- **D-04:** Change type filter `c.type === 'webauthn'` → `c.type === 'webauthn-passwordless'` in profile.ts `loadPasskeys()`.
- **D-05:** Add inline delete button per passkey row + confirmation overlay → `DELETE /realms/${realm}/account/credentials/${id}` with Bearer token.

### Claude's Discretion
- Exact markup for the delete confirmation modal (follow `.overlay`/`.modal` pattern, build dynamically).
- keycloak-js 26.x exact patch version — use `npm install keycloak-js@^26.0.0` (latest stable 26.x).
- Whether KC 26 browser flow needs the WebAuthn Passwordless authenticator added — document as manual verification step.

### Deferred Ideas (OUT OF SCOPE)
- Production RP ID configuration for Railway Keycloak.
- Rename passkey (PUT credentials/{id}/label).
- Passkey login browser flow configuration in Keycloak admin.
- `email` field absent in passkey-only flows.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PASS-01 | Passkey registration uses correct action string (`webauthn-register-passwordless`) | D-03: one-line change in registerPasskey(); action routes to Passwordless policy with configured RP ID |
| PASS-02 | `webAuthnPolicyPasswordlessRpId` is set in `realm-export.json` for local dev | D-02: field confirmed present at line 42; value `""` → `"localhost"` |
| PASS-03 | User can delete a registered passkey from the profile page | D-05: DELETE endpoint still functional in KC 26 (deprecated but not removed); UI pattern from trip-edit.html overlay |
</phase_requirements>

---

## Summary

Phase 4 has five mechanical changes: upgrade the Keycloak image tag (docker-compose + Dockerfile), upgrade keycloak-js, fix two strings in profile.ts, set one field in realm-export.json, and add delete UI to profile.ts. The upgrade from KC 25.0 to KC 26.6.1 introduces three gotchas that the planner must address: (1) the admin env vars changed names, (2) keycloak-js latest 26.x is 26.2.4 — not a 26.6.x that matches the server — but that is expected and supported, (3) the Account REST DELETE endpoint is deprecated in KC 26 in favor of a `kc_action` approach but remains functional and callable with a Bearer token.

**Primary recommendation:** Execute D-01 through D-05 as specified; add `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` alongside the deprecated vars for KC 26 compatibility; pin keycloak-js to `^26.0.0` (resolves to 26.2.4); run `npm run typecheck` immediately after the npm upgrade to catch any surface changes.

---

## 1. KC 25.0 → 26.6.1 Server Changes

### 1.1 Admin Bootstrap Environment Variables — BREAKING

| Old var (KC 25) | New var (KC 26) | Status in KC 26 |
|-----------------|-----------------|-----------------|
| `KEYCLOAK_ADMIN` | `KC_BOOTSTRAP_ADMIN_USERNAME` | Deprecated — emits startup warning, still functional [CITED: keycloak.org/2024/10/keycloak-2600-released] |
| `KEYCLOAK_ADMIN_PASSWORD` | `KC_BOOTSTRAP_ADMIN_PASSWORD` | Deprecated — same as above |

**Impact on this project:** `keycloak/docker-compose.yml` uses `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`. KC 26 will log deprecation warnings on container start but will still create the admin user. The planner should update these to the new names in the same PR as the image tag bump — it is a one-line change per variable and eliminates noisy logs.

**Confirmed:** KC 26 start-dev generates warnings for old vars but does NOT refuse to start [CITED: github.com/keycloak/keycloak/discussions/35477, github.com/dcm4che/dcm4chee-arc-light/issues/4624].

### 1.2 `start-dev --import-realm` — UNCHANGED

`command: start-dev --import-realm` with a volume mount to `/opt/keycloak/data/import/` works identically in KC 26. The import mechanism has been available since KC 18 and was not altered in the 26.x series. [CITED: keycloak.org/server/containers] [VERIFIED: multiple KC 26 docker-compose examples in community confirm this pattern]

### 1.3 Hostname v1 Removed

KC 26.0.0 removed the deprecated hostname v1 feature. The current docker-compose.yml does not use hostname v1 config (`--hostname-strict`, `KEYCLOAK_FRONTEND_URL`, etc.) so this does not affect the project. [CITED: keycloak.org/2024/10/keycloak-2600-released]

### 1.4 Health Endpoints — Management Port

KC 25 introduced a dedicated management port (default 9000) for `/health/ready` and `/metrics`. KC 26.4.0 adds a new flag `http-management-health-enabled` that can expose health on the main HTTP port.

**Impact on this project:** The current docker-compose.yml has **no Keycloak health check** — this is a non-issue for this phase. If a health check is added in future, use port 9000 or add `KC_HTTP_MANAGEMENT_HEALTH_ENABLED=true`. [CITED: keycloak.org/docs/latest/release_notes, section 26.4.0]

### 1.5 Keycloak-js Standalone — Relevant but Not Breaking for This Project

KC 26.0.0 removed the `/js/keycloak.js` static file served by the Keycloak server. Applications now must use keycloak-js from npm only. This project already uses the npm package, so no change needed. [CITED: keycloak.org/2024/10/keycloak-2600-released]

### 1.6 Realm Export Format — No Field Renames for WebAuthn

No changes to `webAuthnPolicyPasswordless*` field names between KC 25 and KC 26. [ASSUMED — confirmed by examining the realm-export.json field structure and cross-referencing with KC 26.4 passkeys docs which reference the same field names in admin UI labels]

Known KC 26 realm export bug: if you export a realm that was originally imported, authentication flow executions can be duplicated in the JSON on re-export. This does not affect the import step in this phase. [CITED: github.com/keycloak/keycloak/issues/31182]

### 1.7 Passkeys Native Integration (KC 26.3+)

KC 26.3.0 added native passkey support to default login forms via an "Enable Passkeys" toggle in the WebAuthn Passwordless Policy admin UI. KC 26.4 extended this further. These are UI-layer additions; they do not change the realm-export.json field names or the `webauthn-register-passwordless` action string. The existing custom `browser-passkey` flow in realm-export.json is still valid. [CITED: keycloak.org/2025/07/keycloak-2630-released, keycloak.org/2025/09/passkeys-support-26-4]

---

## 2. keycloak-js 25 → 26 Changes

### 2.1 Version Mismatch: Server 26.6.1 vs keycloak-js 26.2.4

**Critical finding:** keycloak-js follows an independent release cycle as of 26.2.0. The latest stable keycloak-js is **26.2.4** (verified: `npm view keycloak-js dist-tags` → `{ latest: '26.2.4' }`). There is no keycloak-js 26.6.x.

`npm install keycloak-js@^26.0.0` will install **26.2.4**.

The keycloak team states the adapter "continues to be backwards compatible with all actively supported releases of the Keycloak server," which includes KC 26.6.1. [CITED: keycloak.org/2025/02/keycloak-js-2620-released]

### 2.2 UMD Distribution Removed — Not Applicable

The UMD global (`/js/keycloak.js` from server + window.Keycloak) was removed. This project uses Vite + npm imports — no impact. [CITED: keycloak.org/2024/10/keycloak-2600-released]

### 2.3 TypeScript Module Resolution — Already Handled

keycloak-js 26.x requires `"moduleResolution": "bundler"` or `"node16"` in tsconfig.json. The project already has `"moduleResolution": "bundler"` in `frontend/tsconfig.json` line 9. No tsconfig change needed. [VERIFIED: read frontend/tsconfig.json]

### 2.4 Core API Surface — Stable

The following APIs used by this project are stable across 25→26:
- `new Keycloak({url, realm, clientId})` — unchanged [CITED: keycloak.org/securing-apps/javascript-adapter]
- `keycloak.init({onLoad, silentCheckSsoRedirectUri, pkceMethod, responseMode, checkLoginIframe})` — all options present in KC 26 docs [CITED: keycloak.org/securing-apps/javascript-adapter]
- `keycloak.login({action, redirectUri})` — `action` parameter still supported [CITED: keycloak.org/securing-apps/javascript-adapter]
- `keycloak.updateToken(30)` — unchanged
- `keycloak.token`, `keycloak.authenticated`, `keycloak.tokenParsed` — unchanged

### 2.5 `login()` Destructuring Bug — Low Risk for This Project

keycloak-js 26.2.1 introduced a regression where destructured `login` calls (`const { login } = keycloak; login()`) fail. This project calls `keycloak.login(...)` directly on the instance, not via destructuring. Not affected. [CITED: github.com/keycloak/keycloak-js/issues/202]

### 2.6 PKCE Default Behavior

In KC 26, PKCE (S256) is enabled by default. The project explicitly sets `pkceMethod: 'S256'` in init() — this is explicit and correct, not redundant. [CITED: keycloak.org/securing-apps/javascript-adapter]

### 2.7 Mandatory TypeCheck After Upgrade

Run `npm run typecheck` immediately after `npm install keycloak-js@^26.0.0`. The `KeycloakTokenParsed` type and `Keycloak` namespace types were refactored. The `import Keycloak from 'keycloak-js'` default import and `Keycloak.KeycloakTokenParsed` namespace access (used in keycloak.ts line 132) may need adjustment if types moved. [MEDIUM confidence — based on issue #34002 which was closed as resolved in 26.0.x patches]

---

## 3. Account REST API v1 — KC 26 Status

### 3.1 GET Credentials Endpoint — FUNCTIONAL

```
GET /realms/{realm}/account/credentials?type=webauthn-passwordless
Authorization: Bearer {access_token}
```

Still functional in KC 26.6.1. The `type` query parameter filters by credential type. Response shape is unchanged: `[{ id: string, type: string, userLabel?: string, createdDate?: number }]`. [ASSUMED — confirmed structurally by CONTEXT.md code_context section; no official deprecation notice found for GET endpoint]

### 3.2 DELETE Credential Endpoint — DEPRECATED BUT FUNCTIONAL

```
DELETE /realms/{realm}/account/credentials/{credentialId}
Authorization: Bearer {access_token}
```

**Status:** Deprecated in KC 26. The AccountCredentialResource `removeCredential` method is marked `@Deprecated` in KC 26.6.1 Javadoc. The Account Console no longer uses it internally. However, the endpoint **still accepts requests** — it is not removed. [CITED: keycloak.org/docs-api/latest/javadocs/org/keycloak/services/resources/account/AccountCredentialResource.html]

**Alternative (recommended by Keycloak):** Use `kc_action=delete_credential:{id}` as an Application-Initiated Action (AIA), which triggers a Keycloak redirect flow with a confirmation screen. The `keycloak.login({ action: 'delete_credential:{id}' })` pattern would initiate this. [CITED: github.com/keycloak/keycloak/commit/5b521173518a80b9ce87ae8fd48bb13e86a657ca]

**Decision for D-05:** CONTEXT.md locks in the direct DELETE approach. This is valid — the endpoint still works. The planner should note this as a known deprecation and plan to revisit in a future phase when the endpoint is removed.

### 3.3 Response Shape Verification

The `CredentialInfo` interface in profile.ts matches the documented response:
```typescript
interface CredentialInfo {
  id: string;
  type: string;          // will be 'webauthn-passwordless' after D-03 fix
  userLabel?: string;
  createdDate?: number;  // milliseconds since epoch
}
```
No changes to this shape documented in KC 26. [ASSUMED — no contrary evidence found]

---

## 4. WebAuthn/Passkey Policy — KC 26 Configuration

### 4.1 `webAuthnPolicyPasswordlessRpId` Field — Unchanged

The field name `webAuthnPolicyPasswordlessRpId` is the correct realm-export.json key in KC 26. Currently set to `""` at line 42 of realm-export.json. Setting it to `"localhost"` is required for WebAuthn API to work on `http://localhost:5173`. [ASSUMED — field name confirmed by reading realm-export.json and cross-referencing with KC 26 admin UI path "Authentication → Policies → Webauthn Passwordless Policy → Relying Party ID"]

**Why `"localhost"` works:** The WebAuthn spec allows `"localhost"` as a special RP ID that matches `http://localhost:*` without requiring HTTPS. Chromium enforces this. [CITED: W3C WebAuthn spec effective domain rules; industry-standard practice]

### 4.2 Other Passwordless Policy Fields Already Correct

| Field | Current Value | Required | Status |
|-------|---------------|----------|--------|
| `webAuthnPolicyPasswordlessAuthenticatorAttachment` | `"platform"` | Platform authenticator (Touch ID, Windows Hello) | Correct |
| `webAuthnPolicyPasswordlessRequireResidentKey` | `"Yes"` | Discoverable credential for passwordless login | Correct |
| `webAuthnPolicyPasswordlessUserVerificationRequirement` | `"required"` | Biometric/PIN verification required | Correct |
| `webAuthnPolicyPasswordlessRpId` | `""` | Must be `"localhost"` | **FIX REQUIRED (D-02)** |

### 4.3 Browser Flow — Informational (OUT OF SCOPE)

The realm-export.json defines a complete `browser-passkey` custom flow (lines 132–180) with `webauthn-authenticator-passwordless` as a REQUIRED execution. However, `"browserFlow": "browser"` (line 183) means the standard browser flow is active, not the passkey flow. Activating passkey login requires pointing `browserFlow` at the custom flow — documented here for the future deferred-passkey-login phase. Out of scope per CONTEXT.md.

### 4.4 Required Action: Webauthn Register Passwordless

For `webauthn-register-passwordless` AIA to work, the "Webauthn Register Passwordless" required action must be enabled in the realm. This cannot be set via realm-export.json in KC 25 — but in KC 26, required actions **can** be included in realm export under `"requiredActions"`. [ASSUMED — based on KC 26 realm import docs; needs runtime verification]

**Risk:** If the required action is not enabled, `keycloak.login({ action: 'webauthn-register-passwordless' })` will fail silently (redirect back without error). The planner should include a verification step: after container start, check Keycloak admin UI → Authentication → Required Actions for "Webauthn Register Passwordless" = enabled.

---

## 5. Realm Import in KC 26 Docker-Compose

### 5.1 Import Mechanism — Unchanged

```yaml
command: start-dev --import-realm
volumes:
  - ./realm-export.json:/opt/keycloak/data/import/realm-export.json
```

This works in KC 26 identically to KC 25. The `--import-realm` flag causes Keycloak to read all `.json` files in `/opt/keycloak/data/import/` at startup. If the realm already exists (e.g., from a previous container run), the import is skipped — existing data is not overwritten. [CITED: keycloak.org/server/importExport, community docker-compose examples for KC 26]

**To force re-import after realm-export.json changes:** `docker compose down -v` (removes the postgres_data volume) then `docker compose up`. The missing `-v` flag is the most common developer mistake.

### 5.2 Environment Variable Update Recommended

| Current (docker-compose.yml) | Recommended for KC 26 | Action |
|------------------------------|----------------------|--------|
| `KEYCLOAK_ADMIN: admin` | `KC_BOOTSTRAP_ADMIN_USERNAME: admin` | Update in same commit as image tag bump |
| `KEYCLOAK_ADMIN_PASSWORD: admin` | `KC_BOOTSTRAP_ADMIN_PASSWORD: admin` | Update in same commit as image tag bump |

### 5.3 Dockerfile Dead Code

`keycloak/Dockerfile` performs a multi-stage build with `kc.sh build` (for production optimization) but is **not referenced** by `keycloak/docker-compose.yml` — docker-compose pulls the official image directly. The Dockerfile exists for a potential production build path. The D-01 Dockerfile tag update is correct but has no effect on local `docker compose up`. The planner should note this: Dockerfile bump is correct for completeness but does not affect local dev testing.

---

## 6. Implementation Risks and Gotchas

### Risk 1: Re-import Doesn't Fire (CRITICAL)
**What:** KC silently skips import if the realm already exists. After changing realm-export.json (D-02), a simple `docker compose restart` or `docker compose up` will NOT apply the RP ID change.
**Mitigation:** Plan must include `docker compose down -v && docker compose up` as the verification step after D-02. Document this prominently.
**Warning sign:** Passkey registration still fails with "InvalidStateError" or browser rejects the RP ID.

### Risk 2: Required Action Not Enabled
**What:** If "Webauthn Register Passwordless" is not in the realm's enabled required actions, `keycloak.login({ action: 'webauthn-register-passwordless' })` redirects back without registering or showing an error.
**Mitigation:** After fresh container start, manually verify in Keycloak admin UI → Authentication → Required Actions.
**Warning sign:** Clicking "Add passkey" redirects to Keycloak and immediately redirects back to profile page.

### Risk 3: DELETE Endpoint Deprecated — Future Removal Risk
**What:** `DELETE /account/credentials/{id}` is deprecated in KC 26. It works now but may be removed in a future KC version.
**Mitigation:** For this phase, use it per D-05. Add a TODO comment in profile.ts noting the deprecation and the AIA alternative (`keycloak.login({ action: 'delete_credential:{id}' })`).
**Impact if ignored:** Breaking change in a future KC upgrade.

### Risk 4: keycloak-js TypeScript Surface Changes
**What:** `Keycloak.KeycloakTokenParsed` namespace usage in keycloak.ts line 132 (`getTokenParsed()` return type) may fail TypeScript compilation after upgrading from 25 to 26.2.4.
**Mitigation:** Run `npm run typecheck` immediately after `npm install keycloak-js@^26.0.0`. Fix any errors before proceeding.
**Warning sign:** `error TS2307: Cannot find module 'keycloak-js'` or `error TS2339: Property 'KeycloakTokenParsed' does not exist on type 'typeof Keycloak'`.

### Risk 5: Admin Env Var Deprecation Warnings in Logs
**What:** KC 26 logs warnings for `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`. Not a blocker but noisy.
**Mitigation:** Update docker-compose.yml to `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` in the same commit.

### Risk 6: Delete Button Data Attribute Must Match Credential ID
**What:** The delete button reads `data-credential-id` from the DOM. If the credential `id` from the API is not stored correctly on the `<li>` element, the DELETE call sends the wrong ID (or undefined).
**Mitigation:** Store `c.id` on the `<li>` element as `data-credential-id="${c.id}"` and read it in the click handler with `el.dataset.credentialId`. Validate non-empty before calling DELETE.

---

## 7. Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 |
| Config | `frontend/package.json` scripts (`test`, `test:run`) |
| Quick run | `npm run test:run` |
| Full suite | `npm run test:run -- --coverage` |
| Typecheck | `npm run typecheck` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| PASS-01 | `registerPasskey()` calls `keycloak.login` with `action: 'webauthn-register-passwordless'` | Unit | `npm run test:run -- --reporter=verbose` | Mock `keycloak.login`, assert action string |
| PASS-02 | `webAuthnPolicyPasswordlessRpId` is `"localhost"` in realm-export.json | Config check | `node -e "const r=require('./keycloak/realm-export.json'); console.assert(r.webAuthnPolicyPasswordlessRpId==='localhost')"` | Can be run from project root |
| PASS-03 | Delete button fires `DELETE /account/credentials/{id}` with correct ID and Bearer token | Unit + Manual | Unit: mock fetch, assert URL and headers; Manual: verify in browser DevTools Network tab | Full passkey delete requires live Keycloak — unit tests cover the JS logic |

### Per-Requirement Verification Commands

**PASS-01 — Config check (no Keycloak needed):**
```bash
grep "webauthn-register-passwordless" frontend/src/pages/profile.ts
# Expected: one match in registerPasskey()
```

**PASS-02 — Realm-export field check:**
```bash
node -e "const r=require('./keycloak/realm-export.json'); const v=r.webAuthnPolicyPasswordlessRpId; console.log('RP ID:', v); process.exit(v==='localhost' ? 0 : 1);"
```

**PASS-03 — Source check:**
```bash
grep "DELETE" frontend/src/pages/profile.ts
grep "credentials/\${" frontend/src/pages/profile.ts
```

### End-to-End Verification (Manual, requires running Keycloak)

1. `docker compose down -v && docker compose up -d` (fresh import of updated realm-export.json)
2. Navigate to `http://localhost:5173/profile.html` and log in
3. Click "Add passkey" → browser prompts for biometric → redirect back
4. **Verify A1b:** Open browser DevTools → Network → look for `GET /account/credentials?type=webauthn-passwordless` response; confirm the new credential appears with `"type": "webauthn-passwordless"` (not `"webauthn"`). This validates that D-03 + D-04 together show the passkey in the list. (PASS-01 + PASS-02)
5. Click delete button next to passkey → confirmation modal appears → confirm → passkey disappears from list (PASS-03)

### Wave 0 Gaps

No new test files required for this phase — the changes are configuration and DOM-wiring. The planner may optionally add a unit test for `loadPasskeys()` to verify the type filter (D-04) and delete URL construction (D-05), but no test infrastructure changes are needed.

---

## Open Questions (RESOLVED)

1. **Is "Webauthn Register Passwordless" required action already enabled in the imported realm?**
   - What we know: realm-export.json does not include a `requiredActions` section.
   - What's unclear: Whether KC 26 auto-enables this action, or whether it must be manually enabled in admin UI after import.
   - **RESOLVED:** Cannot be guaranteed via realm-export.json import. Documented as a manual verification checkpoint in Plan 04-01 `<verification>` block: after fresh container start, check Keycloak admin UI → Authentication → Required Actions → confirm "Webauthn Register Passwordless" is enabled. If not, enable it manually. Plan executor must perform this check before testing passkey registration.

2. **Is `keycloak.tokenParsed` (return type `Keycloak.KeycloakTokenParsed`) still the correct namespace access after keycloak-js 26.2.4?**
   - What we know: TypeScript issues existed at 26.0.0; were resolved in patches. Project uses `moduleResolution: bundler`.
   - What's unclear: Whether the namespace `Keycloak.KeycloakTokenParsed` still exists or was renamed.
   - **RESOLVED:** Plan 04-01 Task 2 runs `npm run typecheck` immediately after `npm install keycloak-js@^26.0.0` as a hard gate before any new code is written. If the namespace fails, Task 2 action documents the fix: adjust the type from `Keycloak.KeycloakTokenParsed` to `KeycloakTokenParsed` (named import). The answer is determined at execution time by the typecheck output.

---

## Sources

### Primary (HIGH confidence)
- [Keycloak 26.0.0 Release Notes](https://www.keycloak.org/2024/10/keycloak-2600-released) — admin env var deprecation, keycloak-js standalone, hostname v1 removal
- [Keycloak Upgrading Guide (latest)](https://www.keycloak.org/docs/latest/upgrading/index.html) — 26.x breaking changes per version
- [Keycloak JavaScript Adapter Docs (26.6.1)](https://www.keycloak.org/securing-apps/javascript-adapter) — init(), login(), all options
- [AccountCredentialResource Javadoc 26.6.1](https://www.keycloak.org/docs-api/latest/javadocs/org/keycloak/services/resources/account/AccountCredentialResource.html) — DELETE deprecated, GET and PUT present
- [npm registry: keycloak-js](https://www.npmjs.com/package/keycloak-js) — latest 26.x = 26.2.4 (VERIFIED via `npm view keycloak-js dist-tags`)

### Secondary (MEDIUM confidence)
- [Keycloak JS 26.2.0 Released](https://www.keycloak.org/2025/02/keycloak-js-2620-released) — independent release cycle, backwards compat
- [Keycloak Running in Containers](https://www.keycloak.org/server/containers) — KC_BOOTSTRAP_ADMIN_USERNAME, --import-realm
- [Keycloak Passkeys Support 26.4](https://www.keycloak.org/2025/09/passkeys-support-26-4) — KC 26.3+ native passkeys UI
- [Delete Credential AIA documentation commit](https://github.com/keycloak/keycloak/commit/5b521173518a80b9ce87ae8fd48bb13e86a657ca) — kc_action=delete_credential:{id} pattern
- [KC docker-compose 24→26 upgrade discussion](https://github.com/keycloak/keycloak/discussions/33983) — env var changes confirmed

### Tertiary (LOW confidence / needs runtime validation)
- [keycloak-js TypeScript issue #34002](https://github.com/keycloak/keycloak/issues/34002) — resolved in 26.0.x patch (marked LOW: closed-as-not-planned)
- [keycloak-js destructuring bug #202](https://github.com/keycloak/keycloak-js/issues/202) — does not affect this project

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1a | `webAuthnPolicyPasswordlessRpId` field name unchanged in KC 26 | §4.1 | Planner targets wrong field name in realm-export.json; passkey registration fails |
| A1b | Credentials registered via `webauthn-register-passwordless` surface as `type: "webauthn-passwordless"` in GET /account/credentials response | §3.1, §4 | D-04 type filter still returns empty after registration; PASS-01 and PASS-03 untestable since list stays blank |
| A2 | GET `/account/credentials?type=webauthn-passwordless` response shape unchanged | §3.1 | `CredentialInfo` interface mismatch; list fails to render or shows wrong data |
| A3 | DELETE `/account/credentials/{id}` still accepts Bearer token (not just deprecated API surface) | §3.2 | Delete fails with 405 or 410; need to implement AIA approach instead |
| A4 | keycloak-js 26.2.4 TypeScript namespace `Keycloak.KeycloakTokenParsed` still accessible | §2.7 | typecheck fails; keycloak.ts line 132 needs import adjustment |
| A5 | "Webauthn Register Passwordless" is NOT auto-enabled in realm import (must be verified manually) | §4.4 | AIA action silently fails; registration appears to do nothing |

**Runtime verification for A1b:** After `docker compose down -v && docker compose up` and a fresh passkey registration, run:
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/realms/japan-trip/account/credentials | jq '.[].type'
# Expected: "webauthn-passwordless"
```

---

## RESEARCH COMPLETE

**Phase:** 04 - Passkeys
**Confidence:** MEDIUM

### Key Findings

1. **keycloak-js latest 26.x is 26.2.4** — not 26.6.x. `npm install keycloak-js@^26.0.0` installs 26.2.4. This is correct and server-compatible per Keycloak's independent release cycle commitment. The CONTEXT.md `^26.0.0` constraint resolves to this version.

2. **Admin env vars deprecated** — `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` still work in KC 26 but emit deprecation warnings. Update docker-compose.yml to `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` in the same wave as the image tag bump.

3. **DELETE credential endpoint deprecated but functional** — `DELETE /account/credentials/{id}` works in KC 26.6.1 but is marked `@Deprecated`. D-05 is safe to implement as specified. Add a TODO comment noting the AIA alternative for future upgrades.

4. **`docker compose down -v` is mandatory** after changing realm-export.json — simply restarting the container does not re-import an existing realm. This must be in the plan's verification steps.

5. **`npm run typecheck` must run immediately after npm upgrade** — keycloak-js 25→26 had TypeScript breaking changes at 26.0.0 (resolved in patches). Verify compilation before writing any new code.

### File Created
`.planning/phases/04-passkeys/04-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| KC 25→26 server changes | HIGH | Official release notes + upgrading guide |
| Admin env var changes | HIGH | Multiple official sources confirm deprecation |
| keycloak-js 26.2.4 API | MEDIUM | Official docs confirm API stability; TypeScript surface needs runtime confirmation |
| Account REST API DELETE | MEDIUM | Javadoc confirms deprecated-not-removed; runtime behavior not tested |
| WebAuthn field names | MEDIUM | Field name unchanged; value behavior inferred from spec + community |
| Realm import mechanism | HIGH | Official containers doc + community confirms unchanged |

### Open Questions Remaining

- Whether "Webauthn Register Passwordless" required action is auto-enabled in KC 26 realm import (A5)
- Whether `Keycloak.KeycloakTokenParsed` namespace access still valid in keycloak-js 26.2.4 (A4) — answered by running `npm run typecheck`
