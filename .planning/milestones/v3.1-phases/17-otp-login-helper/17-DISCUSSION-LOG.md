# Phase 17: OTP + Login Helper - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 17-otp-login-helper
**Areas discussed:** OTP route contract, Login helper API + location, OTP polling timeout

---

## OTP route contract

| Option | Description | Selected |
|--------|-------------|----------|
| Step-up auth (keep auth-gated) | Backend is correct as-is; tests 1-3 get a Bearer JWT first | v |
| Login fallback (remove auth gate) | Remove authMiddleware, read email from body, issue session on verify | |

**User's choice:** Step-up auth only — fix tests to match
**Notes:** User initially asked for a best-practice recommendation. Analysis showed the backend derives email from the JWT (not the request body), and issuing KC-valid sessions from a custom route is infeasible without KC admin API integration. The feature is correctly modeled as step-up auth for now. KC email OTP login (passwordless fallback for passkey-only users) was deferred as a KC-native flow (Terraform HCL).

---

## Login helper API + location

**Location**

| Option | Description | Selected |
|--------|-------------|----------|
| tests/e2e/fixtures/kc-login-helper.ts | New file in fixtures/ folder | v |
| tests/e2e/helpers/login.ts | New helpers/ directory | |
| tests/global-setup.ts (inline) | Keep local to global-setup | |

**Scope**

| Option | Description | Selected |
|--------|-------------|----------|
| Full login: dashboard to KC form to back to app | Navigate from dashboard.html all the way through | v |
| KC form only: assumes KC URL already loaded | Shorter, but callers add boilerplate | |

**Template**

| Option | Description | Selected |
|--------|-------------|----------|
| global-setup.ts (networkidle + locator.filter) | More defensive, handles aria-hidden links | v |
| session-management.spec.ts (getByRole + isVisible) | Semantic, shorter | |

**User's choice:** fixtures/kc-login-helper.ts, full flow, global-setup template
**Notes:** All three sub-decisions followed the recommendation.

---

## OTP polling timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded: 20 x 500ms = 10s | Simple, no env var needed | v |
| Env var: MAILPIT_POLL_TIMEOUT_MS | Configurable but Mailpit is always local | |

**User's choice:** Hardcoded 20 x 500ms
**Notes:** Matches the pattern of 30 x 1000ms already in global-setup.ts waitForServer.

---

## Claude's Discretion

- Exact two-step KC form selector fallbacks
- Whether to add JSDoc to loginViaKcForm (one line max)
- Whether global-setup delegates to loginViaKcForm directly or via internal wrapper functions

## Deferred Ideas

- KC email OTP login fallback (passwordless for passkey-only users on non-WebAuthn devices) — future KC config phase via Terraform HCL