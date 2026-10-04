# QA: demo regressions (tiles, overview map, countdown)

Base: `claude/focused-lovelace-cryssy` @ `be13cef`. The live demo is deployed from `origin/main` (`3c147f6`) and has the same three defects.

Commits:

| Commit | Change |
|---|---|
| `75f549c` | Switch map tiles from CartoDB to keyless OpenStreetMap |
| `df8c2ef` | Document the OSM tile provider and its usage rules |
| `bb7bb28` | Restore the trip overview map and Cities list in the landing demo |
| `7482082` | Make the landing countdown minute-based and minimalist |

## 1. City maps show "API KEY REQUIRED" tiles

**Finding.** Every map (8 city pages and the trip page) showed a grey "API KEY REQUIRED carto.com/basemaps/apikey" image where the map should be.

**Cause.** `*.basemaps.cartocdn.com/{light_all,dark_all}` now answers every tile with **HTTP 200**, `image/png` and a 2049-byte placeholder (2513 bytes for the dark version). All e2e specs stub tiles and check only the status code, so nothing failed.

**Provider evaluation** (curl, 2026-10-04, tile 6/56/25):

| Provider | Result |
|---|---|
| CartoDB `basemaps.cartocdn.com`, `cartodb-basemaps-*.fastly.net` | 200, placeholder ("API KEY REQUIRED") |
| Stadia `alidade_smooth_dark` | 401, needs a key |
| Wikimedia `maps.wikimedia.org` | 403 for third-party sites |
| `tile.openstreetmap.org` | 200 with real tiles when a browser-like User-Agent and Referer are sent. Plain curl gets HTTP 200 with an **"Access blocked" placeholder** (the 6987-byte file mentioned in the brief is this placeholder, not a real tile). |
| openstreetmap.fr / .de, OpenTopoMap, Esri | 200, but they are community servers or need licence terms, and none offers a keyless dark set |

**Fix (`75f549c`).**

- **Tile source.** `src/data/tiles.ts` is the single tile config: OSM tile server, attribution and host list. Leaflet, the CSP `img-src` (`build/cspPlugin.ts` imports it) and the guard tests all read it.
- **Dark mode.** The same tiles are used, with `invert(1) hue-rotate(180deg) brightness(.92) contrast(.88) saturate(.7)` applied to `.leaflet-tile-pane` only, so markers, the route line and popups keep their colours. Switching theme no longer removes the layer or re-requests tiles; `switchBaseMapTheme` replaces the old swap path in `map.ts` and `tripDetail.ts`.
- **Shared base map.** `src/modules/baseMap.ts` is used by the city pages, the trip page and the overview map.
- **Attribution.** It is now shown (`attributionControl: true`): "Leaflet | © OpenStreetMap contributors", linking to `/copyright`.
  - It is restyled with `--jp-*` tokens for both themes and has a focus ring.
  - `.hotel-btn` moved up (bottom 20→28px) so it does not cover the attribution at 375px or 1280px.
- **Tile failure.** When no tile loads, a single `role="status"` notice reads "Map imagery could not load. Markers and links still work." It is removed on the first tile that loads.
- **Service worker.** `sw.js` lists `tile.openstreetmap.org` as network-only. Tiles are never intercepted or cached, as the OSM policy requires (no bulk or offline caching). There is no prefetching anywhere.
- **CSP.** `img-src 'self' data: https://tile.openstreetmap.org`. CartoDB is removed.

**Tests.**

- `tests/tile-provider.test.ts` (unit):
  - every theme's URL is https and on the allow-list
  - no host from `KEY_REQUIRED_TILE_HOSTS` (Carto, Stadia, Thunderforest, MapTiler, Mapbox)
  - no key/token parameter and no `{s}` in the URL
  - the attribution is present
  - CSP `img-src` matches the tile hosts
  - the SW treats tiles as network-only
  - the attribution control is rendered, and a theme switch issues no tile reload
  - the failure notice appears once and clears on the first loaded tile
- `tests/tile-guard.test.ts` (unit) tests `build/tileGuard.ts`, a PNG decoder plus classifier, against the **real placeholder bytes** saved in `tests/fixtures/tiles/`:
  - It rejects the Carto light and dark placeholders, the OSM 403 placeholder, the visually identical but byte-different OSM 418 placeholder, a blank 1x1 tile, and HTML or empty bodies.
  - It accepts two real OSM tiles.
