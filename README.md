# TrustVault

TrustVault is a zero-trust document-sharing application for sensitive files. Its backend independently authorizes protected operations, stores documents as authenticated ciphertext, and records security-relevant activity in an append-only audit ledger.

## Overview

TrustVault addresses overly broad document permissions and insufficient access evidence. It uses per-document ownership and named grants, evaluates permissions for each protected request, and records the decisions that affect document access.

## Features and status

### Implemented

- Session-based authentication with `ADMIN`, `OWNER`, and `VIEWER` roles.
- Validated PDF, PNG, JPEG, and plain-text uploads up to 10 MiB.
- AES-256-GCM encryption, random UUID storage keys, authentication tags, and SHA-256 content hashes.
- Authorized listing, download, category updates, replacement, and soft deletion.
- Named read/edit grants with expiry and immediate revocation enforcement.
- Server-side authorization for reads, edits, sharing, deletion, and search.
- Audit events for document, grant, and selected denied-access operations.
- HMAC-linked verification of the active audit epoch.
- Administrator security-activity dashboard without automatic document-content access.
- Responsive React public pages and dedicated sign-in/sign-up views.

### Deployment-dependent work

- Render and Vercel configuration are included; no public deployment URL is recorded in this repository.
- Private Supabase Storage requires backend-only credentials before local ciphertext migration can run.
- A legacy record whose ciphertext is unavailable must be reported or quarantined; content is never recreated.

## Technology stack

- React, TypeScript, Vite, and Lucide icons.
- Node.js, TypeScript, Fastify, and HTTP-only session cookies.
- PostgreSQL, with optional Supabase PostgreSQL connectivity through `DATABASE_URL`.
- Local encrypted files for development and private Supabase Storage for configured deployments.
- Vitest and guarded route-level integration scripts.

## Architecture

```text
React/Vite frontend
        |  HTTP-only session cookie
        v
Fastify API
  |- session validation and authorization decision engine
  |- document, grant, and audit routes
  |- encrypted storage adapter
        |--> PostgreSQL / Supabase PostgreSQL
        |--> local ciphertext or private Supabase Storage
```

During development, Vite proxies `/api` to `http://127.0.0.1:3000`. Production clients use `VITE_API_BASE_URL`.

## Security design

Protected document operations use a centralized authorization engine. Owners manage only their own documents; recipients require a current named grant. Read grants permit download and edit grants permit replacement. Expiry and revocation are evaluated for each protected request.

Files are validated before encryption. Download verifies AES-GCM authentication and the stored SHA-256 hash before releasing plaintext. Document replacement writes new ciphertext before removing prior ciphertext after the metadata and audit transaction succeeds.

Audit events are protected by database append-only triggers and HMAC links. `007_audit_chain_epochs.sql` preserves historical records without alteration and provides a new verifiable active epoch if a prior signing key is unavailable.

See [API.md](API.md) and [THREATS.md](THREATS.md) for endpoint access and threat controls.

## Prerequisites

- Node.js 20 or later.
- npm.
- PostgreSQL, or a PostgreSQL-compatible `DATABASE_URL`.

## Installation and environment

Install dependencies separately:

```powershell
cd backend
npm install

cd ..\frontend
npm install
```

Copy `backend/.env.example` to `backend/.env`. Do not commit `.env` files.

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE

VAULT_ENCRYPTION_KEY=64_HEX_CHARACTERS
AUDIT_HMAC_KEY=A_LONG_RANDOM_SERVER_SIDE_SECRET

FRONTEND_ORIGIN=https://YOUR-FRONTEND.example
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SERVER_SIDE_ONLY_SECRET
SUPABASE_STORAGE_BUCKET=trustvault-encrypted

TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/trustvault_test
```

`VAULT_ENCRYPTION_KEY` must remain unchanged for previously encrypted documents. Database credentials, audit secrets, encryption keys, and Supabase service-role keys must remain server-side.

## Database migrations

Apply the files in `backend/migrations/` in numeric order, from `001_initial_schema.sql` through `007_audit_chain_epochs.sql`. Review each migration before applying it to a shared database. Do not reset or truncate a database to replay migrations.

## Development

Start the backend:

```powershell
cd backend
npm run dev
```

Start the frontend in another terminal:

```powershell
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173`. Public routes include `/`, `/features`, `/security`, `/signin`, and `/signup`.

## Testing and builds

```powershell
# backend
cd backend
npm test
npm run build

# frontend
cd ..\frontend
npm run lint
npm run build
```

`npm run test:uploads` and `npm run test:grants` require an isolated database through `TEST_DATABASE_URL`. The guarded end-to-end test also requires explicit opt-in:

```powershell
cd backend
$env:E2E_TEST_ALLOWED = "true"
npm run test:e2e
```

## Deployment

[render.yaml](render.yaml) defines a Docker-based Render backend service. [frontend/vercel.json](frontend/vercel.json) provides Vercel SPA route fallback. See [DEPLOYMENT.md](DEPLOYMENT.md) for operational deployment instructions.

Production requires `DATABASE_URL`, `VAULT_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` on the backend. Production readiness fails when private Storage configuration is absent. Set only `VITE_API_BASE_URL` in Vercel and configure the exact Vercel origin as `FRONTEND_ORIGIN` on the backend.

To migrate available local ciphertext after configuring storage credentials:

```powershell
cd backend
npm run build
node scripts/migrate-encrypted-storage.mjs
```

## Documentation

- [API.md](API.md): endpoint access model.
- [THREATS.md](THREATS.md): threats and mitigations.
- [THREADS.md](THREADS.md): current engineering decisions and operational items.
- [DEPLOYMENT.md](DEPLOYMENT.md): deployment guidance.
- [TECHNICAL_WRITEUP.md](TECHNICAL_WRITEUP.md): architecture and scope notes.

## Contributing and license

Keep changes focused, preserve backend authorization as the source of truth, and add tests for security-sensitive behavior. Do not commit credentials, `.env` files, generated runtime output, or encrypted user files.

No license file is currently included. Do not assume redistribution rights beyond the repository owner's terms.
