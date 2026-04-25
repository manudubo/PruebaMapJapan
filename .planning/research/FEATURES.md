# Features Research

**Domain:** Trip planning web app (desktop-primary, map-centric, personal itinerary builder)
**Researched:** 2026-04-25
**Confidence:** MEDIUM — web search unavailable; findings based on codebase analysis + domain knowledge of Wanderlog/TripIt/Google Trips patterns as of mid-2025. Core table stakes are well-established and unlikely to have shifted significantly.

---

## Table Stakes (must have for v1)

These are features that, if missing, make the product feel like a skeleton rather than a trip planner.

### 1. Inline-editable trip metadata (name, dates, description, public/private toggle)
The trip detail page currently has a read-only header. Users expect to click the title and edit it in place, or reach a settings panel from the trip view. Navigating back to the dashboard just to rename a trip is a dead-end UX. The PATCH `/api/trips/:tripId` endpoint exists; only the UI is missing.

### 2. Add/remove destinations from the trip builder
The central interaction: users must be able to add a city (name + country + dates) to their trip and see it appear as a tab. Currently zero UI for this. The `POST /api/trips/:tripId/destinations` endpoint exists. Destination needs a geocoded lat/lng for the map — use Nominatim (OSM, free) rather than Google Places.

### 3. Hotel per destination: add/edit from the UI
Every trip planning app surfaces accommodation prominently — it anchors everything else (check-in/out dates, hotel marker on map). The backend has `PUT /api/trips/:tripId/destinations/:destId/hotel`. The UI needs a simple form: name, check-in, check-out, optional lat/lng.

### 4. Add/edit/delete days within a destination
Days are the backbone of an itinerary. Users create a day by picking a date; they expect to label it ("Day 1 – Arrival", "Day 3 – Kyoto temples") and give it a color. The existing schema supports `label` and `color_hex`. Days must be addable and deletable from the trip view.

### 5. Add/edit/delete activities within a day
The most frequently used action. Each activity needs: name (required), optional notes, optional lat/lng for the map pin, optional Google Maps URL. The backend has all CRUD + reorder. The UI must expose a form (modal or inline panel) for creating and editing activities.

### 6. Activity reorder within a day
The backend already has `POST .../activities/reorder`. Without UI-level reorder, users will add activities in the wrong order and have no recourse. At minimum: up/down arrow buttons per activity. Drag-and-drop is a differentiator, not table stakes, for vanilla TS without a framework.

### 7. Map synchronization: clicking an activity in the list highlights its pin
This is the defining pattern of map-centric trip apps (Wanderlog, Google Maps custom lists). The reverse direction (click a pin to highlight list item) is a differentiator. The current read-only view does not do this bidirectionally. It is essential in edit mode too — as the user adds activities they need visual confirmation of where they land on the map.

### 8. Geocoding for destinations and activities: coordinate input
The map only works with lat/lng. The user must be able to attach coordinates to a destination, hotel, and activity. Table stakes minimum: a text input that accepts a place name and resolves to coordinates via Nominatim. An explicit lat/lng input pair is an acceptable fallback. Google Maps URL parsing (extract coordinates from the URL) is also acceptable.

### 9. Public/private toggle with shareable link
The backend already marks trips `is_public` and serves them from `/api/public/trips/:tripId`. Users need a UI affordance — a toggle on the trip page — plus the ability to copy the shareable URL. The shared link must open a clean read-only view (no edit affordances shown to non-owners).

### 10. Delete trip with confirmation
Without this, users accumulate test trips and can't clean up. The DELETE endpoint exists. Confirmation dialog prevents accidental loss.

---

## Differentiators (nice to have)

Features that improve the product meaningfully but are not blocking for v1. Complexity is relative to implementing in vanilla TypeScript + Web Components without a UI framework.

| Feature | Value proposition | Complexity |
|---------|-------------------|------------|
| Drag-and-drop activity reorder (mouse + touch) | Standard UX in Wanderlog/TripIt; up/down buttons are functionally equivalent but feel dated | High — requires HTML5 DnD or a lightweight lib; touch support adds significant edge cases |
| Click map pin → scroll to matching activity in legend | Closing the map↔list loop makes the trip feel spatially coherent; important for reference during travel | Medium — needs bidirectional marker↔DOM binding |
| Route polyline between activity pins | Shows the day's movement at a glance; standard in route-heavy planners (Roadtrippers) | Medium — Leaflet polylines on day filter change |
| Cover image upload/URL for trip card | Makes dashboard visually scannable when user has multiple trips | Low for URL input, Medium for upload (needs storage) |
| Day color picker | Schema supports `color_hex`; color coding days significantly improves map legibility with multiple days | Low — native `<input type="color">` works, CSS variable for marker color already exists |
| Duplicate trip | Copy an existing itinerary as a starting point for a similar trip | Medium — needs deep copy across all nested entities |
| Export to PDF / print view | Useful for offline reference; many users print their itinerary | Medium — CSS print media query + `window.print()` |
| "Directions" link between sequential activities | Opens Google Maps directions between activity N and N+1 | Low — construct URL from adjacent lat/lng pairs |