- **Opt-in live check** (not in CI): `npm run check:tiles --workspace=frontend` (`NODE_USE_ENV_PROXY=1` behind a proxy). It downloads one Kyoto tile per theme with an identifying UA and Referer and classifies it.
  - It passes with OSM.
  - Mutation check: pointing light back at Carto makes both the live check and the allow-list tests fail.
- **E2E.**
  - `tests/e2e/map-tiles.spec.ts` (@qa-noauth): only the OSM host is requested; attribution is visible, links to `/copyright` and overlaps neither zoom nor hotel controls at 375 and 1280; tile 404 and abort produce the notice, markers still open popups, and there are no page errors; a theme toggle while tiles are slow causes no errors and the filter follows the theme.
  - `qa-frontend.spec.ts`: the theme-switch test now asserts the CSS filter and zero tile re-requests.
  - Fixture `stubMapThirdParty` now stubs `TILE_ROUTE` (OSM).
- **Docs (`df8c2ef`).** CLAUDE.md (key files, external APIs, `check:tiles`) and `.planning/codebase/INTEGRATIONS.md`.

## 2. The trip overview map disappeared from the demo

**Finding.** The landing `#demo` showed only a countdown and city chips. There was no whole-trip map.

**Cause.** `6ff0f80` ("Redesign UX: landing page…") replaced the Japan index with the generic hero and dropped the `#map[data-city=overview]` section and the "Ciudades" card grid. `initOverviewMap()` stayed in `map.ts` but no page used it.

**Source of the restored design.** `ab6b603`, the parent of `6ff0f80` and the last commit with the overview:

- markup: `git show ab6b603:frontend/index.html`, `.map-section` / `.quick-links` / `.cities-grid` / `.city-card`
- styles: `main.css` (the same rules still exist in `main.css`)
- behaviour: `initOverviewMap()` in `ab6b603:frontend/src/modules/map.ts`

That commit was built in a scratch copy (`git archive`), served on :5274 and screenshotted at light/dark × 375/1280. Its Carto tiles now return placeholders, so they were rewritten to the same z/x/y OSM tiles for the comparison.

**Fix (`bb7bb28`).**

- **Faithful to `ab6b603`:**
  - initial view `setView([35.5, 137], 6)`
  - 32px numbered squares in the original palette `#ff3b30 … #ff2d55`
  - the same marker coordinates, including Tokyo-return nudged off marker 1
  - dashed route in visiting order (weight 2, opacity .5, dash `8, 8`, theme route colour)
  - popup `<h4>City</h4><p>dates</p><p><a>View itinerary</a></p>`
  - a 500px map edge-to-edge in a `.page-card`, followed by the **"Cities"** `.quick-links` grid of 8 `.city-card` links (number square, name, short dates)
- **Placement.** Inside `#demo`, after the countdown. The old city chips are replaced by the cards.
- **New module.** `src/modules/overviewMap.ts`. Stops are derived from `src/data/itinerary.ts` (order, names, links, dates).
- **Lazy initialisation.** `IntersectionObserver` with a 200px margin, falling back to immediate init. No Leaflet layout and no tile request happen until the demo is near the viewport, so the hero/LCP is untouched. On a throttled 50 KB/s, 400 ms RTT profile the hero showed in about 3.3 s with the map not yet initialised.
- **Accessibility.**
  - The map has `role=application`, `aria-label="Map of the Japan 2026 trip"` and an sr-only usage hint.
  - Markers are focusable buttons labelled "4. Kyoto, 8–13 Mar – show details". Enter opens the popup and focuses "View itinerary".
  - Cards are real links. Tokyo-return has an sr-only "(return)".
- **Selection sync.**
  - Map to list: clicking or Enter on a marker marks its card `.is-selected` and `aria-current`; closing the popup clears it.
  - List to map: hovering or focusing a card highlights its marker with an outline. Activating a card navigates, as in the original.
- **Tiles.** Same base map as the city pages (OSM, attribution, dark filter, failure notice). The cards keep working without tiles or JS.

**Tests.**

