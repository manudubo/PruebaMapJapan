# 🇯🇵 Japan Itinerary 2026

Interactive travel itinerary web app for a 30-day trip to Japan (Feb-Mar 2026).

## Features

- 🗺️ **Interactive Maps** - Leaflet-based maps with markers for each activity
- 🔍 **Global Search** - Search across all activities, cities, days, and hotels
- 🌤️ **Live Weather** - Current conditions and 5-day forecast via Open-Meteo
- 📰 **News & Events** - Curated news and events from Google RSS
- 🌓 **Dark Mode** - System-aware theme with manual toggle (works on all browsers including Safari/iOS)
- 📱 **PWA Support** - Install as app, works offline
- ♿ **Accessible** - WCAG 2.1 compliant

## Recent Changes (v2.1.0)

- **Fixed**: Navbar theme now works correctly on mobile Safari/iOS
- **Fixed**: Home logo is now consistent across all devices (SVG icon instead of emoji)
- **Updated**: Dependencies to latest stable versions
- **Improved**: CSS custom properties used for theme support in Shadow DOM components

## Tech Stack

- **Build**: Vite 5 + TypeScript 5.6
- **Maps**: Leaflet 1.9
- **Testing**: Vitest 2.1
- **Deployment**: GitHub Pages (Node 22)

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Project Structure

```
├── src/
│   ├── components/     # Web Components (Navbar, SearchBar)
│   ├── data/          # Itinerary data and map URLs
│   ├── modules/       # Core functionality
│   │   ├── countdown.ts
│   │   ├── map.ts
│   │   ├── search.ts
│   │   ├── theme.ts
│   │   ├── utils.ts
│   │   └── widgets.ts
│   ├── styles/        # CSS
│   └── types/         # TypeScript types
├── tests/             # Vitest tests
├── public/            # Static assets (manifest, sw.js)
└── *.html             # Page templates
```

## Cities Covered

1. **Tokyo** (Feb 22 - Mar 1) - TeamLab, Shibuya, Shinjuku, Asakusa
2. **Nagoya** (Mar 2-3) - Ghibli Park
3. **Takayama** (Mar 4-7) - Shirakawa-go, skiing
4. **Kyoto** (Mar 8-13) - Nintendo Museum, Fushimi Inari, Arashiyama
5. **Osaka** (Mar 14-17) - Universal Studios, Dotonbori
6. **Naoshima** (Mar 18-19) - Art island
7. **Hakone** (Mar 20-21) - Onsen, Mt. Fuji views
8. **Tokyo** (Mar 22-23) - Final shopping

## Keyboard Shortcuts

- `Cmd/Ctrl + K` - Open search
- `↑/↓` - Navigate search results
- `Enter` - Select result
- `Esc` - Close search

## Deployment

Automatically deploys to GitHub Pages on push to `main` via GitHub Actions.

## License

MIT
