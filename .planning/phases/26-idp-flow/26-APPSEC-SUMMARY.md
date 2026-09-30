---
phase: 26-idp-flow
plan: APPSEC (application-security half)
subsystem: backend auth/OTP/middleware, frontend profile + search
tags: [security, v3.2]
requirements: [SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, SEC-20, SEC-21, SEC-23, SEC-24]
not-in-scope: [SEC-22, SEC-18, KC-01, SEC-11, SEC-12, SEC-13, SEC-17, SEC-19, SEC-25]
key-files:
  created:
    - backend/src/config/environment.ts
    - backend/src/auth/otp-email.ts
    - backend/src/auth/jwt-test-fixtures.ts
    - frontend/src/modules/passkeyList.ts
    - frontend/src/modules/highlight.ts
    - backend/src/middleware/security.test.ts
    - backend/src/middleware/auth.test.ts
    - backend/src/auth/keycloak-jwks-cooldown.test.ts
    - backend/src/auth/otp-email.test.ts
    - backend/src/db/queries/otp-attempts.test.ts
    - backend/src/db/queries/trips-public.test.ts
    - backend/src/routes/auth-otp-verify.test.ts
    - backend/src/routes/health.test.ts
    - frontend/tests/passkey-list-xss.test.ts
    - frontend/tests/search-highlight-xss.test.ts
  modified:
    - backend/src/middleware/security.ts
    - backend/src/middleware/cors.ts
    - backend/src/middleware/auth.ts
    - backend/src/auth/keycloak.ts
    - backend/src/db/queries/otp.ts
    - backend/src/db/queries/trips.ts      # getTripBySlug projection only
    - backend/src/routes/auth.ts           # verify: attempt reservation; request: email gate + import move
    - backend/src/routes/health.ts
    - backend/src/index.ts                 # middleware order + shared health handler
    - backend/src/types/index.ts           # ENVIRONMENT binding
    - backend/src/dev.ts
    - backend/wrangler.toml                # [vars] ENVIRONMENT = "production"
    - backend/.dev.vars.example
    - SETUP.md
    - frontend/src/pages/profile.ts
    - frontend/src/components/SearchBar.ts
completed: 2026-09-30
---

# Phase 26 (app-security half): Summary

Ten items, one focused commit each, on top of the Phase 22 merge
(`1e48552`). The BUG-16 hourly OTP cap in `routes/auth.ts` is untouched and
covered again by the combined cap-plus-attempts tests.

## Per-item result

