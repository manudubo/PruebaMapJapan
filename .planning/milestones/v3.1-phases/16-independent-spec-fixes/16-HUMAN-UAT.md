---
status: partial
phase: 16-independent-spec-fixes
source: [16-VERIFICATION.md]
started: 2026-06-22T00:00:00.000Z
updated: 2026-06-22T00:00:00.000Z
---

## Current Test

[awaiting E2E run with live stack]

## Tests

### 1. Run both specs against live services (chromium)
expected: All tests in public-sharing and idp-theme pass or skip under chromium. Zero failures.
result: [pending]

### 2. Confirm no firefox/webkit regressions
expected: Firefox and webkit continue to pass on both specs. Empty storageState override is a no-op for projects without project-level storageState.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
