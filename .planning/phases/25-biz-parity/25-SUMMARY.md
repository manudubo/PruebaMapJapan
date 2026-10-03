---
phase: 25-biz-parity
subsystem: backend validation, trip adapter/view, trip editor forms, date handling
tags: [business-logic, demo-parity, validation, timezone, v3.2]
requirements: [BIZ-01, BIZ-02, BIZ-03, BIZ-04, BIZ-05, BIZ-06, BIZ-08, BIZ-09, BIZ-10, BIZ-11, ARCH-05]
deferred: [BIZ-07]
key-files:
  created:
    - backend/src/validation/validator.ts
    - backend/src/validation/schemas.test.ts
    - backend/src/routes/trips-validation.test.ts
    - frontend/src/modules/dates.ts
    - frontend/src/pages/trip-edit/formHelpers.ts
    - frontend/tests/{dates,tripAdapter,tripDetail-view,formHelpers,i18n-residue,widgets-weather}.test.ts
    - frontend/tests/trip-edit-{days,activity-form,destination-form,hotel-metadata-form}.test.ts
  modified:
    - backend/src/validation/schemas.ts
    - backend/src/index.ts            # onError keeps 4xx HTTPException status
    - backend/src/routes/trips.ts     # import line only (zValidator → validation/validator)
    - backend/src/routes/users.ts     # import line only
    - frontend/src/modules/{tripAdapter,search,utils,widgets,map}.ts
    - frontend/src/pages/{tripDetail,dashboard}.ts
    - frontend/src/pages/trip-edit/{activities,destinations,hotels,metadata,days}.ts
    - frontend/src/api/client.ts      # ApiError carries 422 issues
    - frontend/src/types/index.ts
    - frontend/src/styles/main.css
completed: 2026-09-30
---

# Phase 25: Business Logic & Demo Parity — Summary

All Phase 25 items except BIZ-07 (cross-level date coherence in route
handlers — deferred because `trips.ts` is being refactored in parallel),
plus ARCH-05. No DB migration was needed.

## Per-item result

| ID | Result |
|----|--------|
| BIZ-01 | "Alternative option" checkbox in the activity modal. `optional_label` (phantom) removed from `ApiActivity`; `apiDayToDay` labels a day's optional activities A, B, C… by order (was: every one "A"). Editor rows show an *Option* tag. |
| BIZ-02 | `is_generic` added to `CreateActivitySchema`/`UpdateActivitySchema` (was stripped by `z.object`). "General area, not an exact spot" checkbox; *Area* tag. |
| BIZ-03 | `maps_url` → adapter `mapsUrl` (http/https only) → view. Editor "Google Maps link" input (also auto-filled when a Google Maps URL is pasted into the location search). View link = saved link → demo static table (kept as fallback) → pin search derived from coordinates. |
| BIZ-04 | `time` → adapter → popup day line and legend (`<time>` element). Schema now requires `HH:MM[:SS]`. |
| BIZ-05 | Destination "Map zoom" slider (1–19, default 12, pre-filled). Adapter: null `zoom_level` → 12; destination with no coordinates centres on hotel → first located activity → world view (zoom 2). |
| BIZ-06 | Null-safe `superRefine` on trip, destination, hotel (only when both dates present; equal allowed; string compare on validated `YYYY-MM-DD`, no Date parsing). Mirrored client-side in all three forms with linked date-picker min/max. |
| BIZ-08 | `coordinate()` schema: JSON number or plain decimal string; rejects `"null"`, `"NaN"`, `""`, hex, exponent, `Infinity`; enforces ±90/±180; outputs a string for the NUMERIC columns. Adapter `toCoords()` returns `undefined` for missing/invalid pairs (Leaflet used to coerce null → pin at 0,0). |
| BIZ-09 | `atLeastOneField` refine on every PATCH schema (trip, destination, day, activity, user). New `validation/validator.ts` wrapper answers all body-validation failures with **422** `{ code: 'validation_error', issues: [{path, message}] }`; `trips.ts`/`users.ts` changed on their import line only. `auth.ts` keeps the library validator (OTP e2e asserts 400). |
| BIZ-10 | tripAdapter "Desde/Hasta" → "From/Until"; hotel form "Nombre" → "Name"; legend CSS badge "Opcional" → "Optional" (found by the screenshot check). New `i18n-residue.test.ts` scans `src/` (TS + CSS, excluding demo data) for Spanish UI words. |
| BIZ-11 | `modules/dates.ts`: `parseLocalDate` (`new Date(y, m-1, d)` semantics, rejects impossible dates), `toIsoDate`, and DST-proof `addDays`/`daysBetween`/`eachDateInRange` on a UTC day count. Used in tripAdapter, dashboard, search (2 sites), weather weekday, `utils.formatDate`, and "Generate all days" (which also produced a **duplicate + missing day across US DST** — fixed; now also explains a reversed range and caps at 120 days). |
| ARCH-05 | Covered by BIZ-06/08/09 above. |
| BIZ-07 | **Deferred** — not started. |

### Extra fixes found while testing

