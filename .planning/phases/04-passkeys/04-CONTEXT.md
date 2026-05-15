---
name: 04-CONTEXT
description: Phase 4 Passkeys — implementation decisions for Keycloak upgrade + WebAuthn config + delete passkey UI
type: project
---

# Phase 4: Passkeys — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade Keycloak to 26.6.1, configure WebAuthn Passwordless correctly in realm-export.json, fix the passkey registration action string, fix the credential type filter bug, and add delete passkey UI to the profile page. All three PASS requirements closed in this phase.

</domain>

<decisions>
## Implementation Decisions

### Keycloak server version (supersedes PROJECT.md constraint)

- **D-01:** Upgrade Keycloak from 25.0 to **26.6.1**.
  - `keycloak/docker-compose.yml`: `quay.io/keycloak/keycloak:25.0` → `quay.io/keycloak/keycloak:26.6.1`
  - `keycloak/Dockerfile`: both `FROM` lines → `quay.io/keycloak/keycloak:26.6.1`
  - `frontend/package.json`: `"keycloak-js": "^25.0.0"` → `"^26.0.0"` (install latest 26.x)
  - The PROJECT.md constraint "Must stay at 25.0" is superseded by this explicit decision.
  - The `start-dev --import-realm` flag still works in KC 26 — no command changes needed.
  - The Account REST API path `/realms/${realm}/account/credentials` still exists in KC 26.

### webAuthnPolicyPasswordlessRpId (PASS-02)

- **D-02:** Set `webAuthnPolicyPasswordlessRpId` to `"localhost"` directly in `keycloak/realm-export.json`.
  - Local dev Docker Compose auto-imports this — passkeys work on first boot without running any script.
  - Production Keycloak on Railway: the domain must be set separately (Keycloak admin UI or a prod-specific realm export). This is a deployment step, not a Phase 4 code deliverable — document as a manual checkpoint in the plan.
  - `webAuthnPolicyRpId` (the non-passwordless policy) remains `""` — it is not used by the passwordless flow.

### Passkey registration action string (PASS-01)

- **D-03:** Change `action: 'webauthn-register'` → `action: 'webauthn-register-passwordless'` in `frontend/src/pages/profile.ts` (the `registerPasskey()` function, currently line 104).
  - `webauthn-register` targets the standard WebAuthn policy; `webauthn-register-passwordless` targets the Passwordless policy where the RP ID and resident-key settings are configured.

### Passkey credential type filter bug

- **D-04:** Change the passkey list filter from `c.type === 'webauthn'` → `c.type === 'webauthn-passwordless'` in `frontend/src/pages/profile.ts` (`loadPasskeys()`, currently line 68).
  - Credentials registered with `webauthn-register-passwordless` appear with type `webauthn-passwordless` in the Account REST API response.
  - This is why the list always shows "No tenés passkeys registrados todavía" even after a successful registration.

### Delete passkey UI (PASS-03)

- **D-05:** Add an inline delete button per passkey row and a confirmation overlay/modal before calling DELETE.
  - Each `<li class="passkey-item">` gets a delete button (`.btn-icon` or `.btn-danger` small) alongside the passkey info.
  - Clicking delete shows a confirmation overlay (same `.overlay`/`.modal` CSS pattern established in Phase 2). Button labels: "Cancelar" + "Eliminar".
  - On confirm: `DELETE /realms/${KEYCLOAK_REALM}/account/credentials/${credential.id}` with Bearer token.
  - On success: call `loadPasskeys()` to refresh the list.
  - The credential `id` must be stored on the DOM element (e.g., `data-credential-id` attribute) so the handler can read it.

### Claude's Discretion

- Exact markup for the delete confirmation modal — follow the `.overlay`/`.modal` pattern; reuse existing CSS classes
- Whether to inline the modal HTML in profile.html or build it dynamically in profile.ts — dynamic (as in Phase 2) is preferred to avoid HTML duplication
- keycloak-js 26.x exact patch version to install — use `npm install keycloak-js@^26.0.0` (latest stable 26.x)
- Whether KC 26 browser flow needs the WebAuthn Passwordless authenticator added — this is a Keycloak admin UI step that cannot be done via realm-export.json at import time; document as a manual verification step

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Goals
- `.planning/REQUIREMENTS.md` — PASS-01, PASS-02, PASS-03 definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 4 — three success criteria that define done

### Files to Modify
- `keycloak/docker-compose.yml` — Keycloak image tag: `25.0` → `26.6.1`
- `keycloak/Dockerfile` — both FROM lines: `25.0` → `26.6.1`
- `keycloak/realm-export.json` — set `webAuthnPolicyPasswordlessRpId` to `"localhost"` (currently `""`)
- `frontend/package.json` — `keycloak-js: "^25.0.0"` → `"^26.0.0"`
- `frontend/src/pages/profile.ts` — three changes:
  - `registerPasskey()`: action string `webauthn-register` → `webauthn-register-passwordless`
  - `loadPasskeys()`: type filter `c.type === 'webauthn'` → `c.type === 'webauthn-passwordless'`
  - `loadPasskeys()`: add delete button per item + wired DELETE call + modal confirm

### Existing Code to Understand Before Editing
- `frontend/src/pages/profile.ts` — full file; 181 lines; passkey list at lines 50-97, register at 99-112
- `keycloak/realm-export.json` — top-level realm object; `webAuthnPolicyPasswordlessRpId` at line 42
- `keycloak/apply-local-settings.sh` — not modified; for reference on admin API pattern if needed
- `frontend/src/pages/dashboard.html` — source of the `.overlay`/`.modal` pattern to reuse for delete confirm

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Passkey Bugs (confirmed by code inspection)
1. Wrong registration action: `action: 'webauthn-register'` → produces a non-passwordless credential
2. Wrong type filter: `c.type === 'webauthn'` → filters OUT passwordless creds (which are `webauthn-passwordless`)
3. Empty RP ID: `webAuthnPolicyPasswordlessRpId: ""` → browser WebAuthn API will reject registration

### Reusable Assets
- `.overlay`/`.modal` CSS (from dashboard.html and trip-edit.html) — delete confirmation dialog
- `keycloak.token` from the imported `keycloak` instance — used as Bearer token in Account REST API calls
- `showStatus()` helper already in profile.ts — reuse for delete success/error feedback

### Keycloak Account REST API (KC 26 verified paths)
- List credentials: `GET /realms/${realm}/account/credentials?type=webauthn-passwordless`
- Delete credential: `DELETE /realms/${realm}/account/credentials/${id}` (Bearer token required)
- Response shape: `[{ id: string, type: string, userLabel?: string, createdDate?: number }]`

### Integration Notes
- After `npm install keycloak-js@^26.0.0`, run `npm run typecheck` to catch any keycloak-js API surface changes
- KC 26 realm import via `start-dev --import-realm` is unchanged — no docker-compose command changes
- `frontend/src/auth/keycloak.ts` uses `keycloak.init()`, `keycloak.login()`, `keycloak.updateToken()` — all stable across KC 25→26 in keycloak-js

</code_context>

<deferred>
## Deferred Ideas

- Production RP ID configuration for Railway Keycloak — deployment step, not Phase 4 code
- Rename passkey (PUT credentials/{id}/label) — deferred to next milestone per STATE.md
- Passkey login browser flow configuration (adding WebAuthn Passwordless to the browser flow in Keycloak admin) — this is a manual Keycloak admin step; document as a verification note in the plan but not a code deliverable
- `email` field typed as required but absent in passkey-only flows — noted in STATE.md blockers; address in a future phase

</deferred>

---

*Phase: 04-passkeys*
*Context gathered: 2026-05-06*
