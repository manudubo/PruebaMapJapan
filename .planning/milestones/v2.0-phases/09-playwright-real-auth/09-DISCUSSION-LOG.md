# Phase 9: Playwright Real Auth — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 9 — Playwright Real Auth
**Areas discussed:** Test user lifecycle, Existing mock tests fate, CI strategy, OTP test parallelism

---

## Test user lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed credentials in env | Pre-seeded `e2e-test@local` user; credentials in `.env.test` (gitignored); fast, no KC Admin call in setup | ✓ |
| Dynamic: create per-run, delete in teardown | globalSetup creates fresh user via kc-admin fixture; max isolation; ~2-3s overhead | |
| Dynamic: create once, reuse until exists | 409 = reuse; no teardown deletion; middle ground | |

**User's choice:** Fixed credentials in env

---

| Option | Description | Selected |
|--------|-------------|----------|
| No — stable password, just re-login if storageState expired | Simplest; stable credentials; storageState reused | ✓ |
| Yes — reset password in globalSetup each time | Guarantees fresh credential state; useful if Phase 8 flows pollute session | |

**User's choice:** No — stable password

---

## Existing mock tests fate

| Option | Description | Selected |
|--------|-------------|----------|
| Keep alongside, no changes | Existing mocked tests stay as-is; two complementary layers | |
| Migrate key auth tests to real-auth | Replace select auth.spec.ts tests with real-auth via storageState | ✓ |
| Move mocked tests to a separate no-KC Playwright project | Separate project in config for mocked vs. real-auth | |

**User's choice:** Migrate key auth tests to real-auth

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add @mocked tag to mock-based tests | Enables `--grep @mocked` to skip in CI | |
| No — keep it implicit | Test files self-evident; no tagging overhead | ✓ |

**User's choice:** No tagging

---

| Option | Description | Selected |
|--------|-------------|----------|
| Authenticated flows only | Tests needing real session (trips grid, user info) migrate; unauthenticated tests stay mocked | |
| All 5 auth.spec.ts tests | Full rewrite to real-auth | |
| Claude decides | Pick tests that genuinely benefit from a real session | ✓ |

**User's choice:** Claude decides
**Notes:** Claude to migrate tests where a real session provides meaningful coverage over a mock.

---

## CI strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Local-only for now, skip in CI | Real-auth tests skipped via `SKIP_REAL_AUTH=true`; CI keeps mocked tests | ✓ |
| Wire KC as a GHA service container this phase | Full CI real-auth; significantly more CI complexity | |
| CI runs real-auth only on main branch pushes | Matrix: PR=mocked, main=real; complex GHA matrix | |

**User's choice:** Local-only for now, skip in CI

---

| Option | Description | Selected |
|--------|-------------|----------|
| SKIP_REAL_AUTH env var | Clean opt-out; CI sets env var; globalSetup checks it first | ✓ |
| Auto-detect: check if KC is reachable before each test | Like idp-theme.spec.ts pattern; ~1s probe per test; no env var | |

**User's choice:** SKIP_REAL_AUTH env var

---

## OTP test parallelism

| Option | Description | Selected |
|--------|-------------|----------|
| Serial: fullySerial for OTP spec | `test.describe.configure({ mode: 'serial' })`; simplest; no email filtering logic | ✓ |
| Filter by recipient address | Dynamic user email per test; parallel-safe; requires dynamic user creation | |
| Purge Mailpit before each OTP test | DELETE /api/v1/messages; safe only if serial anyway | |

**User's choice:** Serial — fullySerial for OTP spec

---

| Option | Description | Selected |
|--------|-------------|----------|
| Same test user, ensure email is set | Reuse e2e-test@local; storageState from globalSetup reused | |
| Separate otp-test@local user | Dedicated user for OTP scenarios; cleaner isolation | ✓ |

**User's choice:** Separate `otp-test@local` user
**Notes:** Pre-seeded in KC, no passkeys registered, to trigger the OTP banner path (devices without WebAuthn support). Credentials in `.env.test` as `E2E_OTP_USERNAME`/`E2E_OTP_PASSWORD`.

---

## Claude's Discretion

- Which specific auth.spec.ts tests to migrate to real-auth
- Exact CDP VirtualAuthenticator options parameters
- Whether to clear OTP codes via KC Admin API or direct DB query
- Structure of `tests/.env.test.example`
- Whether `chromium-passkeys` project goes in main config or separate config file
- How to determine storageState expiry before re-login attempt

## Deferred Ideas

- KC as GitHub Actions service container — future phase
- Per-recipient Mailpit filtering for parallel OTP tests — deferred; serial is sufficient
