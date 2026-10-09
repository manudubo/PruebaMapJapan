# Passkey-first sign-in

Request: if this browser has been used with a passkey for the realm, the login page
asks for the passkey at once, without a username. The user can cancel and use another
account, or e-mail and password.

Verified against Keycloak 26.6.1 (local, Chromium CDP virtual authenticator). Not verified
on real devices (see the end).

## What Keycloak 26.6.1 offers (evidence)

| Option | Result |
|---|---|
| Realm "passkeys" (`webAuthnPolicyPasswordlessPasskeysEnabled`, feature `passkeys` is on by default) | Username Form renders conditional UI (`enableWebAuthnConditionalUI`); a passkey answer posted to it identifies the user from the user handle and validates the assertion with the passwordless policy (UV required). **Chosen.** |
| `passkeys-authenticator` ("Passkeys Conditional UI Authenticator") | Behind feature `passkeys-conditional-ui-authenticator`, logged as deprecated. Not used. |
| `webauthn-authenticator-passwordless` as first alternative | Would show a passkey page to everybody before any username. Rejected. |

The terraform provider only gained the switch in 5.8.0 (`passwordless_passkeys_enabled`).
Keycloak keeps the existing value when a request omits it, so older tooling does not reset it.

### Two findings that shaped the flow

1. After a passkey answer on the username page the flow continued to the credential
   step and asked for the passkey again (two Face ID prompts). Fix: an extra ALTERNATIVE
   branch `passkey-done` in the credential step: `conditional-credential`
   (`webauthn-passwordless`, included) then `allow-access-authenticator`.
2. Do not make the credential step CONDITIONAL: Keycloak skips a CONDITIONAL subflow
   that has no condition, so a bare username got an authorization code in the window
   between two API calls (reproduced). The extra branch is fail-closed at every step.
   Order inside it matters: with `allow-access` first, Keycloak's selection resolver
   swaps in the WebAuthn authenticator and the second prompt returns.

`tests/e2e/idp-config.spec.ts` pins both; `idp-passkey-first.spec.ts` (h) posts forged
assertions and a bare username and expects no code. `contracts/auth-flows.json` is the
e-mail code contract and does not change.

## Device memory (the marker)

`localStorage["jp.passkey.<realm>"] = {"v":1,"t":<ms of last passkey use>,"m":<dismissals>}`

- Says only "a passkey was used here". No user name, id, e-mail or credential id; a
  test (g) checks every storage and cookie for the account's identifiers, and any extra
  field makes a marker invalid.
- Set when a passkey answer is posted (`#webauth` submit: autofill, button, auto prompt,
  credential step) or a passkey is enrolled (`#register` submit).
- Lifetime 180 days from the last use; a miss does not extend it. Expired or corrupt
  values are ignored and removed.
- Cleared: by "Use another account" followed by a sign-in with that account's own
  credentials; after two dismissed automatic prompts in a row (a deleted passkey looks
  like a cancel: browsers do not distinguish, so the count stands in for "no credential");
  when the server rejects the posted answer (error page of the same attempt).
- Why localStorage and not a cookie: never sent to the server, no `Secure`/path
  fiddling on http localhost, and WebKit's 7-day cap on script-written storage resets
  when the user interacts with the site, while `document.cookie` is capped at 7 days
  regardless. The cost of a lost marker is only the normal page (autofill still works).
- Storage off or throwing (private mode, blocked data): nothing is remembered, nothing
  breaks.

## Behaviour

Marker absent: username form, e-mail field with `autocomplete="username webauthn"`
(autofill), and a "Sign in with a passkey" button (no prompt of its own).

Marker present, and all of: plain sign-in page (no message shown), top-level frame,
`PublicKeyCredential` present, `isUserVerifyingPlatformAuthenticatorAvailable()`,
fresh navigation (not reload/back-forward), first prompt of this login attempt
(`tab_id` of the form action, kept in sessionStorage): the panel replaces the form and
the browser asks. Otherwise the plain page.

- Cancel / `NotAllowedError` / `AbortError`: status "cancelled" (polite live region),
  focus on "Continue with passkey", form shown, autofill restarted. No loop, no new
  prompt on reload or back.
- Unsupported / blocked: message, form usable, no miss counted.
- Never on sign-up, recovery, error pages, in iframes, or when a message is shown. After
  logout the prompt does appear again (the user can cancel); UV is always required.
- A device without WebAuthn is never prompted; the footer's e-mail recovery for
  passkey-only users is untouched.
- Cancelling the "Sign in with a passkey" button or the panel does not post an error to
  the server (Keycloak's own script would show an error page).
- Background tab: waits until visible. 44px targets, 16px gutters, reduced motion
  respected, no inline script (module files, data attributes), no positive `tabindex`
  on this page. Without JavaScript it is the plain form.

## Per browser (what is and is not known)

| Browser | Expected | Status |
|---|---|---|
| Chrome/Edge desktop and Android | `get()` without a user gesture is allowed, modal sheet; `immediate` mediation used only if `getClientCapabilities().immediateGet` | Chromium with a virtual authenticator only |
| Safari macOS/iOS | May require a user gesture for a modal `get()`; then the auto prompt is rejected and the panel shows the "Continue with passkey" button (one tap). 7-day storage cap | **Not tested** |
| Firefox | Platform passkeys limited; falls back to the plain page when no platform authenticator | **Not tested** |

Immediate mediation names (`immediateGet`) are from the draft proposal; if absent the
modal prompt runs, so a missing passkey looks like a cancel and the two-miss rule applies.

## Tests

- `idp-passkey-first-unit.spec.ts`: marker set/read/expire/clear/corrupt, storage off or
  throwing, Safari-like expiry, decision table, error classes, tab gate, WebAuthn
  request/response.
- `idp-passkey-first-static.spec.ts`: template contract, CSP-friendliness, no cookies,
  network or HTML injection, nothing identifying in the memory module.
- `idp-passkey-first-render.spec.ts`: real server HTML plus the real script with a
  WebAuthn stand-in; plain/prompting/dismissed, light/dark, 375/1280, axe, contrast,
  iframe, reload, no WebAuthn, corrupt marker, blocked storage, keyboard.
- `idp-passkey-first.spec.ts`: live Keycloak, virtual authenticator: (a) autofill sign-in
  sets the marker, (b) auto prompt, no username posted, one POST, (c) cancel without
  loop, (d) another account clears it, (e) credential gone / revoked, (f) no WebAuthn,
  (g) privacy, (h) forged assertions.
- `idp-flow.spec.ts` typed-username cases now run on a browser without autofill and
  memory (a virtual authenticator otherwise signs in on load).

Screenshots: `.planning/qa/screens-theme/passkey-first/`.

## Not verified

Real Face ID/Touch ID/Android biometrics, real Safari and iOS gesture rules, ITP expiry
timing, hybrid (QR) passkeys, the `immediate` mediation, and the account console's own
passkey registration (account theme: it does not set the marker).