- `tests/overview-map.test.ts` (unit):
  - stops and the original palette
  - itinerary order and links
  - unique labels
  - markers: count, numbers, tabindex, role, labels
  - route points, order and style, plus its theme colour
  - popup content and link
  - selection sync both ways, and clear on close
  - sanitised popups
  - lazy observer: fires once, then disconnects, with the no-IO fallback
  - `index.html` cards match the stops
  - order countdown → map → cards
- `tests/map-aria-label.test.ts`: the overview map is inside `#demo`.
- `tests/e2e/overview-map.spec.ts` (@qa-noauth):
  - lazy: no map and no tile requests before scrolling
  - 8 markers in order, the dashed path and the attribution
  - clicking a marker opens the popup, selects the card, and "View itinerary" goes to `/PruebaMapJapan/osaka.html`
  - keyboard Enter opens the popup and focuses the link
  - a card highlights its marker and navigates to `/PruebaMapJapan/hakone.html`
  - tiles blocked: notice shown, markers and cards still work
  - no overflow at 375px
- `landing.spec.ts`, `search.spec.ts` and `qa-followup.spec.ts` moved from `.city-chip` to the city cards.

**Old vs new (pixel diff, 4 viewports, rows below the countdown, threshold ΔRGB>48).**

| Viewport | Differing pixels | What differs |
|---|---|---|
| light 1280 | 0.9–1.2 % | "Ciudades" → "Cities", the attribution box, anti-aliasing of the route |
| light 375 | 2.8 % in the first run, 11.5 % in a re-run | The re-run had a 1px sub-pixel scroll offset that shifts map texture; markers and cards still line up. |
| dark 375 / 1280 | 43–56 % | **Intentional.** The old dark theme used Carto `dark_all`, which no longer works (the old render here shows light OSM). The new dark theme is the CSS-filtered OSM tiles. Markers, route, cards and layout match. |

**Remaining intentional differences from `ab6b603`:**

- tile imagery: OSM instead of Carto; dark mode is a CSS filter
- visible OSM/Leaflet attribution (licence requirement)
- English copy ("Cities", "View itinerary") to match the current app
- placement inside `#demo` below the new hero and countdown, instead of the old Japan header
- the map initialises lazily
- route colour follows the theme live (the old one fixed it at load)
- accessibility additions: marker labels and roles, focus outlines, sr-only hints, `aria-current`
- card `.is-selected` / marker `.is-highlighted` states
- no hover lift on cards (already flattened in the current `main.css`)
- the tile-failure notice

## 3. Countdown: remove seconds, make it minimalist

**Finding.**

- The demo countdown ticked every second. It lived in an inline `<script>` in `index.html` with no tests, and sat inside `aria-live="polite"`, so screen readers could announce it every second.
- The landing's `.countdown-*` rules were overridden by legacy `main.css` rules, so the digits were accent blue at 48px.
- `src/modules/countdown.ts` drove a `#countdown` section that no page renders (dead since `6ff0f80`).

**Fix (`7482082`).** `countdown.ts` now owns the landing countdown and the inline script is gone.

- **Display.** Days, hours and minutes only.
- **Start date.** From `data-trip-start="2027-02-22"`, parsed as a **local** calendar date with `dates.ts parseLocalDate`.
- **Calendar days.** Wall-clock day stepping, so a DST change never shows 23 or 25 hours.
- **Rounding.** Partial minutes round **up**, so the display never shows 0 while time remains. 60 min carries into 1 h and 24 h into 1 day.
- **Updates.** One `setTimeout` chain aligned to the next minute boundary, so there is no per-second work and no drift.
- **Hidden tab.** Paused while `document.hidden`, and caught up immediately on `visibilitychange`.
- **Cleanup.** `initCountdown()` returns a cleanup function. It also stops itself if the node is detached.
- **Trip started or finished.** The whole block is hidden, which is the existing behaviour. The same happens for an invalid date.
- **Accessibility.** `role="timer" aria-live="off"`, with the unit boxes `aria-hidden` and an sr-only sentence ("140 days, 4 hours and 3 minutes until the trip"). Nothing is announced on its own; readers get it on demand.
- **Visual.** No boxes. A quiet "UNTIL THE TRIP" title, `clamp()`-sized tabular digits at weight 500, and small-caps labels. Only `--jp-text` and `--jp-text-secondary` are used, so contrast holds on `--jp-bg` in both themes. It fits at 320px.
- **CSS cleanup.** Dead `.countdown-*` rules removed from `main.css`.

