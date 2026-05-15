# Testing

**Last mapped:** 2026-04-25

## Frameworks

| Layer | Framework | Location |
|-------|-----------|---------|
| Frontend unit | Vitest 2.x | `frontend/` — `vitest.config.ts` |
| Backend unit | Vitest (via Hono test utils) | `backend/src/index.test.ts` |
| E2E / integration | Playwright 1.x | `tests/` — separate package |

## Frontend Unit Tests (Vitest)

**Config:** `frontend/vitest.config.ts`

**Test files:** `frontend/tests/`
- `modules.test.ts` — theme, countdown, itinerary data, maps URL lookup
- `search.test.ts` — search index and query logic
- `utils.test.ts` — utility functions

**Patterns:**
- Uses `describe` / `it` / `expect` from Vitest
- Path alias `@/` maps to `frontend/src/` (configured in vitest config)
- DOM globals available (jsdom environment implied)
- Fake timers via `vi.useFakeTimers()` for countdown date testing

**Example pattern:**
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTheme } from '@/modules/theme';

describe('Theme Module', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('should return light as default', () => {
    expect(getTheme()).toBe('light');
  });
});
```

**Coverage:** Core pure modules are well-covered (theme, countdown, itinerary data). DOM-heavy modules (map, widgets, Web Components) have no unit tests.

## E2E Tests (Playwright)

**Config:** `tests/playwright.config.ts`

**Settings:**
- `baseURL`: `http://localhost:5173/PruebaMapJapan/`
- `timeout`: 30s per test
- `workers`: 2 (parallelism)
- `fullyParallel`: true
- CI: `forbidOnly`, 2 retries
- Artifacts: screenshots on failure, video on first retry, trace on first retry

**Browsers tested:**
- Chromium (Desktop Chrome)
- Firefox (Desktop Firefox)
- WebKit (Desktop Safari)

**Test files:** `tests/e2e/`

| File | Coverage |
|------|---------|
| `landing.spec.ts` | Landing page load, countdown, nav links |
| `city-pages.spec.ts` | Static city page smoke tests (8 cities) |
| `search.spec.ts` | Search overlay, keyboard nav, results |
| `trips.spec.ts` | Dashboard, trip CRUD, trip detail page |
| `auth.spec.ts` | Keycloak login/logout flow |
| `api.spec.ts` | Backend API endpoints (skipped if backend offline) |
| `accessibility.spec.ts` | axe-core WCAG 2.1 checks |
| `pwa.spec.ts` | PWA manifest, service worker registration |

**Key patterns:**

*API mocking via `page.route()`*
```ts
await page.route('**/realms/**', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
});
await page.route('**/api/**', (route) => {
  route.fulfill({ status: 200, body: JSON.stringify(mockTripsApiResponse) });
});
```

*Shared fixtures:*
```ts
// tests/e2e/fixtures/mockTrip.ts
export const mockTrip = { id: 1, name: 'Japan 2026', ... };
export const mockSingleTripApiResponse = { success: true, data: mockTrip };
export const mockTripsApiResponse = { success: true, data: [mockTrip] };
```

*Global setup:* `tests/global-setup.ts` — runs before all tests (env var loading, server checks)

*Defensive assertions:* Many tests use `typeof x === 'boolean'` or conditional branches to avoid failures when auth state is unknown. This means some assertions are overly loose.

## Running Tests

**Frontend unit tests:**
```bash
cd frontend && npm test
# or
cd frontend && npm run test:coverage
```

**E2E tests (requires dev server running):**
```bash
# Start frontend dev server first
cd frontend && npm run dev

# Run E2E tests
cd tests && npx playwright test

# Run specific suite
cd tests && npx playwright test trips.spec.ts

# UI mode
cd tests && npx playwright test --ui
```

**Backend unit tests:**
```bash
cd backend && npm test
```

## CI Integration

GitHub Actions runs E2E tests on push to main (`.github/` workflows). Uses `forbidOnly: true` in CI config. HTML + GitHub reporters both active in CI.

## Gaps & Known Issues

- No DB integration tests — all DB logic tested indirectly via E2E
- E2E API tests in `api.spec.ts` silently skip when backend is offline
- Several assertions use `expect(typeof x).toBe('boolean')` — these always pass regardless of actual value
- New `frontend/src/pages/profile.ts` has no test coverage (unit or E2E)
- Web Components (`Navbar.ts`, `SearchBar.ts`) have no unit tests
- No backend route-level unit tests — only `index.test.ts` exists
