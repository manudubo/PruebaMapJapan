# Features Research — v2.0 Auth Infrastructure & Hardening

**Domain:** Keycloak 26.6.1 auth flows, IaC, E2E testing
**Researched:** 2026-05-15
**KC version confirmed:** 26.6.1 (quay.io/keycloak/keycloak:26.6.1, docker-compose.yml line 21)

---

## Passkey Campaign

### What it is
Post-login or post-registration screen offering the user passkey registration on the current device. Per-user, per-device opt-out stored in a client-side cookie (`pnk_{userId}`).

### Table Stakes
| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| AIA trigger via `kc_action` | Required to invoke `webauthn-register-passwordless` after login | Low | Already working in profile.ts via `keycloak.login({action: ...})` |
| Skip-if-already-registered | User who did register should not see the prompt | Low | KC 26.3+ supports `kc_action=webauthn-register-passwordless:skip-if-exists`. Use this before the per-device cookie check. |
| Decline cookie (`pnk_{userId}`) | Respect user's "not now" choice for some period | Low-Medium | Cookie is scoped per browser-profile — that IS the device identifier. No extra fingerprint needed. |

### Differentiators
| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Per-device opt-out with expiry (e.g., 30 days) | Does not pester user on same device after decline | Low | Cookie `pnk_{userId}` with `max-age`; `SameSite=Strict` |
| Campaign on FIRST post-login only, not repeated | UX pattern seen in Apple/Google passkey onboarding | Low | Enabled by the cookie + `skip-if-exists` combo |

### Anti-features (avoid)
| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Device fingerprinting beyond the cookie | The cookie IS the device signal; adding UA/canvas fingerprinting adds complexity with no auth security benefit | Store only `pnk_{userId}` with expiry |
| Forcing passkey at registration | Friction — users on corporate/shared devices cannot register a device passkey | Make it optional / post-login campaign |
| Storing `userId` in the cookie before auth completes | userId is unavailable before the ID token is received; cookie can only be written post-login | Write cookie after `initKeycloak()` resolves with `authenticated=true` |

### Dependencies on existing KC config
- `webauthn-register-passwordless` Required Action is registered in realm (confirmed via profile.ts `action: 'webauthn-register-passwordless'`)
- `webAuthnPolicyPasswordlessRpId` is `"localhost"` — must be updated to production hostname before passkey campaign works in prod (Railway/GitHub Pages domain)

---

## Email OTP Fallback

### What it is
User whose only credential is a passkey, logging in from a device that doesn't support WebAuthn, gets an email OTP challenge. After passing OTP, they are forced to create a password (`UPDATE_PASSWORD` Required Action) so they have a non-passkey fallback.

### Table Stakes
| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| Fallback path when passkey unavailable | Passkey-only users would be locked out on iOS Safari older versions, Android Chrome without biometrics, etc. | HIGH | **KC 26 has no built-in email OTP authenticator** — requires a third-party SPI extension deployed to `/providers/` (see below) |
| Conditional branch in auth flow | Only trigger email OTP when WebAuthn challenge fails/is unavailable | Medium | Requires custom flow: CONDITIONAL sub-flow checking credential type |
| `UPDATE_PASSWORD` required action after OTP | Enforce password creation so user is not passkey-only | Low | KC native; assign via Admin API or Required Action in flow |

### Differentiators
| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Single-use OTP code (6 digits, 5-min TTL) | Standard email OTP UX pattern | Medium | Depends on SPI extension choice |
| Custom KC FreeMarker template for OTP entry | Branded screen matching `japan-trip` theme | Low | Extend existing theme |

### Anti-features (avoid)
| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Sending OTP via SMS | Cost, complexity, no benefit over email for this app | Email OTP only |
| Allowing indefinite email-OTP-only auth | Becomes a permanent weaker second factor; defeats passkey goal | Force `UPDATE_PASSWORD` after first successful OTP |

### CRITICAL — Email OTP is NOT native to Keycloak 26
Keycloak 26 does not ship a built-in email OTP authenticator. Options:

