# Trip creation UX

Owner brief: *a user should be able to watch the demo and say "I want to build a
trip like this and see it the same way".* Creating a trip is the point of the
app, so the editor is built around the demo's mental model, not around the
database tables.

## What the demo teaches

The demo (landing `#demo`, then `tokyo.html`, `kyoto.html`...) is three ideas:

1. **A route.** A map with numbered, coloured squares (1 Tokyo, 2 Nagoya...)
   joined by a dashed line, and a grid of "Cities" cards with the same numbers
   and short dates (`22 Feb – 1 Mar`).
2. **Days.** Inside a city, day chips (`Sun 22`) filter the map; each day has
   its own colour.
3. **Places.** Numbered squares in day colour, optional alternatives as dashed
   purple `A`/`B`, a hotel `H`, "general area" items without a pin, and per
   place: name, note, time, "View on Maps" and "Directions".

The old editor exposed none of that. It was a form per table (trip, destination
modal, day modal, activity modal, hotel form), each with its own Save button,
no map, no order guarantee (`order_index` was never sent and the API defaults
it to 0), and the geocoder was a "type, press Search, copy coordinates" box.

## The journey

```
 1 Trip            2 Route & places                       3 Share
 name, dates   ->  add cities by searching a place    ->  checklist, public link,
 (cover, text      (map + dashed route appear live)       "View trip"
  tucked away)     per city: day chips, add places,
                   drag to order, hotel
        \_______________ live preview, always on screen ______________/
```

* **Create.** `trip-edit.html?new=1` (the dashboard "New trip" can link here):
  name + optional dates -> "Create trip and continue". Dates are optional; they
  only unlock day chips.
* **Add destinations.** One search box: "Where to first?". Results (type-ahead,
  or a pasted Google Maps link) add a numbered stop. The map pans, the dashed
  route grows, the card appears in the "Cities" list. Dates are suggested: the
  first city starts on the trip start, each next one the day the previous
  ends. Reorder with the handle (drag) or the up/down buttons.
* **Per city.** Day chips for the city's date range (created on first use, so a
  60-day range does not fire 60 requests). Pick a day, search a place or click
  the map ("Drop a pin"), and it is added with the day's colour and number.
  Drag to reorder; tick "Alternative" (A/B) or "General area"; time and note on
  the row; "Details" (progressive disclosure) holds the Google Maps link, change
  location, and the rest. One click fills the Google Maps link from the pin.
* **Preview is not a mode, it is the other half of the screen.** The right pane
  is the demo: on the route it is the overview map plus "Cities" cards, inside
  a city it is the day chips, the map markers and the day legend, using the
  same CSS classes as `tokyo.html`. Selecting in either pane selects in the
  other.
* **Share.** Checklist ("2 destinations, 5 places, 1 place without a map
  location"), "Make public" with copy-link, and "View trip" (the read-only trip
  page).

## Layout

```
 desktop (>= 960px)                                mobile (375px)
+-------------------------------------+---------+   +---------------------------+
| <- My trips   Japan 2026   Saved v  | View    |   | <- Trips  Japan 2026 Saved|
+----------------------+--------------+---------+   | [ Plan ] [ Map & preview ]|
| 1 Trip > 2 Route > 3 Share |  map (sticky)     |   +---------------------------+
|                      |                        |   | 1 Trip > 2 Route > 3 Share|
| [search a city...  ] |   (1)---(2)---(3)      |   | [search a city...       ] |
| (1) Tokyo  22-1 Mar  |      dashed route      |   | (1) Tokyo   22 Feb - 1 Mar|
| (2) Kyoto  8-13 Mar  +------------------------+   | (2) Kyoto   8 - 13 Mar    |
|                      |  Cities  (cards)       |   |                           |
+----------------------+------------------------+   +---------------------------+
```

City view replaces the list in the left pane with: `<- All destinations`,
city name and dates, day chips, the day's places (cards with number, name,
time, flags, move/delete), the "add a place" search, and the hotel.

## Decisions

* **No Save button for content.** Edits are applied locally at once and sent
  by a serial queue (`saveQueue.ts`): debounced per row, in order, one at a
  time. The header says `Saving…`, `Saved`, `Offline - will save when you are
  back`, or `Couldn't save · Retry`. Transient failures retry with backoff;
  `422/404/409` are reported and dropped, with a "Reload" escape.
  Leaving the page with unsent edits prompts.
