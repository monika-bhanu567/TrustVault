# TrustVault technical write-up

## What was built

TrustVault is an encrypted document-sharing service with per-document ownership and named grants. The React/Vite client is a usability layer; Fastify independently enforces access before every protected content operation.

## Permission model

- An **Owner** owns uploaded documents and may share, revoke, categorize, replace, and delete only their own documents.
- A **Viewer** receives no content access unless a current document grant exists. A read grant permits download; a write grant additionally permits replacement. Neither permits onward sharing or deletion.
- An **Administrator** receives the global security dashboard and audit activity, but does not automatically receive document content. Content still requires an explicit grant.
- A grant is checked on every request. Expiry and `revoked_at` are evaluated at decision time, so revocation immediately blocks future download and replacement requests.

## Security architecture

- File plaintext is validated by type/signature and size before AES-256-GCM encryption.
- Stored metadata includes random storage key, IV, authentication tag, size, and SHA-256 plaintext hash.
- Download decryption verifies authenticated encryption and SHA-256 before streaming a protected temporary file.
- The authorization engine centralizes `READ`, `EDIT`, and `SHARE` decisions.
- Audit events are append-only at database level and HMAC-chain linked. Significant actions—including permitted downloads, writes, deletes, grant changes, revocations, and denied access—are recorded without document contents or secrets. The active epoch is verified independently; a preserved legacy segment is explicitly reported as unverifiable because its original key was unavailable, rather than being silently rewritten.
- Cross-origin production requests are restricted to `FRONTEND_ORIGIN`; cookies are HTTP-only, Secure in production, and use `SameSite=None` only for the configured cross-site frontend deployment.

## Cloud design

PostgreSQL data is verified in Supabase. The private `trustvault-encrypted` bucket is prepared. The storage adapter switches to Supabase Storage only when backend-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured; otherwise local development continues to use local encrypted storage. A retry-safe migration tool verifies decryption and hashes after upload.

## Deliberate scope limits

- A legacy README document record has no matching ciphertext. TrustVault will not fabricate it; migration tooling reports it and can explicitly quarantine it after review.
- Public deployment URLs and demo credentials are intentionally not listed until the backend/Storage/Vercel accounts are configured.
- The video itself cannot be committed as a substitute for a real demonstration; `DEMO.md` supplies the precise recording flow.

## AI usage

See `PROMPTS.md`. AI was used for implementation support and repeatedly checked against server-side authorization, HMAC audit behavior, storage cleanup, and live verification. The documented corrections include a revoke request header defect and the distinction between a permission selector and real edit authorization.
