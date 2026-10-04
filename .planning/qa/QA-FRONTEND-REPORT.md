# Frontend QA report (post Phase 22 + 23)

> **Status update 2026-10-04:** bugs 7-10 (visual items 1-4) were fixed afterwards: `../phases/23-supply-chain-a11y/23-QA-FOLLOWUP.md`. The "CartoDB tiles unreachable" note is obsolete: maps now use OpenStreetMap (`QA-DEMO-FIXES.md`). See `QA-INDEX.md` for what was not verified.

Branch: `worktree-agent-a200a427072db4913`. Method: `npm run build`, `vite preview` (port 4173), Playwright driving the
preinstalled Chromium (`/opt/pw-browsers/chromium`), screenshots read by eye. No push, no PR.

Note on base: the worktree started at Phase 21 (`3c147f6`); Phase 22/23 live on `claude/focused-lovelace-cryssy`. The branch was
fast-forwarded to it before any QA (no local work lost).

## Environment limits (not bugs)
- Map tiles (`*.basemaps.cartocdn.com`), Google Fonts and news proxies are unreachable in the sandbox: maps show a blank
  background with markers, tiles = 0, Inter falls back to system sans. Marker counts match the data (tokyo 34, nagoya 4,
  takayama 10, kyoto 26, osaka 13, naoshima 4, hakone 3, tokyo2 3) and Leaflet CSS is applied (`position: relative`).
- No Keycloak/backend: `dashboard`, `trip`, `profile`, `trip-edit` were only reachable in their unauthenticated state
  (dashboard shows its header only; trip shows "Trip unavailable"; profile/trip-edit redirect to login target). Authenticated
  UI was not visually verified.
- Another agent's stale preview held port 5173 (served the Phase 21 build with unpkg tags). QA used 4173 with `--strictPort`.

## Visual sweep (13 pages x light/dark x 375/1280 = 52 screenshots; 10 kept in `.planning/qa/visual/`)
Results: no horizontal overflow at 375/1280 (also 320 and 240 in the e2e spec); no unstyled Leaflet; no unpkg requests;
dark mode surfaces and text readable on all city pages.
Visible defects (all open, cosmetic):
1. Dark landing (`index-dark-375.png`): countdown cards stay white (undefined `--bg-*` vars, already listed in Phase 23 deferred).
2. Floating search button (fixed `top:64px; right:12px`) overlaps content edge on mobile (sits over the header/card area under the
   navbar at 375px: `tokyo-dark-375`, `trip-dark-375`).
3. Landing shows "Loading..." with the hero hidden for about 10 s when Keycloak is unreachable (keycloak-js message timeout);
   then the hero appears. Product decision (Phase 23 A11Y-05 note); covered by an e2e that documents the 15 s upper bound.
4. Dashboard unauthenticated with Keycloak down renders an empty page under "My Trips" (no error/retry visible).

## Service worker (Chromium, production build)
| Check | Result |
|---|---|
| Registration + activation, controls page | OK |
| Cache name `japan-trip-<12 hex>`, exactly one cache | OK |
| Network-first navigations (poisoned cache ignored online) | OK |
| Offline: previously visited city renders with markers | OK |
| Offline: unknown URL falls back to cached index | OK |
| Upgrade after rebuild (source changed): new cache name, old cache purged, page still works | OK (`411cf6749066` -> `01d1bd7a2b05`) |
| Offline: city never opened, HTTP cache disabled | BUG (fixed): precache had HTML only, 8 JS/CSS chunks failed, 0 markers, unstyled |

## Scenarios tried
Search across cities (activity in another city navigates), theme toggle persisting across 4 pages and reload, tile layer
switching with theme, countdown ticking, all APIs blocked, weather garbage JSON / HTML, corrupted cached weather, news proxies
returning non-JSON / non-XML, hostile RSS (HTML in titles, `javascript:` links, RTL override, 5000-char titles), disabled
localStorage, 240/320 px viewports on all city pages, `dir=rtl`, rapid navigation across all 16 loads without page errors,
Keycloak unreachable.

## Bugs found
| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | High | `localStorage` throwing (blocked site data) made `initTheme()` throw first in `init()`, so no map/markers on any city page | Fixed `5c74925` + unit tests |
| 2 | High | Offline PWA: precache had no built JS/CSS; unvisited pages unusable offline | Fixed `f129b67` + unit + e2e |
| 3 | Med | Search: type boost applied before `score > 0`, so any query (gibberish) returned 8 arbitrary items; "No results found" unreachable | Fixed `8da845a` + unit + e2e |
| 4 | Med | Search dropdown injected API-sourced trip/city/activity names and notes via innerHTML (stored XSS on dashboard) | Fixed `de4659a` + unit |
| 5 | Med | Weather JSON cached before validation; garbage poisoned localStorage and later loads threw uncaught, loader stuck | Fixed `e048732` + unit + e2e |
| 6 | Low | RSS `link` written to `href` unchecked (`javascript:`); now http(s) only | Fixed `e048732` + tests |
| 7-10 | Low | Visual items 1-4 above | Open (not fixed: design/product) |

## Automated tests added
- Vitest (frontend, jsdom): `qa-resilience` (3), `widgets-resilience` (7), `searchbar-xss` (2), `sw-precache` (3), `search-relevance` (3).
  Suite: 136 -> 154 tests, 13 -> 18 files; typecheck and build clean.
- Playwright, no Keycloak/backend, tag `@qa-noauth`: `tests/e2e/qa-frontend.spec.ts` (35 tests) and `tests/e2e/qa-sw.spec.ts` (5).
  Need a production build at the config baseURL:
  `npm run build --workspace=frontend && npm run preview --workspace=frontend`, then
  `cd tests && SKIP_REAL_AUTH=1 npx playwright test qa-frontend qa-sw --grep @qa-noauth --project=chromium`.
  SW specs skip themselves against the dev server. All 40 pass locally (run with a temporary config pointing at port 4173 and the
  preinstalled Chromium; that config was not committed). The repo config's `globalSetup` was not exercised here.