* **Deletes are undoable, not confirmed.** The row disappears, a snackbar
  offers Undo for 7 s, and the `DELETE` is sent only afterwards (or when the
  page hides). Confirm dialogs are for nothing in this flow.
* **Days are virtual until used.** The chips come from the city's date range;
  a `days` row is created when the first place is added to it.
* **`order_index` is always sent** on create, and reorder renumbers (a bug of
  the old editor).
* **The geocoder is type-ahead sized for its limit** (20 searches/min/user):
  650 ms pause, 3+ characters, client cache, stale answers dropped. The demo
  build (browser to Nominatim) searches only on Enter. A pasted Google Maps
  link never touches the network.
* **Names, notes and links are only ever set with `textContent`/`href` after
  validation** (`http(s)` only). Hostile strings are data.
* **Accessibility.** Every control is a real button/input with a label;
  reordering has buttons (and Alt+Arrow on the drag handle) as well as pointer
  drag; status and undo are live regions; the map has a keyboard alternative
  for everything it does (search, buttons); `prefers-reduced-motion` removes
  transitions; focus is restored after deleting/undoing.
* **Light/dark parity** comes only from the site's `--jp-*` tokens; the
  editor's CSS lives in `src/styles/trip-edit.css`.

## Backend gaps (not changed)

* No reverse geocoding: clicking the map yields coordinates, not a place name;
  the user names the pin.
* No bulk endpoints (create days/activities in one call, reorder destinations).
  The queue keeps the cost to one small request per change.
* `cover_image_url` is a plain URL field; there is no upload endpoint.
* Place details (opening hours, photos) are out of scope: the geocoder returns
  only `{lat, lon, display_name}`.

## Screens (Playwright chromium, mocked API, blank map tiles)

`docs/design/trip-creation-screens/`: `route-*`, `city-*`, `share-*`, `trip-*`,
`new-*` at 375 and 1280 px, light and dark (`*-375-plan` / `*-375-map` are the
two phone tabs), plus `s-*` for search results, empty route, undo snackbar and
the save-failure banner. The map is grey/purple only because tile requests are
stubbed in the harness.

### Honest critique and what changed

Compared with the demo, the right pane is recognisably the same product:
red/orange/yellow numbered squares, dashed route, "Cities" cards, day chips,
dashed-purple options, the orange H. Round 1 findings, fixed:

* time field clipped to "09:00 A" -> wider; step label "Route & places"
  wrapped on phones -> "Route"; arrival/departure stacked on phones -> two
  columns; "General area" markers looked disabled like unpinned ones -> only
  genuinely unlocated places are dimmed.
* free-text "Add without a map location" was offered while a search was still
  loading and could be clicked by mistake -> only after the search settles.
* save indicator stayed "idle" during the debounce -> "Saving…" immediately.
* Back/forward on a phone left the Map tab open over the new screen -> the
  Plan tab is restored on navigation.

Round 2 findings, fixed: the failure banner scrolled out of sight and, once
sticky, let text show through (alpha background) -> sticky with an opaque base.

Still different from the demo: no real tiles in these captures; the demo's
page is a single card, the editor is two panes by necessity; the legend's
action buttons go full width on phones (the demo's own mobile rule).

## Tests

* unit (`frontend/tests/trip-edit-*.test.ts`): model, save queue, place
  search, store (ids, debounce, undo, reorder, failures), nav/sortable/
  reconcile/h(), views in jsdom, status wording, auth bootstrap.
* e2e (`tests/e2e/trip-edit.spec.ts`, `trip-edit-resilience.spec.ts`, with the
  stateful `fixtures/mockTripStore.ts`): the full journey with reload
  persistence and the "break it" scenarios listed in the brief.
* `trip-edit-integration.spec.ts` and `new-user-trip-creation.spec.ts` follow
  the new selectors but need a live backend + Keycloak (fixme'd in CI).

## Known gaps

* The dashboard "New trip" modal still creates the trip itself and sends the
  user to the trip view; `trip-edit.html?new=1` is the new first step and is
  ready to be linked from there (dashboard is another owner's file).
* Deleting then closing the tab within the 7 s undo window relies on a
  best-effort flush at `pagehide`; a `keepalive` fetch would make it exact.
* No pointer-drag of pins on touch (Leaflet marker dragging works, but there
  is no equivalent keyboard way to nudge a pin; use "Change location").
* Moving a place to another day is not offered (delete and re-add).
