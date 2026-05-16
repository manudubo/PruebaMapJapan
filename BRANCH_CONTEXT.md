# UI demo style consistency branch

Branch: `ui-demo-style-consistency`

## Goal

Bring the application screens and Keycloak IDP screens into the same visual language as the existing trip demo: flat surfaces, Inter typography, square controls, minimal decoration, no rounded cards/buttons, and consistent spacing.

The existing demo pages are treated as the visual source of truth and are not redesigned.

## Included changes

- Shared app CSS was normalized around demo-like tokens for buttons, forms, dialogs, lists, loading states, and trip surfaces.
- Dashboard, profile, trip detail, and trip edit screens were adjusted to consume the shared flat styles instead of page-specific rounded/glass styles.
- The landing page now uses a higher-resolution dark-mode screenshot from the real Tokyo demo as a blurred, low-opacity hero image layer with a subtle scroll effect.
- The unauthenticated dashboard state only exposes the sign-in prompt; trip loading and trip creation controls are hidden until a session exists.
- The shared CSS now enforces `[hidden]` over component display rules, so buttons or grids cannot become visible accidentally because of `.btn` or layout styles.
- The navbar keeps the brand/Home action only once and removes the duplicated `Home` tab.
- Auth-dependent navbar actions are hidden when there is no active Keycloak session.
- The profile password flow uses Keycloak's `UPDATE_PASSWORD` action instead of sending users to the unsupported account-console password URL.
- The Keycloak login theme hides the default header wrapper and adds a neutral `Return` action back to the app.
- A Keycloak account theme stylesheet exists for visual consistency if the account console is enabled by realm/client configuration.
- Playwright coverage was added for app style consistency and the Keycloak login theme.

## Out of scope

- No backend behavior was changed.
- The direct URL `http://localhost:8080/realms/japan-trip/account/` still depends on Keycloak account-console client/realm configuration. This branch avoids linking users there from the frontend.
- Demo itinerary pages remain the baseline and were not redesigned.

## Verification

Run from `C:\tmp\ui-demo-style-consistency`:

```powershell
npm.cmd run typecheck --workspace=frontend
npm.cmd run build --workspace=frontend
npm.cmd test -- --project=chromium ui-consistency.spec.ts idp-theme.spec.ts
```

Local URLs used during validation:

- App: `http://localhost:5173/PruebaMapJapan/`
- Keycloak: `http://localhost:8080`
