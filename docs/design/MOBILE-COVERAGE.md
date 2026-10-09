# Mobile coverage matrix

The owner mostly uses the app from a phone, so mobile is a tested target, not a screenshot exercise.
This file says what is covered, by which spec, and what can only be checked on a real device.

## How it is tested

| Piece | Where |
|---|---|
| Projects `mobile` (iPhone 13 descriptor) and `mobile-android` (Pixel 7) | `tests/playwright.config.ts` |
| Engine | **Chromium** for both (only Chromium is installed in CI and in the dev sandbox). `MOBILE_ENGINE=webkit npx playwright test --project=mobile` runs the iPhone project on real WebKit where `npx playwright install webkit` was done. WebKit has **not** been run for this batch. |
| Layout sweep, every screen x 320/360/375/390/414/430, 667x375 landscape, 768 and 1024 | `tests/e2e/mobile-layout.spec.ts` (+ `fixtures/mobile.ts` audit, `fixtures/mobileScreens.ts` screen list) |
| Touch journeys, gestures, keyboard overlap | `tests/e2e/mobile-touch.spec.ts` |
| Document contracts, dialogs, OTP, motion, dark, enlarged text, offline | `tests/e2e/mobile-platform.spec.ts` |
| Review screenshots (opt-in: `MOBILE_SCREENSHOTS=<dir>`) | `tests/e2e/mobile-screens.spec.ts`, keepers in `docs/design/mobile-screens/` |
| Unit: map touch guard | `frontend/tests/map-touch-gestures.test.ts` |

The layout audit (`audit()` in `fixtures/mobile.ts`) runs inside the page and walks open shadow roots
(`<travel-nav>`, `<search-bar>`). Per viewport it fails on: horizontal scroll of the document,
controls outside the viewport (scroll containers and pannable maps excepted), tap targets under
44x44 (inline text links, stretched card links and Leaflet attribution excepted; native
checkboxes are measured through their label; map markers through a hit-test of a 44px box),
and text fields under 16px (iOS zooms on focus).

Run: `npm run build:frontend && cd tests && SKIP_REAL_AUTH=1 npx playwright test --project=mobile --project=mobile-android`
(CI builds and previews the same way; local `vite dev` breaks the `**/api/**` mocks).

Legend: **T** automated test, **V** visually reviewed (screenshots), **-** not applicable, **R** real device only, **gap** known gap.

## Journeys x checks

| Journey / screen | 320-430 layout | Landscape 667x375 | Tablet 768/1024 | 44px targets | 16px inputs | Touch interaction | Dark | Reduced motion | Enlarged text (150%) | Offline |
|---|---|---|---|---|---|---|---|---|---|---|
| Landing `index.html` | T V | T | T | T | T | T (theme, Sign in) | V | T | - | - |
| Demo overview `#demo` (map, city cards, countdown) | T V | T | T | T (markers, zoom) | T | T (search; map gestures) | V | - | - | - |
| City pages x8 (tokyo ... tokyo2) | T V (tokyo) | T | T | T (markers, zoom, hotel button) | T | T (map gestures on tokyo) | V | - | - | T (tokyo.html) |
| Dashboard (cards, empty state) | T V | T | T | T | T | T (profile link, search) | T V | T | T | - |
| Trip view: overview + city | T V | T | T | T | T | gap (no tap-through of city cards) | T V | T | T (overview) | - |
| Trip editor: step 1 Trip | T V | T | T | T | T | T (steps, tabs) | V | - | - | - |
| Trip editor: step 2 Route + place search | T V | T | T | T | T | T (suggestion tap, move buttons) | T V | - | T | - |
| Trip editor: city view (days, places, hotel) | T V | T V | T | T | T | T (touch drag reorder, move, undo, drop-a-pin, hover-less actions, focus ring) | T V | T | T | - |
| Trip editor: step 3 Share | T V | T | T | T | T | gap (copy link not driven) | V | - | - | - |
| Trip editor: save banner / offline banner | gap | gap | gap | gap | - | gap | - | - | - | gap |
| Undo snackbar | T (on screen, 44px Undo) | - | - | T | - | T | - | - | - | - |
| Profile (account info, passkeys list) | T V | T | T | T | T | T (reached from navbar) | T | - | T | - |
| Passkey invitation dialog | T V | T | - | T | - | T (Not now) | V | - | - | - |
| Email verification (OTP, resend cooldown) | T V | T | T | T (44px digits) | T | T (one-time-code insertion submits) | - | - | - | - |
| Recover (`recover.html`) | T V | T | T | T | T | - | - | - | T | - |
| Navbar (links, auth, theme) | T | T | T | T (shadow DOM) | - | T (theme, sign in, profile) | V | - | - | - |
| Search bar (global + user scope) | T | T | T | T (clear, rows) | T | T (tap to open, tap result, clear) | - | - | - | - |
| Keycloak login / register screens | gap (other agent) | gap | gap | gap | gap | gap | gap | gap | gap | - |
| Offline / PWA | - | - | - | - | - | - | - | - | - | T (SW serves tokyo.html offline), T (manifest installable, no orientation lock) |

