---
status: partial
phase: 04-passkeys
source: [04-VERIFICATION.md]
started: 2026-05-07T23:30:00Z
updated: 2026-05-07T23:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Force realm re-import and verify Required Action
expected: Run `docker compose down -v && docker compose up -d` from `keycloak/`. In KC admin UI (http://localhost:8080/admin) → japan-trip realm → Authentication → Required Actions → "Webauthn Register Passwordless" is Enabled. If not, enable manually.
result: [pending]

### 2. Passkey registration flow
expected: Log in at http://localhost:5173/profile.html, click "Agregar passkey". Browser WebAuthn prompt appears, credential registers, passkey appears in the list. DevTools Network shows `GET /account/credentials?type=webauthn-passwordless` returning an entry with `type="webauthn-passwordless"`. Validates D-03 + D-04 together.
result: [pending]

### 3. Delete passkey flow
expected: With a registered passkey visible in the list, click "Eliminar". Confirm overlay appears with "Cancelar" and "Eliminar" buttons. Clicking "Cancelar" closes overlay, list unchanged. Clicking "Eliminar" then confirming sends DELETE to KC and passkey disappears from the list on refresh. Validates PASS-03.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
