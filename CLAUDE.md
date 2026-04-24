# Japan Itinerary 2026 — Claude Code Guide

## What this is
Multi-page PWA travel itinerary for a 30-day Japan trip (Feb–Mar 2026).
One HTML file per city, all sharing a single TypeScript entry point via Vite.
Deployed to GitHub Pages at `/PruebaMapJapan/`.

## Commands
```bash
npm run dev          # Dev server on http://localhost:3000 (opens browser)
npm run build        # tsc + vite build → dist/
npm run preview      # Preview production build locally
npm run typecheck    # tsc --noEmit (no output, just type errors)
npm run test         # Vitest in watch mode
npm run test:run     # Vitest single run (for CI)
npm run test:coverage
```

## Architecture

### Pages
Each city has its own HTML file at root level:
`index.html`, `tokyo.html`, `nagoya.html`, `takayama.html`, `kyoto.html`,
`osaka.html`, `naoshima.html`, `hakone.html`, `tokyo2.html`

All pages load `src/main.ts`. The map is identified by `<div id="map" data-city="...">`.

### Key files
| File | Role |
|------|------|
| `src/data/itinerary.ts` | All city/day/activity data — single source of truth |
| `src/data/maps.ts` | Leaflet tile URLs and theme configs |
| `src/types/index.ts` | All TypeScript interfaces (`Activity`, `Day`, `CityData`, etc.) |
| `src/main.ts` | App bootstrap — initializes theme, countdown, map, widgets |
| `src/modules/map.ts` | Leaflet map init for city pages and overview |
| `src/modules/search.ts` | Global search across all itinerary data |
| `src/modules/theme.ts` | Light/dark mode, system preference detection |
| `src/modules/widgets.ts` | Weather (Open-Meteo API) and news (Google RSS) widgets |
| `src/modules/countdown.ts` | Trip countdown on index page |
| `src/components/Navbar.ts` | Web Component — city navigation bar |
| `src/components/SearchBar.ts` | Web Component — global search UI |
| `src/styles/main.css` | All styles, CSS custom properties for theming |
| `public/sw.js` | Service Worker for PWA/offline support |
| `public/manifest.json` | PWA manifest |

### Data shape
```
Itinerary → Record<cityKey, CityData>
CityData  → { name, center, zoom, hotel, dates, days }
days      → Record<dayKey, Day>
Day       → { label, color, hasOptions?, activities }
Activity  → { name, coords, notes, optional?, isGeneric? }
```

## TypeScript rules (tsconfig.json)
- Strict mode ON — `strict: true`
- `noUnusedLocals` and `noUnusedParameters` — no dead variables
- `noEmit: true` — tsc is type-check only, Vite handles transpilation
- Path alias: `@/` → `src/`

## Testing
Vitest + jsdom. Tests live in `tests/`:
- `utils.test.ts` — pure utility functions
- `search.test.ts` — search module logic
- `modules.test.ts` — module initialization

Always run `npm run typecheck && npm run test:run` before committing.

## Deployment
- GitHub Actions deploys `dist/` to GitHub Pages on push to `main`
- Base URL must stay `/PruebaMapJapan/` in `vite.config.ts`
- Node 22 required (see `engines` in package.json)

## External APIs (no keys required)
- Weather: Open-Meteo (`https://api.open-meteo.com`) — free, no auth
- News: Google RSS feeds — public
- Tiles: OpenStreetMap / CartoDB — public
