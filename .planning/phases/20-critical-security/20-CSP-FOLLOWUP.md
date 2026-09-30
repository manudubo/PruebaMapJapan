# Phase 20 follow-up: CSP blocked the API (SEC-04)

Base: `claude/focused-lovelace-cryssy` @ `5612e97` (Merge Phase 24 e2e). Branch: `worktree-agent-aae19b48e6982647c`, not pushed.

## Finding

`cspPlugin()` in `frontend/vite.config.ts` (20-03) put Keycloak in `connect-src` but not `VITE_API_URL`. It also read `process.env` only, so values from `frontend/.env` never reached the policy even though Vite baked them into the bundle.

Reproduced in Chromium 1.60 against a production build (`VITE_API_URL=http://localhost:8787/api`), CSP enforced (no `bypassCSP`), API and Keycloak mocked at the network layer:

```
Connecting to 'http://localhost:8787/api/trips' violates the following Content Security Policy
directive: "connect-src 'self' https://api.allorigins.win https://corsproxy.io https://api.open-meteo.com
https://nominatim.openstreetmap.org https://fonts.googleapis.com http://localhost:8080". The action has been blocked.
```

Violations on index, dashboard, profile and trip-edit (`/users/me`, `/trips`). 0 API requests reached the network and the dashboard showed 0 trips. The deploy build uses the same plugin, so production was affected too: every logged-in API call failed in any browser.

## Fix

`frontend/build/cspPlugin.ts` (imported by `vite.config.ts`):

- The policy is built in `configResolved` from `config.env`, the same resolved env (`.env` files plus `process.env`) that `import.meta.env` exposes. The fallbacks match the runtime: `http://localhost:8787/api` and `http://localhost:8080`.
- `VITE_API_URL` and `VITE_KEYCLOAK_URL` are reduced to a bare origin (`scheme://host[:port]`). Path, query, fragment and trailing slash are dropped, host case is normalised, IDN is converted to punycode, and default ports are removed. The Keycloak origin goes into `connect-src` and `frame-src` (for the 3p-cookies check iframe). `'self'` covers `silent-check-sso.html`. Sources are de-duplicated.
- An empty value or a root-relative value (`/api`) adds nothing: the runtime then fetches same-origin, which `'self'` already covers. A production build warns when either variable is unset or empty.
- The following values **fail the build** instead of producing a broken or open policy:
  - not an absolute URL (including `*` and `//host`)
  - a scheme other than http(s)
  - embedded credentials (they would also ship in the bundle, and the error message does not echo them)
  - IPv6 literals: Chromium logs `contains an invalid source ... It will be ignored` for `http://[::1]:8787`, verified
  - hosts outside `[a-z0-9-.]`: WHATWG URL accepts `*`, `;`, `,` and quotes in a host, which would allow policy injection or wildcards
  - plain `http` to a non-loopback host in `vite build` (`vite serve` allows it for LAN testing)
- Unused `https://*.tile.openstreetmap.org` was removed from `img-src` (tiles come only from CartoDB, see `theme.ts`). `data:` stays in `img-src` because Vite inlines Leaflet's control images from `leaflet.css`.
- The meta tag is emitted through Vite's tag API (`head-prepend`) instead of a string replace on `<head>`.
- Unchanged: `default-src 'none'` and the Phase 20 `'unsafe-inline'` trade-off in script/style (T-20-03-02). Nothing was added. There is no `child-src`: `frame-src` and `worker-src` are set explicitly.

Hostile-env build matrix (actual `vite build` runs):

| Input | Result |
|---|---|
| unset | warn, localhost defaults |
| `""` | warn, same-origin only |
| `https://API.Example.com:443/api/` | `https://api.example.com` |
| `https://api.example.com:8443/v1/api/` | `https://api.example.com:8443` |
| `http://127.0.0.1:8787/api` | allowed (loopback) |
| `not a url`, `*`, `ftp://x.com` | build fails |
| `https://u:p@api.example.com/api` | build fails (credentials) |
| `http://[::1]:8787/api` | build fails (IPv6) |
| `http://api.example.com/api` | build fails (http in prod) |
| `https://*.example.com`, `https://x.com;script-src` | build fails (host) |

## Tests

- **Unit**, `frontend/tests/csp-plugin.test.ts` (38 tests):
  - exact directive output for https prod and for localhost
  - fallback when unset, empty, root-relative and de-dup cases
  - origin reduction for trailing slash, path, query, port, case, IDN, IPv4 and loopback
  - rejection of malformed, wildcard, injection, quotes, IPv6 and credentials (not echoed)
  - http in dev vs build
  - no bare `*`, scheme-only source, `unsafe-eval`, `blob:` or unpkg
  - plugin wiring: reads `config.env`, emits one `head-prepend` meta, warns on missing env, and throws on a malformed URL
- **E2E**, `tests/e2e/csp.spec.ts`: no longer fixme. The CSP is enforced, API, Keycloak, tiles and widget APIs are mocked at the network layer, and any `securitypolicyviolation` or CSP console report fails the test. It covers:
  - index
  - the 8 city pages: Leaflet tiles loaded, `leaflet.css` applied, markers, weather and news widgets rendered
  - dashboard: trip card from `GET /trips`
  - trip: title plus map
  - trip-edit: editor populated
  - profile: name from `/users/me`, plus the Keycloak account API request
  - service worker registration under `worker-src`

  Mutation check: against a build of the old plugin, 13 of 14 fail.
- `bypassCSP` was removed from `auth.spec.ts`, `trips.spec.ts` (x2) and `trip-edit.spec.ts`. It existed only to hide this bug, and those specs pass with the CSP enforced.
- **A11y**: 7 city pages gained `role="application" aria-label="Map of <City>"`, mirroring tokyo.html. `frontend/tests/map-aria-label.test.ts` (19 tests) parses every HTML page that has a `#map`. The `city-pages.spec.ts` label check is no longer fixme and asserts the label matches the h1.

Frontend unit suite: 273 passed. Full chromium run (CI mode, preview build): 206 passed, 48 skipped (fixme needing a real Keycloak or backend), 6 failed. All 6 failures are in `search.spec.ts`, which expects `aria-expanded` on the search input. Phase 23 A11Y-01 removed that attribute, so this is spec drift between Phases 23 and 24. It is unrelated to this change: neither file was touched here, and the same 6 tests failed before these changes.

## Not verified / open

- Real CartoDB tiles and real Keycloak/API were not loaded: the sandboxed browser has no route to the internet, so tiles were stubbed. Screenshots of kyoto (map plus widgets), dashboard (trip card) and trip show the UI rendering under the enforced CSP.
- `dashboard.ts` posts to a relative `/api/auth/otp-request` and `/api/auth/otp-verify`. These are same-origin, so they pass the CSP, but on GitHub Pages they hit Pages rather than the backend. That file is owned by another agent and was not touched.
- `.env.example` has `VITE_API_URL=http://localhost:8787` without `/api`, which does not match the runtime default. Not changed here.
- A meta CSP cannot set `frame-ancestors`. That still needs an HTTP header (T-20-03-03).