1. **`for-keycloak/email-otp-authenticator`** — community SPI, active maintenance, drops a `.jar` in `/providers/`. Simplest path.
2. **`mesutpiskin/keycloak-2fa-email-authenticator`** — older, widely cited, but last commits less recent.
3. **Custom SPI** — full control, no external dependency, but 2-3 days of implementation.

**Recommendation:** Use `for-keycloak/email-otp-authenticator` for v2.0; plan to either vendor it or write own SPI in a v3. Adds supply-chain risk and makes the Docker image non-standard — a custom `Dockerfile` is required to copy the `.jar` into `/opt/keycloak/providers/`. This is a meaningful deployment complexity increase.

### Dependencies on existing KC config
- SMTP must be configured in realm settings (currently not in realm-export.json — needs `smtpServer` block)
- The `browser-passkey` flow must be extended with a conditional sub-flow after the WebAuthn step
- `browserFlow` in realm is currently `"browser"` (standard), not `"browser-passkey"` — switching it is part of KC Flow Configuration below

---

## Email Verification

### What it is
`VERIFY_EMAIL` Required Action triggers after registration, sending a verification link before the user can access the app.

### Table Stakes
| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| Email verification on registration | Standard for any auth system with email | Low | Add `VERIFY_EMAIL` as default Required Action in realm |
| Friendly "check your email" screen | User must know what to do | Low | Built-in KC FreeMarker template `verify-email.ftl` |
| Resend verification email link | Users who didn't get the email | Low | Built into KC's verify-email screen natively |

### Differentiators
| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Branded verify-email FreeMarker template | Consistent with `japan-trip` theme | Low | Override `verify-email.ftl` in theme |

### Anti-features (avoid)
| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Email verification blocking passkey registration | If VERIFY_EMAIL fires BEFORE `webauthn-register-passwordless` Required Action, the two Required Actions can conflict | Order Required Actions: VERIFY_EMAIL first in priority, webauthn-register-passwordless second |

### KNOWN BUG — KC issue #41171 (HIGH severity for this feature)
When `VERIFY_EMAIL` fires during an OIDC registration flow and the user clicks the verification link in a different tab or browser session, the original OIDC session expires, resulting in `authentication_expired` error. The user cannot complete registration. Affects KC 26.x (confirmed open issue).

**Mitigation options:**
1. Increase `accessCodeLifespanUserAction` from current 300s — consider 900-1800s in realm-export.json line 28.
2. Use `RedFroggy/keycloak-verify-email-by-code` SPI (6-digit code instead of link) — avoids cross-session problem entirely, but adds another third-party SPI.
3. Document as known UX issue for v2.0, fix in v3.

---

## KC Flow Configuration

### What it is
Making `browser-passkey` the default browser flow, replacing the built-in `browser` flow. Currently `browserFlow: "browser"` in realm-export.json line 197.

### Table Stakes
| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| `browser-passkey` set as `browserFlow` in realm | Required for passkey-first login UX | Low | Change `"browserFlow": "browser-passkey"` in realm config / Terraform |
| `webAuthnPolicyPasswordlessRpId` updated to production domain | Passkeys are domain-bound; `"localhost"` won't work in prod | Low | Must match Railway/GitHub Pages hostname |
| `webAuthnPolicyPasswordlessAuthenticatorAttachment: "platform"` (already set) | Passkeys on device biometrics, not hardware keys | None | Already correct in realm-export.json |
| `webAuthnPolicyPasswordlessRequireResidentKey: "Yes"` (already set) | Required for discoverable credentials (passkeys) | None | Already correct |

### Differentiators
| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Conditional passkey UI (KC 26.4+ feature) | Passkey prompt appears automatically in browsers supporting conditional mediation | Low | Enabled by default in KC 26.4+ once flow is set; no custom code needed |
| Re-authentication via passkey | Works natively once `browser-passkey` is default flow | None | KC 26.4+ includes re-auth passkey support |

