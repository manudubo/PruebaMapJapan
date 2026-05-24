# Phase 8: OTP + Passkey Campaign — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-24
**Phase:** 08 — OTP + Passkey Campaign
**Areas discussed:** OTP endpoint auth model, Passkey campaign placement, Last-credential delete guard, UPDATE_PASSWORD flow coordination

---

## OTP endpoint auth model

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — Bearer-protected | User already logged in via KC. OTP is secondary email-ownership check. Reuses authMiddleware, no standalone session management. | ✓ |
| No — open endpoints | User cannot authenticate at all. Worker issues its own session. More complex, requires Admin API handshake. | |

**User's choice:** Bearer-protected

---

| Option | Description | Selected |
|--------|-------------|----------|
| Reject with 422 Unprocessable | Return `{ success: false, error: 'no_email' }`. Clean failure for misconfigured flow. | ✓ |
| Require email in request body as fallback | Accept optional email in JSON body if JWT has no email. Phishing surface risk. | |

**User's choice:** Reject with 422 if JWT has no email claim

---

| Option | Description | Selected |
|--------|-------------|----------|
| Invalidate old code, generate new one | Mark old unexpired codes as used, issue fresh code, resend email. Simple UX. | |
| Return 429 with retry-after hint | Tell frontend when current code expires so user can wait. Prevents spam. | ✓ |

**User's choice:** 429 + retry-after hint

---

## Passkey campaign placement

| Option | Description | Selected |
|--------|-------------|----------|
| New module: src/modules/passkeyCampaign.ts | Export checkPasskeyCampaign(userId). Testable, easy to remove. | ✓ |
| Inside initKeycloak() directly | Simpler call site but makes auth module impure with redirect side effect. | |

**User's choice:** New module passkeyCampaign.ts

---

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard only | First page after login. One trigger point, predictable UX. | ✓ |
| All authenticated pages | dashboard.ts + tripDetail.ts + profile.ts. Catches users who skip dashboard. | |

**User's choice:** Dashboard only

---

| Option | Description | Selected |
|--------|-------------|----------|
| Before the redirect | Write cookie immediately, then redirect. Prevents redirect loop on back navigation. | ✓ |
| After returning from KC registration flow | Only write cookie if registration succeeded. Risk of infinite loop. | |

**User's choice:** Cookie written before redirect

---

## Last-credential delete guard

| Option | Description | Selected |
|--------|-------------|----------|
| Use count from existing loadPasskeys() call | Track credentialCount in module-level variable. Fast, no extra API round-trip. | ✓ |
| Fresh API call inside openDeleteConfirm() | Always accurate but adds latency and doubles API calls. | |

**User's choice:** Cached count from loadPasskeys()

---

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in the passkey list | Call showStatus() to show error. Reuses existing helper. | |
| Inside the confirm modal | Modal opens but error shown inside. | ✓ |

**User's choice:** Error shown inside the confirm modal

---

| Option | Description | Selected |
|--------|-------------|----------|
| Replace modal body with error + Close button | Modal shows error text with only Close button. | |
| Show modal normally but disable/replace Delete button | Keep modal, replace Delete with "Register another passkey first" button linking to registration flow. | ✓ |

**User's choice:** Replace Delete button with "Register another passkey first"

---

## UPDATE_PASSWORD flow coordination

| Option | Description | Selected |
|--------|-------------|----------|
| Frontend decides, Worker doesn't know | Frontend calls keycloak.login({ action: 'UPDATE_PASSWORD' }) based on its own WebAuthn detection. Clean separation. | ✓ |
| Frontend tells Worker, Worker sets required action via Admin API | Frontend sends webauthnCapable flag, Worker calls execute-actions. Robust but complex. | |

**User's choice:** Frontend-driven; Worker returns { success: true } only

---

| Option | Description | Selected |
|--------|-------------|----------|
| Modal overlay on dashboard | No new HTML page. Dashboard detects non-WebAuthn, shows banner, opens OTP modal. | ✓ |
| Separate otp.html page | New Vite entry point, cleaner URL, but requires a new HTML page. | |

**User's choice:** Modal overlay on dashboard

---

## Claude's Discretion

- OTP email template (subject, body, formatting)
- Modal and banner CSS/styling
- `retryAfter` countdown display
- `OTP_SECRET` local dev value
- Zod schemas for OTP request bodies

## Deferred Ideas

- KC Admin API call for server-side UPDATE_PASSWORD enforcement — decided against (frontend-driven sufficient)
- Separate otp.html page — decided against (modal on dashboard is sufficient)
- Campaign on pages other than dashboard — out of scope for Phase 8
