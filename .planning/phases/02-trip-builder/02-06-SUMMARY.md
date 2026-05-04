---
phase: 02-trip-builder
plan: "06"
subsystem: frontend
tags: [trip-edit, hotel, upsert, geocoder, XSS-safe, MPA]
dependency_graph:
  requires: [02-04, 02-02]
  provides: [hotels-module, renderHotelSection]
  affects: [02-05, 02-07, 02-08]
tech_stack:
  added: []
  patterns: [singleton-modal, cloneNode-listener-swap, setText-XSS-safe, geocoder-widget]
key_files:
  created:
    - frontend/src/pages/trip-edit/hotels.ts
  modified: []
decisions:
  - "Singleton modal pattern: buildModal() called lazily on first openModal() and guarded by `if (modalOverlay) return` — mirrors destinations.ts pattern; prevents N modals in DOM for N destinations"
  - "lat/lng sent as Number (not string) to match ApiHotel interface Partial<Omit<ApiHotel,'id'>>; backend Zod accepts string | null but frontend types enforce number — conditional spread used to omit when empty"
  - "hotel.url rendered via setText as plain text paragraph (never as anchor href) — prevents javascript: URL injection; T-02-06-01 mitigated"
  - "cloneNode(true) swap on #confirm-delete-btn and #confirm-cancel-btn each open — removes stale listeners from prior entity type (destination or hotel)"
  - "renderHotelDisplay separated from renderHotelSection to allow re-render after upsert/delete without re-creating event listeners on the container itself"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-03"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Phase 02 Plan 06: Hotel Section Module Summary

Hotel upsert/delete section per destination with singleton modal, geocoder widget, XSS-safe DOM, and shared confirm-overlay using cloneNode listener swap.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create hotels.ts module (upsert + delete + geocoder) | fe36f5b | frontend/src/pages/trip-edit/hotels.ts |

## Decisions Made

1. **Singleton modal**: `buildModal()` is guarded by `if (modalOverlay) return` — called lazily on first `openModal()` call. Module-scoped `currentTripId`, `currentDest`, `currentContainer` are set before each open, same pattern as destinations.ts's `currentTrip`/`currentTripId`.

2. **lat/lng typing**: Backend Zod schema uses `z.string().nullable().optional()` but frontend `ApiHotel` interface has `lat: number, lng: number`. The `upsertHotel` signature is `Partial<Omit<ApiHotel, 'id'>>` which makes lat/lng `number | undefined`. Conditional spread used: `...(rawLat ? { lat: Number(rawLat) } : {})` — omits coord when input is empty, passes number when set.

3. **URL as plain text**: `hotel.url` rendered via `setText(el, hotel.url)` into a `<p>` element. No anchor element created, no `href` assigned. Threat T-02-06-01 fully mitigated.

4. **cloneNode swap**: Shared `#confirm-overlay` buttons are cloned on each delete open to remove stale listeners — prevents a hotel delete listener from firing after a subsequent destination delete operation.

5. **renderHotelDisplay internal function**: Separated from `renderHotelSection` export so that upsert/delete handlers can call re-render after mutating `dest.hotel`, without re-registering the outer `renderHotelSection` context.

## Deviations from Plan

None — plan executed exactly as written. The plan's example payload used `lat: null` which would be a TypeScript error; the implementation uses conditional spread (same pattern as destinations.ts) which is compatible with both the TypeScript types and the backend schema.

## Known Stubs

- `renderHotelSection` is implemented but not yet wired into destinations.ts. The destinations.ts `dest-section-body` still shows 'Hotel y días aparecerán aquí.' placeholder text. Wiring is expected in plan 02-05 or a subsequent plan that modifies destinations.ts.

## Threat Flags

None — all threat register mitigations implemented:
- T-02-06-01: hotel.url rendered via setText as plain text paragraph (not anchor href)
- T-02-06-02: Backend Zod `z.string().url().nullable().optional()` rejects non-URL strings
- T-02-06-03: Backend resolveDestination() checks trip ownership (pre-existing, not frontend concern)
- T-02-06-04: All hotel fields (name, url, dates) rendered via setText/textContent

## Self-Check

- [x] frontend/src/pages/trip-edit/hotels.ts exists
- [x] exports `renderHotelSection`
- [x] imports `upsertHotel`, `deleteHotel` from @/api/client
- [x] contains "Sin hotel asignado." (empty state)
- [x] contains "Esta acción no se puede deshacer." (confirm message)
- [x] contains "Agregar hotel" and "Editar hotel" (modal title strings)
- [x] no `innerHTML` usage
- [x] no `a.href` usage (url not rendered as anchor)
- [x] `hotel.url` rendered via `setText`
- [x] `cd frontend && npx tsc --noEmit` exits 0
- [x] commit fe36f5b exists

## Self-Check: PASSED
