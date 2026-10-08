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