### Anti-features (avoid)
| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Custom WebAuthn UI JavaScript | KC 26.4+ handles conditional/modal UI natively in the default forms | Use KC built-in flow; no custom WebAuthn JS needed |
| Keeping `browser` as default flow | Passkeys never shown during login | Switch to `browser-passkey` |

### Dependencies on existing KC config
- `passkey-forms` sub-flow is defined with `auth-username-form` + `webauthn-authenticator-passwordless` both REQUIRED — correct for passkey-first
- `browser-passkey` top-level flow has `auth-cookie` (ALTERNATIVE) and `passkey-forms` (ALTERNATIVE) — needs `ALTERNATIVE` for the email OTP sub-flow when added
- Email OTP fallback requires adding a CONDITIONAL sub-flow to `passkey-forms` after the WebAuthn step

---

## Error Handling & KC Theme Localization

### What it is
Spanish (and English) user-facing error messages for all KC error types — invalid credentials, brute-force lockout, WebAuthn failures, email verification, etc.

### Table Stakes
| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| `messages_es.properties` in `keycloak/themes/japan-trip/login/messages/` | Realm `loginTheme: "japan-trip"` already set; `messages/` directory does not exist yet | Low | Theme dir at `keycloak/themes/japan-trip/login/` exists (CSS + theme.properties) but no messages subdir |
| Friendly messages for key error keys | `invalidUserMessage`, `accountTemporarilyDisabledMessage`, `accountPermanentlyDisabledMessage`, `webauthn-error-*` | Medium | Source files: `messages_es.properties` in `resources-community`, `messages_en.properties` in `resources` |
| `theme.properties` declares `locales=es,en` | Enables i18n in the `japan-trip` theme | Low | Currently missing from `theme.properties` (only has `parent`, `import`, `styles`, class names) |

**Key error keys to cover:**
- `invalidUserMessage` — invalid credentials
- `accountTemporarilyDisabledMessage` — brute-force lockout
- `accountPermanentlyDisabledMessage` — permanent lockout
- `webauthn-error-registration` — passkey registration failure
- `webauthn-error-api-get` — passkey auth failure
- `webauthn-unsupported-browser-text` — incompatible browser
- `emailSendError` — email not deliverable
- `requiredAction.webauthn-register-passwordless` — Required Action display name
- Email OTP keys if extension installed (extension-specific, not in KC base)

**Note:** KC's `messages_es.properties` lives in `resources-community` (community-contributed). Verify against `messages_en.properties` and add missing keys manually.

### Anti-features (avoid)
| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Hardcoding error strings in frontend JS | Bypass KC's i18n; strings out of sync | Override KC FreeMarker templates; let KC render errors |
| Client-level theme override | Complex, less supported path | Realm-level `loginTheme: "japan-trip"` already set |

### FreeMarker customization notes
- Theme extends `parent=keycloak` — only override specific `.ftl` files needed
- `theme.properties` encoding defaults to ISO-8859-1; add `# encoding: UTF-8` header to `.properties` files for Spanish characters (ñ, á, etc.)
- Templates to override: `verify-email.ftl`, `login-page-expired.ftl`, and OTP template from email OTP extension

---

## Terraform IaC

### What it is
Managing KC realm configuration (flows, policies, clients, Required Actions) as Terraform code rather than via realm-export.json import.

### IMPORTANT — Provider recommendation differs from milestone brief
The milestone brief references `mrparkers/keycloak`. Since December 2024, the Keycloak project officially adopted this provider. The canonical source is now **`keycloak/keycloak`** (Apache 2.0, maintained by Sebastian Schuster and Thomas Darimont). The `mrparkers/keycloak` registry entry still exists and the resource schema is identical (it was a straight adoption), but new development is on `keycloak/keycloak >= 5.7.0`.

Migration from `mrparkers/keycloak` state: `terraform state replace-provider mrparkers/keycloak keycloak/keycloak`

