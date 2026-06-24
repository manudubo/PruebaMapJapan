---
phase: 17
plan: "03"
status: complete
completed: "2026-06-24T02:35:00Z"
wave: 3
---

# Plan 17-03: Fix OTP test 2 error assertion

## What Was Built

One-line correction to `tests/e2e/otp.spec.ts` line 81: replaced `expect(errText).toMatch(/expir/)` with `expect(errText).toMatch(/otp_not_found/)`.

This aligns test 2 ("expired OTP is rejected") with the actual backend contract: `auth.ts:153` returns `{ error: 'otp_not_found' }` when `getLatestUnexpiredOtp()` returns null, which is the case for both expired and never-requested OTPs. The regex `/expir/` could never match `otp_not_found`.

## Key Files

### Modified
- `tests/e2e/otp.spec.ts` — line 81: `/expir/` → `/otp_not_found/`

## Deviations

None — single-line fix exactly as planned.

## Self-Check: PASSED

- rg "toMatch\(/otp_not_found/\)" tests/e2e/otp.spec.ts → 1 match ✓
- rg "toMatch\(/expir/\)" tests/e2e/otp.spec.ts → 0 matches ✓
- status assertion `expect([400, 401]).toContain(verifyRes.status())` preserved ✓
- backend typecheck exits 0 ✓
- frontend typecheck exits 0 ✓