---

## Anti-features (don't build in v1)

Things that category leaders have but this product should deliberately skip.

| Anti-feature | Why to skip | What to do instead |
|--------------|-------------|-------------------|
| Place autocomplete (Google Places API) | Requires paid Google Maps Platform key at any meaningful volume; quota-limited on free tier | Use Nominatim (free, OSM-based); quality is acceptable for well-known places |
| Flight/hotel/booking aggregation (TripIt import, booking email parsing) | Requires third-party integrations, email parsing, or paid APIs; TripIt's core value, not this app's | Manual hotel entry via form is sufficient; users copy info from booking confirmation |
| AI itinerary suggestions | Explicitly out of scope in PROJECT.md; adds complexity and cost | User builds manually |
| Social feed / trip discovery | Explicitly out of scope; trips are personal + optionally public-linkable | Public share link is sufficient |
| Collaborative editing (multi-user trip) | Requires conflict resolution, real-time sync, permissions model; Notion-level complexity | Owner-only edit; share link is read-only |
| Offline PWA with full sync | Service worker + background sync for editing is high complexity; offline read cache is feasible but low priority | Focus on reliable online experience first |
| Expense tracking | Needs its own data model (new entities, currency, split logic); Splitwise territory | Out of scope for this model; no new entities in v1 |
| Packing list / checklist | Wanderlog has this; doesn't map to the trips→days→activities model; requires new entity | Not useful for the core value proposition of map visualization |
| Custom map styles / satellite view | Mapbox custom styles require paid API; OSM tile variety is limited | Dark/light tile layer toggle already exists; that's enough |

---

## UX Patterns Observed

These patterns are standard across Wanderlog, TripIt, and Google Travel as of 2025:

**Split-pane layout (list left, map right)**
The dominant layout for desktop trip builders. Left panel shows the day-by-day itinerary list; right panel shows the Leaflet/Mapbox map. Both panels scroll independently. Clicking an item in the list pans/zooms the map; clicking a pin highlights the list item. This app's current layout (map above legend, stacked vertically) works for read-only mobile but is suboptimal for desktop editing. The builder should adopt the split-pane pattern for `trip.html` on wider viewports.

**Inline editing over modal editing**
Wanderlog and modern Notion-style apps favor clicking directly on a field name to make it editable (contenteditable or a toggled input) rather than opening a modal. Modals are acceptable for structured forms (add destination, add hotel) but feel heavy for quick text edits. For activities: click name → inline edit; for structured data (dates, coords) → modal or side panel.

**Day tabs / accordion, not page navigation**
Days within a destination are surfaced as tabs or collapsible sections, not as separate pages. The current day-selector buttons already implement the tab filter pattern — this should be extended to the builder.

**Progressive disclosure for complex fields**
Activity name is always visible; notes, coordinates, maps URL are in a secondary "details" panel (expand arrow or "more options" toggle). This keeps the activity list scannable.

**Empty-state CTAs**
Wanderlog shows "Add your first place" with a large call-to-action when a day has no activities. Without this, new users don't know how to start. Every empty list (no destinations, no days, no activities) needs a visible add button.

**Confirmation on destructive actions**
Deleting a destination cascades to all its days and activities. TripIt shows a modal with item count ("This will delete 8 days and 34 activities"). This pattern is essential to prevent rage-quits.

**Shareable link on the trip detail page**
The share affordance should live on the trip detail page itself, not buried in settings. Pattern: a "Share" button that copies the public URL to clipboard when clicked, with a success toast. The URL format `trip.html?tripId=<id>` already supports this.

---

## Feature Dependencies

Dependencies flow top-to-bottom: a feature cannot be built without the feature(s) it depends on.

```
Create trip (exists)
  └── Add destination (needs geocoding for lat/lng)
        ├── Add hotel (per destination)
        ├── Add day (per destination, needs date within destination's date range)
        │     └── Add activity (per day, needs geocoding for lat/lng)
        │           └── Reorder activities (needs activities to exist)
        └── Map sync (needs destinations + activities with coords)

Public/private toggle (needs trip to exist; backend is ready)
  └── Shareable link copy (needs toggle; URL format already works)

Delete activity → Delete day → Delete destination → Delete trip
  (each cascades to children; confirmations at each level)
```

**Geocoding is a cross-cutting concern**: destinations, hotels, and activities all need lat/lng for the map. If geocoding is not addressed early, the map remains empty for all new user-created content. Nominatim integration should be built as a shared utility used by all three add-forms.