| ID | Result | Where |
|----|--------|-------|
| SEC-05 | Forced JWKS refresh (unknown kid / bad signature) is limited to one per 60 s per isolate. The window is claimed before the await, so concurrent bogus tokens share it. Cold-cache fetches are de-duplicated in flight, and a failed forced refresh restores the previous keys. TTL expiry is unchanged. | `auth/keycloak.ts` |
| SEC-06 | Every JWT failure returns `401 {success:false,error:"invalid_token"}` plus `WWW-Authenticate: Bearer error="invalid_token"`. The detail is logged server-side, JSON-encoded (so no log-line forgery) and truncated to 300 chars. | `middleware/auth.ts` |
| SEC-07 | `consumeOtpAttempt()` = `UPDATE … SET attempts = attempts + 1 WHERE id = $1 AND attempts < 5 AND used_at IS NULL RETURNING attempts`. The route only compares the code when it gets a slot. Success goes through `markOtpUsedIfUnused()` (single use under concurrency). The dead `incrementOtpAttempts` is removed. | `db/queries/otp.ts`, `routes/auth.ts` |
| SEC-08 | The transport follows explicit `ENVIRONMENT`: Resend if a key is set; Mailpit only when the value is exactly `development`; otherwise `OtpEmailConfigError` is thrown *before* a code is issued (no DB row, cap not consumed), logged with `console.error`, and the client gets a generic 500. Resend's returned errors and Mailpit HTTP errors now surface too, and an undelivered code is burned so a retry is not blocked. | `auth/otp-email.ts`, `config/environment.ts` |
| SEC-09 | Passkey list is built with `createElement`/`textContent`/`dataset` and has no `innerHTML`. | `modules/passkeyList.ts`, `pages/profile.ts` |
| SEC-10 | `highlightMatch` returns a `DocumentFragment` (text nodes + one `<mark>`) and matches with a literal `indexOf`, no RegExp. Result items are built with DOM APIs; the colour goes through CSSOM. | `modules/highlight.ts`, `components/SearchBar.ts` |
| SEC-20 | Adds `X-Content-Type-Options: nosniff` and `Permissions-Policy` (accelerometer, camera, geolocation, gyroscope, magnetometer, microphone, payment, usb all `()`). The security middleware now runs before CORS, so preflights get the headers too. | `middleware/security.ts`, `index.ts` |
| SEC-21 | **Chosen option: project `user_id` out and document the rest as intentional.** `getTripBySlug` selects `columns: { user_id: false }`. Hotel/day data *is* the shared itinerary: the owner opts in per trip, and the slug is a random UUID. Numeric ids stay because `tripAdapter` keys days by `id` when a date is null, and ids grant nothing (ownership is re-checked on every authed route; the 403/404 oracle is SEC-22). Projecting every id out would mean frontend changes, so this was the smaller safe option. | `db/queries/trips.ts` |
| SEC-23 | Origins are chosen per request from `ENVIRONMENT`. Production allows only `https://manud.github.io`; development adds `localhost:3000/5173`. Unknown, absent and literal `"null"` origins get no ACAO. The check is fail-closed: any value except exactly `development` counts as production. | `middleware/cors.ts`, `config/environment.ts` |
| SEC-24 | `/` and `/api/health` return exactly `{"status":"ok"}` with `Cache-Control: no-store`. There is no rate limiter: the handler touches neither the DB nor Keycloak, and an in-isolate limiter would be per-isolate and easy to bypass. | `routes/health.ts` |

## ENVIRONMENT binding (new)

- `wrangler.toml` `[vars] ENVIRONMENT = "production"`: deployed Workers are production.
- `dev.ts` defaults to `development` (this entry point only runs locally, and `scripts/dev.js`/e2e use it).
- `.dev.vars.example` / `SETUP.md` document `ENVIRONMENT=development` for `wrangler dev`.

## Test scenarios covered

- **JWT (SEC-06)**, using real RS256 keys (no mocked `crypto.subtle`). Cases: wrong issuer; another realm on the same host; missing iss; wrong or missing aud; expired; missing exp; future nbf; empty sub; `alg:none`; `HS256` key confusion; missing or unknown kid; forged signature with the same kid; payload tampered after signing; 2 and 4 segments; non-base64 and non-JSON header/payload; a 1 MB token; JWKS 503; JWKS with no keys; network failure. Every case asserts the exact generic body with no URL/realm/audience/kid text. Log lines have no CR/LF and stay under 400 chars even for a 50 KB issuer. Header edge cases: lower-case scheme, Basic, bare `Bearer`, whitespace-only, and a double space.
- **JWKS cooldown (SEC-05)**, with a faked `Date`. Cases: 50 unknown-kid tokens → 1 forced fetch; 50 forged signatures → 1; 100 concurrent mixed bogus tokens on a cold cache → 2 fetches total; the boundary at 59 999 ms vs 60 000 ms; valid tokens during the cooldown; legitimate rotation; rotation during an attacker-burned cooldown (rejected, then accepted after the window); TTL refresh; a 503 during forced refresh keeps the old keys; a failed fetch does not poison the in-flight slot; 20 concurrent cold callers → 1 fetch; wrong-issuer tokens never reach Keycloak. 8 of 13 of these fail on the old code.
- **OTP attempts (SEC-07)**:
  - Real Postgres, when `TEST_DATABASE_URL` is set, in a throwaway schema: 50 concurrent UPDATEs grant exactly slots 1..5; repeated storms never exceed 5; 4 prior attempts plus 10 concurrent → exactly 1; used or missing code → none; per-code isolation; `markOtpUsedIfUnused` with 20 concurrent callers → 1 winner. Removing the `attempts < 5` guard fails 5 of these tests.
  - SQL shape via `drizzle.mock` runs always.
  - Route level: 30 concurrent wrong codes → 5 `invalid_code` + 25 `max_attempts`; 5 concurrent correct codes → exactly 1 success; 10 concurrent correct → ≤1 success; a 25-wrong-plus-correct mix → ≤5 guesses evaluated; an expired code under concurrency → nothing consumed; malformed bodies (short, long, letters, Unicode digits, number, null, SQL-ish, 1 MB) → 400 with no attempt consumed.
  - **Combined with BUG-16:** a user at the hourly cap with a burned code gets `otp_rate_limited` and has nothing left to guess against. A pending code blocks re-issue while its attempts stay capped.