Cross-cutting rows:

| Concern | Status |
|---|---|
| Horizontal overflow at 320-430, landscape, tablets | T on every screen |
| Viewport meta (device-width, zoom never blocked) on all 14 pages | T |
| 100dvh instead of 100vh (landing hero, body) | T (CSS contract); R for the real URL-bar behaviour |
| Safe-area insets | undo snackbar uses `env(safe-area-inset-bottom)` (T, contract). The pages do not set `viewport-fit=cover`, so Safari insets content itself; R to confirm in standalone mode |
| Virtual keyboard overlap | T with a shrunken viewport (focused field visible, not covered by the fixed snackbar); R for iOS `visualViewport` behaviour |
| Map: one finger scrolls the page, two fingers move/zoom | T (touch-action contract, hint on one-finger drag, pinch zoom via CDP); unit test for the guard; headless Chromium does not turn synthesised swipes into scrolls, so the real swipe is R |
| Hover-only affordances | T on the editor rows (`hover: none` asserted); no hover-only reveal found elsewhere |
| `:focus-visible` after a tap | T (no ring on a tapped button) |
| Slow 3G / CPU throttle loading states | gap (skeleton and slow-state are covered by `dashboard-trips` / `trip-view` specs on desktop) |
| Long-press / context menu, tap highlight | gap (not asserted); R |

## Bugs found and fixed

1. Editor, dashboard, profile, map controls had 32-36px targets and 13-15px text fields (iOS focus-zoom). Fix: `(pointer: coarse)` block (main.css, trip-edit.css), keyed on the pointer so narrow desktop windows keep the compact UI.
2. Editor destination/place rows crushed the name to ~34px at 320px once targets became 44px. Fix: rows wrap (actions under the name; time under the place name).
3. `<travel-nav>` and `<search-bar>` live in shadow roots, so main.css never reached them: navbar targets were 34-36px and the search clear button 28px. Fix: touch rules inside the components.
4. A trip's city links were squeezed into a ~60px scroller beside the account buttons; at 360px even "My Trips" was cut. Fix: the links get their own row on phones.
5. A full-width map captured every vertical swipe (page could not scroll past it). Fix: one-finger drag off on touch screens, pinch still pans/zooms, short hint.
6. Leaflet zoom buttons (30px) and markers (28px hit area) enlarged on touch (hit area only for markers).
7. One-digit OTP boxes were 38px wide at 360px: now 44px.
8. Landing hero and body used `100vh` (taller than the visible area under a collapsing URL bar): `100dvh`.
9. Undo snackbar ignored the iPhone home indicator.
10. `manifest.json` locked `portrait-primary`: an installed app could not be rotated to use the map in landscape (WCAG 1.3.4). Removed.
11. Landscape phones: editor chrome took most of the 375px; tightened header/steps spacing and map height.

## Found, not fixed (report)

- Landscape editor is still cramped (nav + tabs + steps use about 250px of 375); a two-pane layout from ~640px landscape would be the real fix.
- Profile heading ("My Profile" / name) sits flush against the card edge at phone widths.
- The plan-tab hint for drop-a-pin still reads "Click the map ... Press Esc" (the map banner says "Click or tap").
- Navbar uses `role="tablist"` / `role="tab"` on ordinary links.
- Keycloak login/registration screens are owned by another agent and were not tested here.

## Real-device checklist (cannot be verified in emulation)

- iOS Safari: focus-zoom really absent on every field; `100dvh` with the collapsing toolbar; keyboard covering fields (`visualViewport` resize vs overlay), snackbar position with the keyboard open.
- iOS standalone PWA: status bar overlap, home indicator, no `viewport-fit=cover`, orientation after the manifest change, install prompt ("Add to Home Screen" icon: `maskable` reuses the 512 "any" icon, safe zone unchecked).
- Real one-finger swipe over a map scrolling the page; two-finger pan; pinch on a trackpad-less device.
- Long-press (context menu / link preview) on markers and city cards; tap highlight colour; 300ms tap delay.
- Passkey creation prompt (WebAuthn) and SMS/e-mail OTP autofill from the keyboard suggestion bar.
- Real WebKit run of this suite: `MOBILE_ENGINE=webkit` (CDP-based gesture tests are `test.fixme` outside Chromium).
