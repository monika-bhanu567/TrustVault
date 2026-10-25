# Deployment

## Backend

Build the backend container from `backend/` and deploy it to a persistent Node/Docker host. Configure a health check at `/ready`.

Required backend environment variables: `NODE_ENV`, `PORT`, `DATABASE_URL`, `FRONTEND_ORIGIN`, `VAULT_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`.

The service must run with `NODE_ENV=production`; it then binds to `0.0.0.0` by default. Set `FRONTEND_ORIGIN` to the exact Vercel URL. Do not set storage credentials in Vercel.

## Frontend

Import the repository into Vercel with root directory `frontend`, build command `npm run build`, and output directory `dist`. Set only `VITE_API_BASE_URL` to the deployed backend origin (without a trailing slash). Do not set database, audit, encryption, or Supabase service-role variables in Vercel.

## Before go-live

1. Create a private Supabase Storage bucket named `trustvault-encrypted`.
2. Configure backend-only Supabase Storage credentials.
3. Run the encrypted-storage migration and verify each migrated document decrypts and hashes correctly.
4. Investigate the known missing `README.md` ciphertext before representing all legacy documents as available.
5. Deploy backend first, set `FRONTEND_ORIGIN`, then deploy Vercel frontend with `VITE_API_BASE_URL`.

Run storage migration from `backend` only after the bucket credentials are configured:

```text
node scripts/migrate-encrypted-storage.mjs
```

The command safely retries existing objects and verifies decryption/integrity. It reports missing legacy ciphertext without modifying records. Only after review, quarantine missing records with `node scripts/migrate-encrypted-storage.mjs --quarantine-missing`.
