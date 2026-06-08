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
RESEND_API_KEY=<optional — only needed for email sending>
```

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
terraform init
terraform apply
cd ../..
```

This creates the Keycloak realm, clients (japan-trip-frontend, japan-trip-worker), PKCE S256 enforcement, redirect URIs, audience mappers, and test users.

After apply, get the worker client secret:
```bash
terraform output -raw japan_trip_worker_secret
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
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npx drizzle-kit push --force
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npx tsx src/db/seed.ts
cd ..
```

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

Test users (created by Terraform):
- `testuser` / `E2e-Test-Password-1!`
- `otp-test@local` / `Otp-Test-Password-1!`
