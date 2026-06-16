# Phase 11: Error Handling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 11-error-handling
**Areas discussed:** Toast UX, Error message content, 401 redirect UX, Retrofit scope

---

## Toast UX

| Option | Description | Selected |
|--------|-------------|----------|
| Top-right corner | Standard app pattern, doesn't cover content being edited below | ✓ |
| Bottom-center | Mobile-native feel, away from nav buttons at top | |
| Top-center / top banner | High visibility but covers nav; disruptive for success messages | |

**User's choice:** Top-right corner
**Notes:** —

---

| Option | Description | Selected |
|--------|-------------|----------|
| 4 seconds | Slightly faster than profile.ts 5s, feels snappier | ✓ |
| 5 seconds | Matches existing showStatus() in profile.ts | |
| Error toasts stay, success dismiss | Different behavior per type | |

**User's choice:** 4 seconds
**Notes:** —

---

| Option | Description | Selected |
|--------|-------------|----------|
| Stack vertically, newest on top | Each toast independent, slides in above previous | ✓ |
| Replace — new toast replaces existing | Simpler; avoids visual clutter | |
| Queue — show one at a time | Prevents overlap but delays visibility | |

**User's choice:** Stack vertically, newest on top
**Notes:** —

---

| Option | Description | Selected |
|--------|-------------|----------|
| Always show a close button | User can dismiss immediately; good accessibility | ✓ |
| Auto-dismiss only, no close button | Simpler; no interaction needed | |

**User's choice:** Always show a close button
**Notes:** —

---

## Error message content

| Option | Description | Selected |
|--------|-------------|----------|
| Generic message always | "Something went wrong. Please try again." — safe, never exposes internals | ✓ |
| Translate backend error codes | Frontend maps codes (trip_not_found, etc.) to readable sentences | |
| Use Error message as-is | Show raw API error string — leaks technical details | |

**User's choice:** Generic message always
**Notes:** No code→message translation map needed

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — success toasts too | showToast() for mutations: createTrip, deleteTrip, etc. | ✓ |
| No — errors only | Success implied by UI updating | |

**User's choice:** Yes — success toasts too
**Notes:** Callers decide the success message text

---

| Option | Description | Selected |
|--------|-------------|----------|
| "An unexpected error occurred" — always generic | Safe fallback, no internals | ✓ |
| Use rejection reason if string/Error | Slightly more informative; risks leaking internals | |

**User's choice:** "An unexpected error occurred" — always generic
**Notes:** —

---

## 401 redirect UX

| Option | Description | Selected |
|--------|-------------|----------|
| Toast then redirect | Show "Session expired — redirecting to login" for ~1.5s, then redirect | ✓ |
| Immediate redirect | No delay, fastest path to Keycloak | |
| Toast only, no auto-redirect | User clicks login button themselves; preserves page state | |

**User's choice:** Toast then redirect
**Notes:** 1500ms delay between toast and redirect call

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — use current URL as post-login redirect | Returns user to the page where 401 occurred | |
| No — always redirect to dashboard | Simpler; avoids state restore complexity | ✓ |

**User's choice:** No — always redirect to dashboard
**Notes:** login('dashboard.html') in the 401 handler

---

| Option | Description | Selected |
|--------|-------------|----------|
| In client.ts request() | Centralized; all callers get auto-redirect automatically | ✓ |
| In each page's catch block | Distributed; repetitive and easy to miss | |

**User's choice:** In client.ts request()
**Notes:** —

---

## Retrofit scope

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with toast | Remove inline error divs from dashboard.ts; call showToast() instead | ✓ |
| Keep inline + add toast as global fallback | Inline stays for forms; toast only for unhandled errors | |

**User's choice:** Replace with toast
**Notes:** Applies to #create-trip-error div and .trips-error paragraph in dashboard.ts

---

| Option | Description | Selected |
|--------|-------------|----------|
| Toast then redirect | Show "Could not load trip — returning to dashboard" then redirect | ✓ |
| Keep silent redirect | No change to trip-edit.ts behavior | |

**User's choice:** Toast then redirect
**Notes:** 1500ms delay before redirect; matches 401 redirect pattern

---

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with toast | Remove showStatus() from profile.ts; use showToast() everywhere | |
| Keep showStatus() in profile.ts | Contextual inline feedback for passkey/OTP stays separate | ✓ |

**User's choice:** Keep showStatus() in profile.ts
**Notes:** profile.ts showStatus() handles passkey management and OTP feedback; too contextually tied to buttons to benefit from global toast

---

## Claude's Discretion

- ApiError class fields and constructor signature
- Backend error code names (exact strings returned from onError)
- Toast CSS: min-width, padding, border, font-size, gap, animation
- Whether showToast export is a flat function or namespaced (toast.error(), toast.success())
- tripDetail.ts: which catches to retrofit (currently no visible error states)

## Deferred Ideas

- Error code → human-readable message map — user chose generic for now
- AuthGuard error UI via toast — Shadow DOM injection complexity
- profile.ts showStatus() unification with toast — future cleanup