### Table Stakes
| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| `keycloak_realm` resource | Core realm settings (token lifetimes, brute force, webauthn policies) | Low | Direct Terraform resource |
| `keycloak_authentication_flow` + `keycloak_authentication_execution` | Manages `browser-passkey` flow and sub-flows | Medium | Flow topology must match realm-export.json structure |
| `keycloak_required_action` | Registers `VERIFY_EMAIL`, `webauthn-register-passwordless` as realm defaults | Low | Set `default_action = true` for VERIFY_EMAIL |
| `keycloak_openid_client` | `japan-trip-frontend` and `japan-trip-api` clients with correct redirect URIs | Low | |
| Per-environment `var.keycloak_rp_id` | `webAuthnPolicyPasswordlessRpId` must differ between local and prod | Low | Use Terraform variable with no default; require explicit set |

### Differentiators
| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Separate Terraform modules per concern | Realm settings / clients / flows / required actions | Low | Easier to review on PR |
| Remote state backend | Prevents state conflicts | Low | Terraform Cloud free tier or GitHub Actions artifact |

### Anti-features (avoid)
| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Mixing realm-export.json import + Terraform | Import creates drift; Terraform will fight the import on next apply | Migrate fully to Terraform for v2.0; remove `--import-realm` from docker-compose.yml |
| Managing users in Terraform | Security anti-pattern; state contains credentials | Use KC Admin API or separate provisioning script |
| Using `mrparkers/keycloak` in new Terraform code | Legacy path; no new development | Use `keycloak/keycloak >= 5.7.0` |

### Dependencies on existing KC config
- Current realm is imported via `--import-realm` in docker-compose.yml line 31; Terraform must replace this pattern
- `webAuthnPolicyPasswordlessRpId: ""` (empty) in realm-export.json — Terraform must set correct value per environment

---

## Playwright Real Auth

### What it is
E2E tests that exercise real Keycloak auth flows (redirect, token exchange, session) using `storageState` for session reuse and CDP Virtual Authenticator for passkey simulation.

### Table Stakes
| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| `storageState` setup in `playwright.config.ts` | Avoids re-authenticating on every test | Low | `globalSetup` script logs in once, saves `auth.json`; tests declare `storageState: 'auth.json'` |
| CDP Virtual Authenticator for passkey tests | No physical device needed in CI | Medium | Chromium-only; `page.context().newCDPSession(page)` → `WebAuthn.enable` → `WebAuthn.addVirtualAuthenticator` |
| Tests exercise real KC redirect chain | PKCE/JWT bugs don't surface in mocked auth | None (design decision) | Uses local KC at `localhost:8080` |

### Differentiators
| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Mailpit for email OTP testing | Catch outbound KC emails in test environment without real SMTP | Low | `mailpit` Docker service captures SMTP; Playwright reads Mailpit API to extract OTP code |
| Per-role `storageState` fixtures | Test passkey user vs password user vs unverified user separately | Low | Three setup fixtures in `globalSetup` |

### Anti-features (avoid)
| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Mocking `keycloak-js` in E2E tests | Defeats the purpose; PKCE/JWT bugs won't surface | Real KC in docker-compose for E2E |
| Running Virtual Authenticator tests on WebKit/Firefox | CDP is Chromium-only | Mark passkey tests as chromium project only; use `storageState` for auth state in other browsers |
| `page.goto(keycloak_admin_url)` to create test users in tests | Brittle, slow | Use KC Admin REST API in `globalSetup` to create/teardown test users |

### CDP Virtual Authenticator setup (confirmed pattern, Chromium only)
```typescript
const cdp = await page.context().newCDPSession(page);
await cdp.send('WebAuthn.enable', { enableUI: false });
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'usb',
    hasResidentKey: true,
    hasUserVerification: true,
    automaticPresenceSimulation: true,
    isUserVerified: true,
  },
});
```
`automaticPresenceSimulation: true` auto-approves the biometric prompt — required for headless CI.

