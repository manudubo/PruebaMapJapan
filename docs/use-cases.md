# Use Case Inventory

User-facing scenarios and their E2E test coverage status.

**Coverage Status:** Full = happy path + edge cases covered | Partial = happy path only or incomplete | None = no E2E coverage

| User Action | E2E Spec File | Coverage Status |
|-------------|---------------|-----------------|
| Login with password | `tests/e2e/auth.spec.ts` | Full |
| Logout | `tests/e2e/auth.spec.ts` | Full |
| Register passkey | `tests/e2e/passkeys.spec.ts` | Full |
| Authenticate with passkey | `tests/e2e/passkeys.spec.ts` | Full |
| OTP email verification | `tests/e2e/otp.spec.ts` | Full |
| Session expiry and token refresh | `tests/e2e/session-management.spec.ts` | Full |
| Create trip | `tests/e2e/trips.spec.ts` | Partial |
| List trips | `tests/e2e/trips.spec.ts` | Full |
| Delete trip | `tests/e2e/trips.spec.ts` | Partial |
| Edit trip details | `tests/e2e/trip-edit.spec.ts`, `tests/e2e/trip-edit-integration.spec.ts` | Partial |
| Add destination with hotel | — | None |
| Add day with activities | — | None |
| Share trip publicly | `tests/e2e/public-sharing.spec.ts` | Full |
| Search trips and activities | `tests/e2e/search.spec.ts` | Full |
| Geocode a location (hotel form) | `tests/e2e/geocoder.spec.ts` | Partial |
| Geocode a location (destination / activity forms) | — | None |
| New user onboarding (empty-state dashboard) | — | None |
| Full new-user trip creation (login → create → edit → delete) | — | None |
| PWA install and offline use | `tests/e2e/pwa.spec.ts` | Full |
| Keycloak login page theme | `tests/e2e/idp-theme.spec.ts` | Full |
| Landing page / Japan 2026 demo | `tests/e2e/landing.spec.ts` | Full |
| City itinerary pages | `tests/e2e/city-pages.spec.ts` | Full |
| Backend API integration | `tests/e2e/api.spec.ts` | Partial |
| JWT audience rejection (wrong-aud → 401) | `tests/e2e/api.spec.ts` | Full |

## Coverage Gaps (Phase 14 candidates)

Rows with `None` coverage are candidates for Phase 14 E2E Expansion:

- New user creation end-to-end
- Empty-state dashboard
- Add destination with hotel (UI flow)
- Add day with activities (UI flow)
- Geocoder on destination and activity forms
