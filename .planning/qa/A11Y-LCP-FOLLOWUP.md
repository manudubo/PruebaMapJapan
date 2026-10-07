# A11Y-04 / A11Y-05 follow-up: target-size and landing LCP

Branch `worktree-agent-a872b2533467d2c4d`, based on `main` ed49639 (PR #23). Not pushed.
Closes the two PARTIAL items of `.planning/phases/23-supply-chain-a11y/23-SUMMARY.md`.

## A11Y-04: WCAG 2.2 target-size on city pages

Cause: markers are 28px, but stops a few pixels apart overlap on screen, so axe/Lighthouse report each as a
"partially obscured" target (Tokyo: 13 failing at 375px, 15 at 1280px).

Fix (`src/modules/declutter.ts`, wired in `map.ts`): overlapping markers are spread in screen space
(pairwise Chebyshev distance >= 34px, hotel marker is 32px). A `DeclutteredMarker` adds a pixel offset in
`_setPos`, so the true latlng (popup, directions, day filter) is untouched; a thin leader line joins a displaced marker
to its real spot. DOM and tab order, focus ring and Enter-to-open are unchanged. Recomputed on `zoomend` and on
day-filter changes. Clustering was rejected (hides stops, breaks numbered-order reading). Look: same markers,
same colours; only crowded ones move a few px (before/after screenshots at 375/1280 light+dark reviewed).

| Check | Before | After |
|---|---|---|
| axe `wcag2a/2aa/21a/21aa/22aa`, 9 pages x light/dark x 375/1280 | tokyo: target-size, 4 of 4 combos | 0 violations, all combos |
| Lighthouse a11y, tokyo (median of 3) | 0.96 | 1.00 |

Side fix: `.day-group-badge` ("Options", white on #af52de = 4.13:1) failed color-contrast on takayama and osaka once
those pages were audited; now #9b3fc8.

## A11Y-05: landing and Tokyo LCP

Lighthouse 12, mobile emulation with default throttling, production build (`CSP_ALLOW_MISSING_ORIGINS=true npm run build`)
served by `vite preview` under `/PruebaMapJapan/`, 3 runs each, medians. Sandbox: Keycloak and external hosts unreachable.

| Page | Metric | Before | After |
|---|---|---|---|
| index | LCP (runs) | 5415 ms (5583, 5415, 5409) | 1304 ms (1286, 1310, 1285 in the last build) |
| index | FCP | 1911 ms | 1277 ms |
| index | TBT | 363 ms | 26 ms |
| index | CLS | 0 | 0 |
| index | Performance score | 0.68 | 1.00 |
| index | transferred | 771 KiB | 56 KiB |
| tokyo | LCP | 2749 ms | 2261 ms (2147-2803 across builds; noisy) |
| tokyo | Performance score | 0.93 | 0.97 |

The landing target (LCP well under 5 s) is reached in the sandbox. Real-network effect on GitHub Pages was not measured.
Tokyo's LCP element is the "map imagery could not load" notice (tiles are blocked here), so its LCP is dominated by how
fast the map code runs, not by images; it did not regress even though Leaflet is now a lazy chunk.

Causes and fixes:
1. `body { opacity: 0 }` until `document.fonts.ready` / `load` on all 13 pages: removed (the `html` background already prevents a flash).
   Inter keeps `display=swap` over a metric-matched `Inter Fallback` (`size-adjust`, ascent/descent overrides).
   Visible difference: before the web font arrives (or when it cannot load, as in this sandbox) text uses an
   Arial-metric face instead of the system UI font; with Inter loaded the end state is unchanged.
2. Hero set from JS after module load, 677 KB JPEG: now CSS `image-set` (AVIF, WebP, JPEG) in 640/1280/1920 widths
   (8 / 32 / 69 KB AVIF; JPEG fallback 1600w, 77 KB), one `<link rel=preload as=image fetchpriority=high type=image/avif media=...>`
   per size bucket so only the file the CSS selects is fetched. The image is a blurred 18% opacity backdrop, so the quality
   loss is not visible (compared by eye and by pixel diff).
3. Leaflet (150 KB) and the map modules were in the entry chunk and modulepreloaded on every page: `main.ts` now
   dynamic-imports them (city map, and overview map when it scrolls near the viewport). Leaflet is not requested on the first
   landing load (e2e asserts it). Each lazy map module imports `leaflet.css` itself.
4. Layout shift introduced by showing the page before the custom elements upgrade (CLS 0.126): `travel-nav` and
   `search-bar` reserve their rendered height while `:not(:defined)`; CLS is 0.

## Tests
- `frontend/tests/declutter.test.ts` (spread algorithm and Leaflet integration), `frontend/tests/lcp-budget.test.ts`
  (preloads, no opacity gate, no JS-injected hero, fallback metrics, CLS reservation, image size budgets, no static
  Leaflet import in `main.ts`, lazy modules carry leaflet.css).
- `tests/e2e/lcp-target-size.spec.ts` (`@qa-noauth`, 3 tests).
- Found by the existing `overview-map` e2e while doing this: lazy chunk without `leaflet.css` left the overview map unstyled; fixed (point 3).

## Verification
typecheck clean; `npm run test:run --workspace=frontend` 1082/1082 (also `TZ=America/Argentina/Buenos_Aires`, 1081 before the last
test addition); build OK. Playwright (preinstalled Chromium, temporary untracked config, preview on :4173):
`qa-frontend`, `qa-sw`, `qa-followup`, `overview-map`, `ui-consistency`, `city-pages`, `map-tiles`, `search`, `lcp-target-size` with `--grep @qa-noauth`
all pass; `qa-sw` "registers, activates and owns a build-versioned cache" timed out once in 1 of ~14 runs under parallel load
(passes 6/6 alone; it does not touch this change).

## Not done / notes
- Overview map on the landing (8 stops) passes target-size without declutter; Tokyo/Hakone are far enough apart at zoom 6.
- Real-network LCP on GitHub Pages and Lighthouse on slower CPUs not measured.