### Dependencies on existing KC config
- Docker Compose exposes KC on `localhost:8080` — already done
- `redirectUris` in `japan-trip-frontend` client includes `http://localhost:5173/*` — already done
- CI workflow must start docker-compose services before Playwright run

---

## Feature Dependency Map

```
VERIFY_EMAIL Required Action
  → SMTP configured in realm (smtpServer block missing from realm-export.json)
  → KC bug #41171 mitigation (longer accessCodeLifespanUserAction)

browser-passkey as default browserFlow
  → webAuthnPolicyPasswordlessRpId = production domain (currently empty)
  → passkey-forms sub-flow already defined

Passkey Campaign
  → initKeycloak() resolves (userId available for cookie)
  → skip_if_exists AIA parameter (KC 26.3+, satisfied at 26.6.1)
  → browser-passkey as default flow

Email OTP Fallback
  → SMTP configured
  → Third-party SPI jar in /providers/ (custom Dockerfile required)
  → browser-passkey flow extended with conditional sub-flow

KC Theme Error Messages
  → keycloak/themes/japan-trip/login/messages/ directory created
  → theme.properties declares locales=es,en
  → messages_en.properties + messages_es.properties created

Terraform IaC
  → Replaces realm-export.json --import-realm pattern
  → keycloak/keycloak provider >= 5.7.0

Playwright Real Auth
  → docker-compose KC running in CI
  → storageState global setup
  → CDP Virtual Authenticator (Chromium only)
  → Mailpit Docker service (if Email OTP feature is built)
```

---

## Complexity Summary

| Feature | Overall Complexity | Primary risk |
|---------|--------------------|-------------|
| Passkey Campaign | Low | `rpId` must match prod domain before prod deploy |
| Email OTP Fallback | High | No native KC support; SPI extension + custom Dockerfile |
| Email Verification | Low | KC bug #41171 (session expiry across tabs) |
| KC Flow Configuration | Medium | Flow topology; conditional sub-flow for OTP fallback |
| Error Handling / i18n | Low | Spanish file in `resources-community` may be incomplete |
| Terraform IaC | Medium | Full migration away from realm-export.json import pattern |
| Playwright Real Auth | Medium | CDP Chromium-only; Mailpit setup for OTP tests |

---

## Sources

- [Keycloak 26.3.0 release notes — skip_if_exists for AIA](https://www.keycloak.org/2025/07/keycloak-2630-released)
- [Keycloak 26.4 passkeys support announcement](https://www.keycloak.org/2025/09/passkeys-support-26-4)
- [Keycloak 26.4.0 release notes](https://www.keycloak.org/2025/09/keycloak-2640-released)
- [KC GitHub issue #41171 — VERIFY_EMAIL breaks OIDC flow](https://github.com/keycloak/keycloak/issues/41171)
- [KC GitHub issue #39191 — skip AIA for existing WebAuthn](https://github.com/keycloak/keycloak/issues/39191)
- [Official Terraform provider adoption announcement Dec 2024](https://www.keycloak.org/2024/12/terraform-provider-adoption)
- [Keycloak Terraform Provider Release 5](https://www.keycloak.org/2025/01/terraform-provider-release-5)
- [Playwright Virtual Authenticator passkey testing — Corbado](https://www.corbado.com/blog/passkeys-e2e-playwright-testing-webauthn-virtual-authenticator)
- [Playwright + WebAuthn CI testing with Mailpit](https://dev.to/kochan/testing-webauthn-in-ci-e2e-automation-with-virtual-authenticators-and-mailpit-part-2-4j4i)
- [KC messages_es.properties — resources-community](https://github.com/keycloak/keycloak/blob/main/themes/src/main/resources-community/theme/base/login/messages/messages_es.properties)
- [KC messages_en.properties — base](https://github.com/keycloak/keycloak/blob/main/themes/src/main/resources/theme/base/login/messages/messages_en.properties)
- [for-keycloak/email-otp-authenticator SPI](https://github.com/for-keycloak/email-otp-authenticator)
- [KC Working with themes documentation](https://www.keycloak.org/ui-customization/themes)