- **Email gate (SEC-08)**: production/unset/misspelled `ENVIRONMENT` without a key → 500 with no row inserted, no Mailpit call, a loud log and no config text in the body. An empty or whitespace key counts as missing. Dev → Mailpit. Prod with a key → Resend only. A Resend error object → thrown. Mailpit 500 or network error → 500 and the code is burned. A failure while burning the code still returns the original error.
- **CORS (SEC-23)**: prod vs dev lists; ENVIRONMENT missing or misspelled → prod. Rejected origins: unknown, literal `"null"`, http downgrade, suffix/prefix look-alikes, another github.io user, explicit `:443`, trailing slash, path, upper-case host, `*`, `127.0.0.1`, a 10 KB origin. An absent Origin never yields `*`. Also covered: preflight allow and deny, `Vary: Origin`, and the real app on a 401.
- **Headers (SEC-20)**: the full set is checked on 200, 400, 401, 404 (notFound), 500 (onError) and a CORS preflight.
- **Health (SEC-24)**: exact body, no fingerprint strings (name, version, banner, ISO timestamp), `no-store`, no `server`/`x-powered-by`, no DB or fetch access, no query/header reflection, POST → generic 404, works with no bindings.
- **Public trip (SEC-21)**: query config; generated SQL has no `trips.user_id` but keeps the hotel columns and the `is_public` filter. The real-DB payload, from migrations applied in a throwaway schema, has no `user_id` anywhere and includes the hotel. A private trip is not returned.
- **Passkey label (SEC-09)**: payloads covered: `<img onerror>`, `<script>`, `<svg onload>`, attribute breakout, `javascript:` iframe/anchor, injected delete button, entities/`&`, and mXSS (`math/mglyph/style`). Also: a hostile credential id cannot break out of `data-*` and round-trips exactly; blank-label fallback; invalid date; a 100 KB label; re-render; empty-id guard; a source audit of `profile.ts`.
- **Search highlight (SEC-10)**: markup in the title and in the query; a payload split by the match; `</mark>` injection; `&`, `<` and `>` serialization; regex metacharacters `.* ( [a-z] \ $& $' ^ | +? (?<x>)`; the İ length change; a 100 KB title. Component level: a hostile title/subtitle/colour produces no elements or handlers; a valid colour still applies; click → correct result; keyboard `aria-selected`; re-render; empty state. The two component XSS tests fail on the old code.

Results: backend 228/228 with `TEST_DATABASE_URL` (219 + 9 DB-gated skips without it); frontend 198/198; both typechecks clean; `wrangler deploy --dry-run` OK (now shows `ENVIRONMENT: "production"`); `vite build` OK.

## Known limits / follow-ups

- SEC-07: when a request finds the attempts exhausted, it burns the code (existing behaviour, so the user can request a new one). That burn can land before a concurrent *correct* attempt commits. It is only reachable by someone already holding the user's session. The invariants still hold: at most 5 guesses and at most 1 success.
- SEC-05 trade-off: a genuinely rotated key can be rejected for up to 60 s if an attacker used up the refresh window just before.
- Not changed (out of scope, noted): `ensureUserProvisioned` still returns the raw DB error message on 500 (belongs with the dbMiddleware refactor). When Keycloak is down *and* the cache is empty, every request still tries a fetch; the in-flight de-duplication only collapses concurrent ones.
- The real-DB tests use `TEST_DATABASE_URL` opt-in with their own throwaway schema, so they coexist with the Phase 24 test-DB infra.