**Tests.**

- `tests/countdown.test.ts` (20 tests):
  - splitting and rounding, exact minute boundaries, carries
  - started/finished returns null
  - DST spans
  - spoken text and plurals
  - minute alignment
  - DOM: immediate render, local-date parse, update exactly at :00 and then every 60 s with only one timer pending
  - hidden at and after start, including reaching zero live
  - invalid date
  - hidden tab pause and resume
  - cleanup
  - no-op page
  - markup has no seconds and no inline script, and the timer is not live
  - Passes with TZ = UTC, America/Argentina/Buenos_Aires, Europe/Madrid and America/New_York.
- `css-tokens.test.ts`: countdown rules use tokens only. Contrast pairs added for `--jp-text` and `--jp-text-secondary` on `--jp-bg`.
- **E2E.**
  - `landing.spec.ts`: three units, no `#cd-secs`, `aria-live=off`, sr sentence.
  - `qa-frontend.spec.ts`: with `page.clock`, the countdown does not change at :59 and changes at :00; it is hidden after the start.
  - `qa-followup.spec.ts`: dark/light check moved to the digit colour.

## Verification

- **Unit and build.** `npm run typecheck`, `npm run test:run --workspace=frontend` (956 passed) and the same with `TZ=America/Argentina/Buenos_Aires` (956 passed), plus `vite build`, were run before each commit.
- **E2E** (Chromium 148 from `/opt/pw-browsers`, production build via `vite preview` under `/PruebaMapJapan/`, untracked temp config on port 5273): `csp city-pages accessibility map-tiles overview-map landing qa-frontend qa-followup qa-sw search pwa ui-consistency` gave **198 passed, 1 skipped**.
- **Real-tile visual run** (outside CI, real OSM tiles fetched through the sandbox proxy): landing (demo/overview/countdown), tokyo, kyoto and naoshima at light/dark × 375/1280.
  - All 16 views had real map imagery (4–18 tiles loaded), visible markers and visible attribution, with no overlap.
  - There were 0 page errors and 0 CSP reports, with the CSP enforced (meta `img-src … https://tile.openstreetmap.org`).
- **axe** (wcag2a/aa, wcag21aa, best-practice) on those 16 views: only `region` on `.skip-link`. That finding is pre-existing best practice and is the same on the base branch.
- **Breakage attempts** (all passed):
  - tile server 404 and abort: notice shown, no errors
  - theme toggled 3–5× while tiles were slow or loading
  - rapid navigation across 6 pages
  - resizing 320↔1280
  - throttled network: hero first, map not yet initialised
- **Service worker under `/PruebaMapJapan/`.** Scope is `/PruebaMapJapan/`, 0 tile entries in any cache, and tiles reload while the SW controls the page. The hero image resolves to `/PruebaMapJapan/demo-hero.jpg`.

## Screenshots (`.planning/qa/visual-demo/`)

1. `1-old-ab6b603-overview-light-1280.png`: old overview (`ab6b603`, Carto tiles swapped for OSM)
2. `2-new-overview-light-1280.png`: restored overview (same crop)
3. `3-diff-old-vs-new-light-1280.png`: pixel diff (red = differs)
4. `4-new-demo-countdown-overview-dark-375.png`: countdown and overview, dark, 375px
5. `5-tokyo-light-1280.png`
6. `6-kyoto-dark-1280.png`
7. `7-naoshima-dark-375.png`
8. `8-overview-tiles-blocked-dark-375.png`: tile server blocked, with the fallback notice

## Not done / notes

- Live site: GitHub Pages serves `origin/main`, whose CSP still allows only CartoDB. Deploying this branch replaces it with the OSM host. Nothing was pushed.
- OSM's tile policy allows this light, attributed use. A large increase in traffic would need a self-hosted or commercial tile source; `src/data/tiles.ts` is the single place to change it.
- In this sandbox Chromium's own CONNECTs to the proxy were flaky (`ERR_TOO_MANY_RETRIES`), so the visual run fetched each real tile through Playwright's request API and fulfilled the page's request with those exact bytes.
- The axe `region` finding on `.skip-link` was left as it was (out of scope).
