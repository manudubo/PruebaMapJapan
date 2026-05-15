# Phase 3: Public Sharing — Research

**Date:** 2026-05-05
**Phase:** 03-public-sharing
**Requirements:** SHARE-02, SHARE-03, SHARE-04

---

## RQ1: UUID slug generation strategy

**Decision:** `$defaultFn(() => crypto.randomUUID())` in Drizzle schema + `DEFAULT gen_random_uuid()` in migration SQL.

- `crypto.randomUUID()` is available globally in Cloudflare Workers and Node 18+.
- Drizzle's `$defaultFn` runs in application code on INSERT; the SQL DEFAULT handles rows that exist before migration.
- The migration must use `ALTER TABLE trips ADD COLUMN IF NOT EXISTS public_slug uuid DEFAULT gen_random_uuid()` so all existing rows get a UUID immediately.
- A `CREATE UNIQUE INDEX` on `public_slug` enforces uniqueness at the DB level.
- `public_slug` is nullable in the Drizzle type (`.$defaultFn(...)` without `.notNull()`) — this allows the frontend type to be `string | null` and avoids breaking the type contract for rows created before the migration ran.

**Pattern:**
```typescript
public_slug: uuid('public_slug').$defaultFn(() => crypto.randomUUID()),
```

---

## RQ2: Migration strategy

**Decision:** Generate a new SQL migration file `0002_add_public_slug.sql` via `drizzle-kit generate`, then apply via `drizzle-kit migrate`.

- All existing trips get `public_slug` set to `gen_random_uuid()` immediately via the SQL DEFAULT.
- No backfill step needed — the DB DEFAULT handles it.
- Unique index added at migration time.
- Dev workflow: `DATABASE_URL=... npx drizzle-kit push --force` is used in dev (skips migration file); production uses `db:migrate`.

---

## RQ3: Backend route change

**Decision:** Change route param from `:tripId` (integer) to `:slug` (UUID string). No other route changes.

- Remove `Number()` conversion and `isNaN` guard.
- Add UUID format validation: `!/^[0-9a-f-]{36}$/.test(slug)` returns 400.
- Change query `where` from `eq(trips.id, tripId)` to `eq(trips.public_slug, slug)`.
- Extract a `getTripBySlug(db, slug)` query function in `queries/trips.ts` — same nested `with` structure as current inline query.
- The existing integer-based route is REPLACED (not duplicated) — no legacy `/trips/:tripId` public endpoint needed since the share URL always uses the slug.

---

## RQ4: Frontend share URL pattern

**Decision:** Use query param `?slug=<uuid>` on the existing `trip.html` page (or whichever HTML file hosts tripDetail.ts).

- GitHub Pages is static — no server-side routing. Cannot use `/trips/public/<slug>` path format without a hash router.
- Pattern: `trip.html?slug=<uuid>` for the public share link.
- `trip.html?tripId=<int>` remains for the authenticated owner view.
- tripDetail.ts `init()` checks `URLSearchParams` for `slug` param first; if present, forces public-only path (no auth attempt) and hides all edit controls.
- The copy-link button URL: `${window.location.origin}${window.location.pathname}?slug=${trip.public_slug}` — correct for both local dev and GitHub Pages deployment.

---

## RQ5: Copy-to-clipboard

**Decision:** `navigator.clipboard.writeText(url)` with button-text feedback ("¡Copiado!" for 2 seconds).

- `navigator.clipboard` requires a secure context (HTTPS or localhost). GitHub Pages is HTTPS — satisfied.
- No fallback needed for `document.execCommand('copy')` — all modern browsers support Clipboard API.
- Pattern: `setText(btn, '¡Copiado!')` then `setTimeout(() => setText(btn, 'Compartir'), 2000)`.
- No external library needed.

---

## RQ6: Auth-conditional UI in tripDetail.ts

**Decision:** `authenticated` boolean (already in scope at `init()`) + `data-owner-only` attribute on HTML elements that should be hidden in public view.

- In `?slug=` mode: set `authenticated = false` before rendering, so all `data-owner-only` elements stay hidden.
- In `?tripId=` mode: existing auth flow unchanged (try getTrip, fall back to getPublicTrip if needed).
- The copy-link button is conditionally shown only when `trip.public_slug` is non-null AND the user is the trip owner (i.e., `?tripId=` mode with successful auth).
- Edit link (`trip-edit.html?tripId=...`) is a `data-owner-only` element — hidden in public view.

---

## RQ7: Existing public endpoint security

**Current state:** `GET /api/public/trips/:tripId` filters `where: and(eq(trips.id, tripId), eq(trips.is_public, true))`.
- Only trips with `is_public = true` are returned — correct.
- After migration: `where: and(eq(trips.public_slug, slug), eq(trips.is_public, true))` — same security invariant preserved.

---

## Phase Scope Summary

**3 plans:**

- **03-01** (Wave 1): TDD RED stubs — `backend/src/routes/public.test.ts` for slug-based public route
- **03-02** (Wave 2): Backend — schema + migration + `getTripBySlug` query + update public route to slug
- **03-03** (Wave 2): Frontend — `ApiTrip.public_slug`, `getPublicTrip(slug)`, tripDetail.ts copy-link button + owner-only controls + `?slug=` URL mode

**No Wave 3 wiring plan needed** — the three changes are end-to-end complete within their own plans.

---

## Key Constraints

- `public_slug` must NOT appear in `CreateTripSchema` or `UpdateTripSchema` — it is DB-generated.
- The public endpoint must keep `is_public = true` filter — a trip with a slug but `is_public = false` must still return 404.
- `trip.html` URL param name: use `slug` (not `tripId`) for the public share link to distinguish the two modes.
- `setText` from `dom.ts` must be used for the copy-link button text (SEC-01 compliance).
