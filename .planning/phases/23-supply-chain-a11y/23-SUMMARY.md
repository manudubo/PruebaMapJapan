# Phase 23 Summary: Supply Chain, Secrets & Accessibility

Branch: `worktree-agent-aa34d5980a3bff5ef` (not pushed). Executed without PLAN files.

## Per-ID status

| ID | Status | What changed |
|----|--------|--------------|
| SEC-15 | Done | Removed unpkg Leaflet `<link>`/`<script>` from all 9 map pages (incl. `trip.html`); `leaflet/dist/leaflet.css` imported in `modules/map.ts` and `pages/tripDetail.ts`; unpkg dropped from the Phase 20 CSP plugin (`vite.config.ts`). Leaflet JS was already bundled via npm. Verified in Chromium: tokyo/kyoto render tiles + 34/26 markers with Leaflet CSS applied (from the production build). |
| SEC-16 | Done | `sw.js` `CACHE_NAME = 'japan-trip-__BUILD_VERSION__'`; new `swVersionPlugin` in `vite.config.ts` stamps a 12-char content hash of `dist/` (deterministic across identical builds). Navigations are network-first with cache/`index.html` fallback; other GETs stay cache-first (hashed assets). Old caches purged on activate. |
| INFRA-06 | Done | Dead `EXTERNAL_ASSETS` removed. Offline map tiles are NOT cached (only first-party assets are), so the map still needs network for tiles. |
| DEP-02 | Done, rotation open | gitleaks 8.21.2 run on full history (after unshallow, 611 commits) and working tree: 14 findings reproduced. 12 = test fixtures/placeholders (FP). 2 unique-file hits = local `japan-trip-worker` Keycloak client secret in two planning docs: redacted at HEAD. Fingerprints in `.gitleaksignore` -> both scans report 0. Details: `docs/security/gitleaks-triage.md`. History not rewritten. **Rotation of that KC secret could not be verified/performed here.** |
| DEP-03 | Done (not run on GitHub) | `.github/workflows/security.yml`: gitleaks full-history job; accessibility job (build, preview, `scripts/a11y-axe.mjs` fails on serious/critical in light+dark on 6 pages, Lighthouse CI asserts accessibility >= 0.95 on index + tokyo). Workflow YAML parses; axe script and Lighthouse verified locally, the workflow itself has not run on Actions. |
| A11Y-01 | Done | `aria-expanded` removed from the SearchBar `<input>` (the only source of it; the component renders on every page) and from its open/close toggling. |
| A11Y-02 | Done | Pages used undefined `--text-*` vars so light hardcoded fallbacks won in dark mode; remapped to `--jp-*` tokens. Light tertiary `#86868b`->`#6e6e73`, dark tertiary `#6e6e73`->`#98989d`, danger `#ff3b30`->`#d70015`, new `--jp-accent-text` for active nav link, dark `.btn-primary` `#0071e3`, and index.html dark overrides. axe: 0 violations on index, tokyo, kyoto, dashboard, profile, trip in light and dark (wcag2a/aa/21aa). |
| A11Y-03 | Done | `showError()` in `tripDetail.ts` now renders an `<h1>`. |
| A11Y-04 | Partial | Heading order fixed (Activities `h3`->`h2` on all city pages + trip.html, CSS updated). WCAG 2.2 `target-size` on tokyo (15 Leaflet markers, 28px but overlapping/obscured by neighbours) not fixed: inherent to marker density; not in the wcag2aa gate, Lighthouse a11y 0.96 on tokyo because of it. |
| A11Y-05 | Partial | Google Fonts `@import` in `main.css` (render-blocking, chained) replaced with non-blocking `<link media=print onload>` on all pages; Lighthouse no longer lists it as render-blocking. |

## Measurements (Lighthouse 12, mobile emulation, local production build, sandbox)

- index: LCP 5.1s before -> 5.3s after the font change (noise; no improvement measured). LCP element is the "Loading..." span: the hero is hidden until Keycloak `check-sso` finishes, and Keycloak is unreachable in the sandbox. Perf 0.80, a11y 1.0.
- tokyo: LCP 2.7s, perf 0.94, a11y 0.96 (after only; no baseline taken). Not comparable to the audit's 6.26s baseline (different network/CPU, external tiles/fonts blocked by the sandbox proxy).
- Could not measure the real-network effect on GitHub Pages.

## Deferred / open

- Rotate `japan-trip-worker` KC client secret wherever the leaked value was used (owner action).
- A11Y-05 real fix for landing LCP: show the hero immediately instead of hiding it behind the auth check (product/UX decision: logged-in users would briefly see the landing before redirect). Also `demo-hero.jpg` is 677 KB; compress/serve WebP.
- A11Y-04 target-size on overlapping markers (needs marker clustering/spiderfy or larger spacing).
- Dark-mode landing countdown cards stay white (pre-existing undefined `--bg-*` vars); other undefined vars (`--accent`, `--bg-*`, `--border-color`) not remapped, out of scope.
- `region` axe best-practice (skip link outside landmark) and index `page-has-heading-one` (logged-out h1 hidden while loading) not addressed; not in the gate.

## Verification

`npm run typecheck --workspace=frontend` clean; `npm run test:run --workspace=frontend` 122/122 (new `frontend/tests/supply-chain-a11y.test.ts`: no unpkg in 13 pages, SW versioning/network-first/old-cache purge via vm, SearchBar aria-expanded, showError h1, font non-blocking); `npm run build --workspace=frontend` OK.
