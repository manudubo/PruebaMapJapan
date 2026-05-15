# Coding Conventions

**Analysis Date:** 2026-04-25

## Naming Patterns

**Files:**
- Web Components: PascalCase, named after the element class — `SearchBar.ts`, `Navbar.ts`
- Page modules: camelCase — `dashboard.ts`, `tripDetail.ts`, `profile.ts`
- Feature modules: camelCase — `countdown.ts`, `search.ts`, `theme.ts`, `tripAdapter.ts`
- Route files: kebab-case or camelCase — `health.ts`, `trips.ts`, `public.ts`
- DB query files: plural noun — `trips.ts`, `users.ts`, `activities.ts`
- Test files: `*.test.ts` (unit), `*.spec.ts` (E2E)

**Classes / Custom Elements:**
- Class name: PascalCase — `SearchBar`, `TravelNav`
- Custom element tag: kebab-case — `search-bar`, `travel-nav`
- Registration always at file bottom: `customElements.define('tag-name', ClassName)`

**Functions:**
- camelCase throughout — `buildSearchIndex`, `getThemeConfig`, `formatDate`, `resolveDestination`
- Async functions use `async` keyword, never `.then()` chains in module code
- Helper functions prefixed by verb: `get*`, `create*`, `update*`, `delete*`, `resolve*`, `render*`, `handle*`, `build*`

**Variables and Constants:**
- camelCase for variables: `userTrips`, `mockTrip`, `tripsGrid`
- SCREAMING_SNAKE_CASE for module-level constants: `CACHE_DURATION`, `BLACKLIST_DOMAINS`, `THEME_CONFIG`, `ITINERARY`
- Boolean variables prefixed: `isOpen`, `isAuthenticated`, `apiCallMade`

**Interfaces and Types:**
- PascalCase interfaces: `ApiResponse`, `ContextVariables`, `NavDestination`, `CacheEntry`
- Type aliases: PascalCase — `Theme`, `Itinerary`
- DB-derived types follow `Model` / `NewModel` pattern: `Trip` / `NewTrip`, `User` / `NewUser`
- API response types prefixed with `Api`: `ApiTrip`, `ApiUser`, `ApiDestination`

**Database columns:** snake_case throughout — `user_id`, `city_name`, `order_index`, `is_public`

## Code Style

**Formatting:**
- No Prettier or ESLint config detected at root level
- TypeScript strict mode enabled in both `backend/tsconfig.json` and frontend
- `noUnusedLocals: true`, `noUnusedParameters: true` enforced by compiler
- ES2022 target; ESNext modules

**TypeScript strictness:**
- `strict: true` in backend tsconfig
- Explicit return types on public/exported functions and class methods
- `void` return type for callbacks and event handlers: `connectedCallback(): void`
- Type assertions done via `as` keyword, not angle-bracket syntax
- Drizzle schema types inferred via `InferSelectModel` / `InferInsertModel` — no hand-written DB row types

## Import Organization

**Order (observed pattern):**
1. External library imports — `import { Hono } from 'hono'`
2. Internal absolute imports via `@/` alias — `import { getDb } from '../db'`
3. Relative imports — `import type { Env } from '../types'`
4. Type-only imports using `import type` — `import type { ApiTrip } from '@/types'`

**Path Aliases:**
- `@/` resolves to `src/` in both frontend (`vite.config.ts`) and backend (`tsconfig.json`)
- Used in all frontend modules and test files

**Barrel files:** `backend/src/db/index.ts` re-exports all query functions; `backend/src/routes/index.ts` assembles routes

## Error Handling

**Backend (Hono routes):**
- Every route handler wraps DB operations in `try/catch`
- Catch blocks use bare `catch` (no parameter) when the error is not used: `} catch {`
- Catch blocks use `catch (err)` only when the error message is forwarded: `const message = err instanceof Error ? err.message : 'fallback'`
- All error responses use the `ApiResponse<never>` shape: `{ success: false, error: '...' }`
- HTTP status codes: 400 for bad input, 401 for auth, 403 for ownership, 404 for missing, 500 for unexpected
- `DATABASE_URL` guard at the top of every route handler before calling `getDb()`

**Frontend modules:**
- Public functions that touch the DOM or external APIs use `try/catch` silently (no re-throw)
- Cache operations in `utils.ts` swallow errors: `} catch { return null }` or `} catch { /* ignore */ }`
- API client (`client.ts`) throws `Error` with message on non-OK responses; callers handle per use case

**Web Components:**
- Async init in `connectedCallback` uses `.catch(() => { ... })` rather than try/catch: `initKeycloak().then(...).catch(...)`
- DOM queries guarded with early return: `if (!this.input || !this.dropdown) return;`

## Logging

**Framework:** `console` only (no logging library)

**Patterns:**
- `console.warn(...)` for non-fatal storage/cache errors
- `console.log(...)` in global-setup for server readiness polling
- No debug logging in production code paths

## Comments

**When to Comment:**
- JSDoc `/** ... */` used on exported route handlers and public class methods to describe HTTP contract
- Single-line `//` comments for section headers inside large files (divider lines with `=` or `-`)
- Inline comments explain non-obvious behavior: Keycloak workaround, Safari Shadow DOM limitation, CI vs local behavior

**JSDoc:**
- Used on route handlers to document HTTP method + path + purpose
- Used on public Web Component methods: `setDestinations`, `refreshAuthUI`
- Not used on private class methods

## Function Design

**Size:** Functions are kept small; complex logic broken into private class methods or module helpers

**Parameters:** Prefer explicit typed params; no use of `arguments` object; destructuring used for objects

**Return Values:**
- Functions return typed values or `void`; never `any`
- Result discrimination pattern for authorization helpers: `{ error: 'not_found' | 'forbidden' }` vs `{ dest, day, act }`

## Module Design

**Exports:**
- Named exports preferred for utility modules: `export function formatDate(...)`
- Default export for the main artifact of a module: `export default tripsRoute`, `export default SearchBar`
- Type-only exports via `export type` or `export interface`

**Web Components pattern:**
- Each component is a class extending `HTMLElement`
- Shadow DOM always used (`mode: 'open'`)
- All styles inlined in `render()` via template literal using CSS custom properties for theming
- Event listeners set up in `setupEventListeners()` called from `connectedCallback()`
- Public API methods (callable from outside) annotated with JSDoc

**Validation (backend):**
- All input validated via Zod schemas defined in `backend/src/validation/schemas.ts`
- Schemas use `CreateXxxSchema` / `UpdateXxxSchema` naming convention
- `UpdateXxxSchema` is always `CreateXxxSchema.partial()`
- Validation applied via `@hono/zod-validator` `zValidator('json', Schema)` middleware on routes

---

*Convention analysis: 2026-04-25*
