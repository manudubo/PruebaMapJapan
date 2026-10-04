# Neon smoke checklist (review S4)

The backend test suite runs on node-postgres (`DB_DRIVER=pg`). Production runs
`drizzle-orm/neon-http` over `@neondatabase/serverless` 0.10.x, and these paths
have never run in a test or a deploy:

- `db.execute(...).rows` for `otp_issue()` (`backend/src/db/queries/otp.ts`)
- the `code` / `message` / `column` fields that `dateConflict()` and
  `pgErrorCode()` read (`backend/src/db/pg-errors.ts`), which drive the 422
  `date_conflict` and 409 `conflict` responses
- the schema guard's catalog query (`backend/src/db/schema-guard.ts`)

Run this once before the first production deploy, and again after bumping
`@neondatabase/serverless` or `drizzle-orm`. It needs a Neon account; nothing
here touches production data.

## Setup

1. In Neon: **Branches → Create branch** from production (or any project), name
   it `smoke-<date>`. Copy its **direct** connection string (Connection pooling
   OFF) and its **pooled** one.
2. Migrate the branch:
   `DATABASE_URL=<direct> npm run db:preflight --workspace=backend && DATABASE_URL=<direct> npm run db:migrate --workspace=backend`
3. Start the Worker locally against it with the Neon driver:
   `backend/.dev.vars`: `DATABASE_URL=<pooled>`, `DB_DRIVER=neon`,
   `ENVIRONMENT=development`, real `KEYCLOAK_URL`/`KEYCLOAK_REALM`, then
   `npx wrangler dev` in `backend/`.
   (Or deploy to a separate preview Worker with those values.)
4. Get an access token for a test user from that Keycloak (sign in on the
   frontend, copy it from devtools, or use the e2e helper).

## Checks (expected result in brackets)

| # | Request | Expect |
|---|---------|--------|
| 1 | `GET /api/health/ready` | `200 {"status":"ready"}`; guard query works over HTTP |
| 2 | On a second branch migrated only to 0006: `GET /api/health/ready` | `503 {"code":"schema_not_migrated"}`, Worker log lists `otp_issue()` etc. |
| 3 | `POST /api/auth/otp-request` (Bearer token) | `201`; a row in `email_otp_codes`; email in Mailpit/Resend |
| 4 | Same request again at once | `429 {"code":"otp_pending","retryAfter":>0}` (proves `.rows` shape from `otp_issue`) |
| 5 | `POST /api/trips` `{name, start_date:"2026-03-10", end_date:"2026-03-01"}` | a 4xx (validation or `date_conflict`), never 500 |
| 6 | Create a trip 2026-03-01..2026-03-10, then a destination 2026-02-20..2026-02-25 | `422 {"code":"date_conflict","issues":[{"path":"start_date",...}]}`; **`path` must not be empty** (proves `column` is passed through by Neon) |
| 7 | In SQL on the branch, change the first user's `keycloak_id`, then call any `/api/trips` route with that user's token (a "new" subject with an email already taken) | `409 {"code":"email_conflict"}` (proves the 23505 `code`/`constraint` fields are read over HTTP) |
| 8 | `PUT .../destinations/:id/hotel` twice | `200` both times, one row in `hotels` (ON CONFLICT target from 0007) |
| 9 | `GET .../destinations/:id/hotel` after `DELETE` | `404 {"code":"hotel_not_found"}` |

Record the date, package versions and results below. Any 500 is a failure:
copy the Worker log line (`wrangler tail`) into the notes.

## Teardown

Delete the `smoke-*` branches in Neon. Restore `backend/.dev.vars`.

## Results

| Date | @neondatabase/serverless | drizzle-orm | Result | Notes |
|------|--------------------------|-------------|--------|-------|
|      |                          |             |        |       |
