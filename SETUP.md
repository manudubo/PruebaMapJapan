# Setup Guide

Step-by-step instructions for setting up the development environment on a fresh machine.

## Prerequisites

Install these before proceeding:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 3.0+
- [Node.js](https://nodejs.org/) 22+
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.0
- git

## Step 1 — Clone the repository

```bash
git clone https://github.com/manud/PruebaMapJapan.git
cd PruebaMapJapan
```

## Step 2 — Copy environment templates

```bash
# Frontend Vite env vars (VITE_* prefixed)
cp .env.example .env

# If a frontend/.env.example exists:
cp frontend/.env.example frontend/.env
```

## Step 3 — Create backend env file

The backend reads environment variables from `backend/.dev.vars` (Wrangler convention — NOT `.env`).

Create `backend/.dev.vars` with the following content, filling in your values:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
VALID_AUDIENCES=japan-trip-frontend
KC_ADMIN_CLIENT_ID=japan-trip-worker
KC_ADMIN_CLIENT_SECRET=<get from terraform output or KC admin console after step 5>
OTP_SECRET=<any secure random string, e.g. openssl rand -hex 32>
RESEND_API_KEY=<optional locally — required when ENVIRONMENT is not development>
ENVIRONMENT=development
```

`ENVIRONMENT=development` enables the localhost CORS origins and the Mailpit
email fallback. Any other value (including unset under `wrangler`) is treated as
production: only `https://manud.github.io` is allowed by CORS and OTP requests
fail loudly if `RESEND_API_KEY` is missing.

## Step 4 — Start Keycloak

Keycloak must be running before Terraform can apply realm configuration.

```bash
cd keycloak
docker compose up -d
cd ..
```

Wait for Keycloak to be ready (check http://localhost:8080 in your browser — login page should appear).

## Step 5 — Apply Terraform (Keycloak realm configuration)

```bash
cd terraform/keycloak
cp local.tfvars.example local.tfvars   # then set kc_admin_pass and the test-user passwords
terraform init
terraform apply -var-file=local.tfvars
cd ../..
```

The test-user password variables have no defaults (SEC-19), so `terraform apply` without
`-var-file=local.tfvars` stops and asks for them. `local.tfvars` is gitignored.

This creates the Keycloak realm, clients (japan-trip-frontend, japan-trip-worker), PKCE S256 enforcement, redirect URIs, audience mappers, and test users.

After apply, get the worker client secret:
```bash
terraform output -raw worker_client_secret
```

Update `backend/.dev.vars` with this value for `KC_ADMIN_CLIENT_SECRET`.

## Step 6 — Install dependencies

```bash
npm install
```

This installs all workspace dependencies (frontend, backend, tests).

## Step 7 — Set up the database

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npm run db:migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npx tsx src/db/seed.ts
cd ..
```

Use `db:migrate`, not `drizzle-kit push`: `push` does not create the SQL functions and
triggers the backend needs, and a database created with it cannot be migrated later
(see `backend/src/db/README.md`).

## Step 8 — Start all services

```bash
npm run dev
```

This starts:
- Keycloak (if not already running) via Docker Compose
- Backend API at http://localhost:8787
- Frontend at http://localhost:5173/PruebaMapJapan/

Terminal output shows color-labeled prefixes for each process.

## Verifying the setup

Open http://localhost:5173/PruebaMapJapan/ — you should see the app. Click "Login" — Keycloak login page should appear.

Test users (created by Terraform, passwords from your `local.tfvars`):
- `e2e-test@local` (`e2e_test_password`), `testuser` (`testuser_password`)
- `otp-test@local` (`e2e_otp_password`), `session-test@local` (`e2e_session_password`)
- `new_user_test` (`new_user_test_password`), `trip_edit_test_user` (`trip_edit_test_user_password`)

---

## Production backend (optional)

> **Only needed when you deploy the backend to production.** The public GitHub
> Pages demo (the static Japan itinerary) needs none of this. If you do nothing,
> every push to `main` still deploys the demo, and the backend deploy job ends
> green with the notice "Backend deploy skipped".

The backend has three parts: the API (a Cloudflare Worker), its database, and
Keycloak for login. The full walkthrough is in `DEVELOPMENT.md` → "Production
deployment". This section covers the GitHub secrets the automatic deploys read.

### What Neon is

Neon is a hosted PostgreSQL database: you get a database on the internet without
running a server. The production Worker stores users and trips there, and the
deploy workflow updates its structure (the "migrations") before each new Worker
version goes live.

### GitHub secrets the workflows read

All of them live in **GitHub → your repository → Settings → Secrets and
variables → Actions → Repository secrets**. Neither deploy workflow declares a
GitHub *environment* for these secrets (`deploy-frontend.yml` uses the built-in
`github-pages` environment only for the Pages deployment itself), so add them as
**repository secrets**, not environment secrets.

| Secret | Read by | Where you get the value |
|--------|---------|-------------------------|
| `CLOUDFLARE_API_TOKEN` | deploy-backend | Cloudflare dashboard → your profile icon → **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers**. Its presence switches the backend deploy on. |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-backend | Cloudflare dashboard → **Workers & Pages** → "Account ID" in the right-hand column. |
| `MIGRATION_DATABASE_URL` | deploy-backend | Neon, see "Create the migration database secret" below. **Required once `CLOUDFLARE_API_TOKEN` is set.** |
| `VITE_API_URL` | deploy-frontend | The Worker URL plus `/api`, e.g. `https://prueba-map-japan-api.<account>.workers.dev/api` (shown by `wrangler deploy`). |
| `VITE_KEYCLOAK_URL` | deploy-frontend | The public URL of your Keycloak (e.g. the Railway domain). |
| `VITE_KEYCLOAK_REALM` | deploy-frontend | `japan-trip` |
| `VITE_KEYCLOAK_CLIENT_ID` | deploy-frontend | `japan-trip-frontend` |

The Worker's own runtime secrets (`DATABASE_URL`, `KEYCLOAK_URL`, `OTP_SECRET`,
`RESEND_API_KEY`, ...) are not GitHub secrets: set them with
`wrangler secret put <NAME>` (DEVELOPMENT.md, Step 3).

### What happens on a push to `main`

| `CLOUDFLARE_API_TOKEN` | `MIGRATION_DATABASE_URL` | Backend deploy job |
|---|---|---|
| not set | (any) | Green, skipped, with a notice. Demo-only setup. |
| set | not set | **Red.** Error "MIGRATION_DATABASE_URL is missing". Nothing is deployed. |
| set | set | Pre-flight checks → `db:migrate` → `wrangler deploy`. Any failing step stops the deploy. |

### Create the migration database secret

The secret is named exactly **`MIGRATION_DATABASE_URL`**.

**1. Get the value from Neon**

1. Optional but recommended before the first automatic migration: make a
   backup. In Neon open your project → **Branches → Create branch**, from the
   production branch. It is a free, instant copy you can go back to.
2. Open https://console.neon.tech and select the project.
3. On the project **Dashboard**, click the **Connect** button.
4. In the dialog pick the **production branch**, the **database** (usually
   `neondb`) and the **role** that owns the tables (usually `neondb_owner`).
   Migrations must run as the owner of the tables, so do not pick a role
   that was created later with fewer rights.
5. Turn **OFF "Connection pooling"**. Migrations need the direct host; the
   host name must **not** contain `-pooler`.
6. Copy the connection string. It looks like
   `postgresql://<role>:<password>@<host>/<db>?sslmode=require`.

   If the password is hidden or unknown: project → **Roles** → the role →
   **Reset password**. Warning: this changes the password for everything that
   uses that role, including the Worker's `DATABASE_URL`. After a reset, also
   update the Worker: `cd backend && wrangler secret put DATABASE_URL` (use the
   *pooled* string there, with `-pooler` in the host).

**2. Store it in GitHub**

1. GitHub → your repository → **Settings**.
2. **Secrets and variables → Actions**.
3. Tab **Secrets**, section **Repository secrets** → **New repository secret**.
4. **Name:** `MIGRATION_DATABASE_URL` (exactly this, capitals and underscores).
5. **Secret:** paste the connection string from step 1.
6. Click **Add secret**.

**3. Check that it works**

1. Push to `main` (or open **Actions → CI** and re-run the latest run on `main`;
   the deploy starts when CI succeeds).
2. Open **Actions → Deploy Backend to Cloudflare Workers** → the newest run →
   job **deploy**.
3. You should see the steps **Pre-flight migration checks**, **Apply database
   migrations** and **Deploy to Cloudflare Workers**, all green.
4. If the secret is missing, the first step **Check deploy configuration** fails
   with: *"MIGRATION_DATABASE_URL is missing: Cloudflare deploy is configured but
   the MIGRATION_DATABASE_URL secret is not set. Refusing to deploy..."*.
   Nothing was deployed. Add the secret and click **Re-run jobs**.
5. If **Pre-flight migration checks** fails, its log says what blocks the
   migration (for example two accounts with the same email, shown redacted)
   and how to fix it; see `backend/src/db/README.md` → "Pre-flight checks".
6. After the deploy, `https://<worker-url>/api/health/ready` should answer
   `{"status":"ready"}`. `503 schema_not_migrated` means migrations did not run.

**4. Rotation and safety**

- To rotate: reset the role's password in Neon (step 1), then edit the
  `MIGRATION_DATABASE_URL` secret in GitHub (Settings → Secrets and variables →
  Actions → the secret → **Update**), and update the Worker's `DATABASE_URL` if
  it uses the same role.
- **Never paste this value into chat, issues, pull requests, commit messages or
  logs.** It contains the database password and gives full control of the data.
  GitHub hides secrets in workflow logs; do not echo it yourself.