- `app.onError` turned Hono's `HTTPException(400)` (malformed JSON) into a 500; 4xx HTTPExceptions now keep their status.
- `ApiError` dropped the error body; it now carries `message` and `issues`, and editor forms show 422 field messages instead of "Check your connection".
- Destination and hotel modals pre-filled null coordinates as the string `"null"` (BUG-11 only fixed activities).
- URL fields (`maps_url`, hotel `url`, `cover_image_url`, `avatar_url`) accepted `javascript:`/`data:` via `z.string().url()`; now http(s) only (schema + adapter + form).
- Days in the view are ordered by date (generated days all have `order_index` 0); two days on the same date no longer overwrite each other; unlabelled days get a demo-style "Sun 22" label.
- `.modal` scrolls on short viewports; editor activity rows wrap on phones (mobile screenshot showed names squeezed to nothing and Delete overflowing).

## Tests

At the final commit:

- Backend: `tsc` clean; Vitest **12 files / 460 tests** (was 10 / 63).
- Frontend: `tsc` clean; Vitest **23 files / 589 tests** (was 13 / 136); also run whole-suite with
  `TZ=America/Argentina/Buenos_Aires` and `TZ=Pacific/Auckland` (589/589 each). `vite build` OK.
- Timezone tests switch `process.env.TZ` per case across 13 zones (UTC−12 … UTC+14, half-hour
  offsets, Chile/Havana DST at local midnight, US/EU/NZ DST days). The BIZ-11 tests were run
  against the pre-fix code and fail there (negative-offset zones; New York DST duplicate).

Scenarios covered (unit/route level): lat/lng at exactly ±90/±180 and ±90.0000001/±180.0000001, `"999"`,
`"null"`, `"NaN"`, `""`, whitespace, hex, exponent, `Infinity`, booleans/objects; start < end,
equal, start > end (incl. across month/year), one side null/omitted, both null, malformed and
impossible dates, leap days; PATCH `{}`, unknown-only keys, explicit-undefined, null/false as
real changes, no `is_public` default injection, malformed JSON → 400; `javascript:`/`data:`/
`vbscript:`/`file:`/`ftp:`/schemeless URLs; time `24:00`, `9:05`, `morning`; several bad fields
reported at once; every editor field form → payload (create and edit), flag leakage between
modal openings, clearing fields, 422 vs network error text; optional + generic activity with
time and maps_url in a partial-date trip through adapter → legend/popup; legacy
`javascript:` maps_url in the DB never reaching an href; XSS in names stays text.

### End-to-end against a real Postgres engine (ad hoc, not committed)

Same approach as Phase 22 (the unit suite has no real DB — ARCH-06, Phase 24; `su`/`initdb`
is blocked in the sandbox): PGlite behind `@electric-sql/pglite-socket` (installed outside the
repo), migrations 0000–0003 applied, the real Hono app + node-postgres driver with only
`authMiddleware` mocked, and the frontend adapter imported into the same test. Flow: create
partial-date trip → 422s for `{}`, reversed dates, lat 91, lng "NaN" → destination with zoom 14
and a ±90/180 edge destination → hotel (reversed dates 422, equal dates OK) → "Generate all
days" dates → activities with every field (optional+generic+time+maps_url, optional, timed,
no-coords) → PATCH flags/clears → GET trip and public slug → adapter view asserted field by
field → a raw-SQL `javascript:` maps_url never reaches the view. **8/8 pass under
`TZ=America/Argentina/Buenos_Aires`, `Pacific/Auckland`, `UTC` and `Pacific/Kiritimati`**
(DATE columns come back unshifted).

### Visual check (Playwright/Chromium, ad hoc)

`trip-edit.html` and `trip.html` on the Vite dev server with Keycloak stubbed and the API
mocked; 1280×900 and 375×740, light and dark, browser timezone Buenos Aires / Auckland / LA.
Checked: activity modal (new fields, hints, error), destination modal (zoom slider, date error,
server 422 message), editor rows with tags, trip view legend (time, 1/A/B/4 markers, no pin
for the coordinate-less activity, no links on the area activity), popup (time + saved link),
no page errors, no horizontal overflow. Led to the "Opcional" and mobile-row fixes above.

## Decisions / deviations

- **422 wrapper touches `trips.ts`/`users.ts` by one import line each.** Kept that small on
  purpose for the parallel `trips.ts` refactor; if it conflicts, re-apply the import swap (or
  drop the commit — empty PATCHes would then be 400 instead of 422, still rejected).
- **PATCH with only one date** (e.g. only `end_date`) is not compared with the stored other end —
  that needs the parent row and belongs with BIZ-07 in the route handlers.
- Coordinates stay string-typed at the DB/query layer (NUMERIC); the schema now guarantees they
  are finite in-range decimals. `ApiCoordinate = number | string | null` documents the wire format.
- Optional labels are derived (A, B, C…) rather than stored — no migration. The demo's numeric
  "1/2/3" option groups are not reproducible; that would need a real `option_label` column.
- `time` now validated as `HH:MM[:SS]`; any pre-existing free-text times in the DB still render.
- Zoom slider range 1–19 (API allows 20, tiles stop at 19; a stored 20 shows as 19).

## Follow-ups

- BIZ-07 (route handlers, after the `trips.ts` refactor lands), including the single-date PATCH case.
- `getDb()` creates a new `pg.Pool` per request in local mode (found in the E2E harness:
  connections accumulate) — ARCH-01/M-01 territory.
- Route catch blocks still swallow errors (M-09).
