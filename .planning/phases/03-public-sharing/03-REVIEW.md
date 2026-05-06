---
phase: 03-public-sharing
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - backend/src/routes/public.test.ts
  - backend/src/routes/public.ts
  - backend/src/db/schema.ts
  - backend/src/db/queries/trips.ts
  - backend/src/index.test.ts
  - backend/src/db/migrations/0002_add_public_slug.sql
  - frontend/src/types/index.ts
  - frontend/src/api/client.ts
  - frontend/src/pages/tripDetail.ts
  - frontend/trip.html
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

The public-sharing feature is structurally sound: the backend route correctly filters by `is_public = true`, UUID validation is present, and DOMPurify is applied to popup HTML. No critical issues (no injection, no secrets, no auth bypass). Three warnings were found — two logic bugs and one type inconsistency — and three info items.

## Warnings

### WR-01: Public fallback uses `tripId` (integer) instead of `public_slug` (UUID)

**File:** `frontend/src/pages/tripDetail.ts:537-545`

**Issue:** When authenticated fetch fails (e.g., user is not the owner), the code falls back to `getPublicTrip(tripId)`. `tripId` is a serial integer ID from the URL query string (e.g., `"42"`). `getPublicTrip` posts to `/api/public/trips/:slug`, which validates the path param against `/^[0-9a-f-]{36}$/` and rejects anything non-UUID with 400. The public fallback will always fail for non-owner authenticated users and for unauthenticated users who arrive via `?tripId=`. The only working public path is `?slug=<uuid>`, which is handled separately. The `?tripId=` fallback path is dead code for public trips.

**Fix:** Remove the public-fallback attempt when `tripId` is present, or gate it with a guard. The public URL format should use `?slug=<uuid>` exclusively. If a cross-promotion fallback is needed, retrieve the trip's `public_slug` from the failed authenticated response or document that `?tripId=` is owner-only.

```typescript
// In init(), remove the dead fallback block (lines 537-545):
if (!trip) {
  // This never succeeds — tripId is an integer, not a UUID slug.
  // Remove this block or replace with a proper slug-based approach.
  try {
    trip = await getPublicTrip(tripId);  // Always 400s
  } catch (err) { ... }
}
```

---

### WR-02: "Copy public link" button shown for private trips

**File:** `frontend/src/pages/tripDetail.ts:558-571`

**Issue:** The copy-link button is revealed when `trip.public_slug` is truthy. Because `schema.ts:57` sets `public_slug` via `$defaultFn(() => crypto.randomUUID())` and migration `0002` defaults it with `gen_random_uuid()` for all rows, every trip has a non-null `public_slug`. As a result, owners of private trips (`is_public = false`) always see the "Copy public link" button. Clicking it produces a URL that returns 404 for guests, because `getTripBySlug` filters `is_public = true`.

Also, lines 558-563 contain a duplicate `if (copyLinkBtn && trip.public_slug)` guard — the button reveal and the click handler are inside two separate identical checks.

**Fix:**
```typescript
// Gate on both is_public AND public_slug, and combine into one block:
if (copyLinkBtn && trip.is_public && trip.public_slug) {
  copyLinkBtn.removeAttribute('hidden');
  const slugForCopy = trip.public_slug;
  copyLinkBtn.addEventListener('click', async () => {
    const url = `${window.location.origin}${window.location.pathname}?slug=${slugForCopy}`;
    await navigator.clipboard.writeText(url);
    setText(copyLinkBtn, '¡Copiado!');
    setTimeout(() => { setText(copyLinkBtn, 'Copiar enlace público'); }, 2000);
  });
}
```

---

### WR-03: Unguarded property access in day-filter click handler

**File:** `frontend/src/pages/tripDetail.ts:282-285`

**Issue:** `target.dataset.day` is non-null asserted on line 246 (`selectedDay = target.dataset.day!`). Then on line 282, `data.days[selectedDay]` is accessed without a guard. If `selectedDay` doesn't exist as a key in `data.days` (possible if the UI is in a transitional state or a button survives a re-render), `dayData` is `undefined` and `dayData.label` on line 283 throws a TypeError.

**Fix:**
```typescript
const dayData = data.days[selectedDay];
if (!dayData) return;
announceToScreenReader(
  `Mostrando ${dayData.label}: ${markersByDay[selectedDay].length} ubicaciones`
);
```

---

## Info

### IN-01: Slug regex is too permissive

**File:** `backend/src/routes/public.ts:21`

**Issue:** The regex `/^[0-9a-f-]{36}$/` accepts any 36-character string of hex digits and hyphens — including `------------------------------------` (36 hyphens) or `aaaaaa-aaa-aaa-aaa-aaaaaaaaaaaaaa00` (wrong UUID structure). These pass the 400 guard and reach the database, which rejects them as `invalid input syntax for type uuid`, surfacing as a 500 instead of the cleaner 400.

**Fix:** Use the canonical UUID v4 regex:
```typescript
if (!slug || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(slug)) {
```

---

### IN-02: `updateHotelInfo` parameter type does not match runtime usage

**File:** `frontend/src/pages/tripDetail.ts:389`

**Issue:** `function updateHotelInfo(hotel: Hotel)` declares `hotel` as non-nullable, but line 391 guards `if (!hotelInfo || !hotel) return`, implying callers can pass `undefined`. The TypeScript signature hides the possibility from callers and suppresses a type error that would otherwise catch a missing hotel.

**Fix:**
```typescript
function updateHotelInfo(hotel: Hotel | undefined): void {
```

---

### IN-03: `getTripById` makes two redundant database roundtrips

**File:** `backend/src/db/queries/trips.ts:48-75`

**Issue:** The function first runs a plain `select` to check existence (lines 49-54), then immediately runs `db.query.trips.findFirst` with the same `where` clause to get the nested result. The first query is unnecessary since `findFirst` already returns `undefined` when no row matches.

**Fix:** Remove the initial `select` check and use only the `findFirst` result:
```typescript
export async function getTripById(db: Db, tripId: number, userId: number) {
  return db.query.trips.findFirst({
    where: and(eq(trips.id, tripId), eq(trips.user_id, userId)),
    with: { destinations: { ... } },
  });
}
```

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
