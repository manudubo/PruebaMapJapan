---
phase: 14-e2e-expansion-new-user-parity
reviewed: 2026-06-08T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - frontend/src/pages/dashboard.ts
  - tests/e2e/new-user-trip-creation.spec.ts
  - tests/e2e/trip-edit-integration.spec.ts
  - tests/global-setup.ts
  - tests/.env.test.example
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-06-08T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the dashboard page source and the new E2E test suite for the new-user parity flow. No security vulnerabilities or data-loss risks found. Two logic bugs in `dashboard.ts` affect the OTP verification UX — one makes the modal unusable after a single failed attempt, the other leaves a permanently disabled resend button with no handler. The test files are well-structured; no reliability issues found.

---

## Warnings

### WR-01: OTP verify listener removed after first click — user stuck on failed attempt

**File:** `frontend/src/pages/dashboard.ts:277-279`

**Issue:** `openOtpModal` wires the verify button with `{ once: true }`:

```ts
document.getElementById('otp-verify-btn')?.addEventListener('click', () => {
  void handleVerifyOtp(webauthnCapable);
}, { once: true });
```

`handleVerifyOtp` returns early (without resolving) on two error paths: a code shorter than 6 digits (line 325) and a rejected OTP from the server (line 344-355). After either early-return the listener has already been consumed by the `once` semantic, so a subsequent click on "Verify" does nothing. The user sees the error message but can no longer submit — they must reload the page.

**Fix:** Remove `{ once: true }` and move the listener outside `openOtpModal` so it is wired once at build time, not re-wired on every open. Add a guard inside the handler to prevent double-submission instead:

```ts
// Wire once during buildOtpModal(), not inside openOtpModal()
document.getElementById('otp-verify-btn')?.addEventListener('click', () => {
  void handleVerifyOtp(webauthnCapable);
});
```

---

### WR-02: OTP resend button is permanently disabled — no event handler wired

**File:** `frontend/src/pages/dashboard.ts:253-257, 303-307`

**Issue:** `buildOtpModal` creates the resend button with `disabled = true` (line 256) and neither `buildOtpModal` nor any other function in this file attaches a click handler to it. The 429-rate-limit path in `handleSendOtp` (lines 303-306) updates the button text and keeps it disabled, but never enables it or wires a countdown/re-enable flow. The resend control is dead: users who hit the rate limit have no working path to request a new code.

**Fix:** Add a countdown-then-enable flow. Example — in `handleSendOtp` after a 429 response:

```ts
const resendBtn = document.getElementById('otp-resend-btn') as HTMLButtonElement | null;
if (resendBtn && body.retryAfter) {
  let remaining = body.retryAfter;
  resendBtn.textContent = `Resend (${remaining}s)`;
  resendBtn.disabled = true;
  const interval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(interval);
      resendBtn.textContent = 'Resend';
      resendBtn.disabled = false;
    } else {
      resendBtn.textContent = `Resend (${remaining}s)`;
    }
  }, 1000);
}
```

Also wire the click handler in `buildOtpModal`:

```ts
resendBtn.addEventListener('click', () => { void handleSendOtp(); });
```

---

## Info

### IN-01: `.env.test.example` — verify real env file is gitignored

**File:** `tests/.env.test.example:6,12`

**Issue:** The example file contains placeholder-shaped values (`your-client-secret`, `user:pass@localhost`) that document what real secrets look like. This is correct practice for an `.example` file. Confirm that the actual `tests/.env.test` (populated with real credentials) is listed in `.gitignore` to prevent accidental commit.

**Fix:** Verify `.gitignore` contains `tests/.env.test` or a pattern that covers it. No code change needed if it is already excluded.

---

_Reviewed: 2026-06-08T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
