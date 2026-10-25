# TrustVault engineering guide

## Project overview

TrustVault is a zero-trust document-sharing system for sensitive files. It is designed to make document access explicit, enforce it on the backend, and retain auditable evidence of security-relevant activity.

## Product vision

The product treats document protection as an authorization and evidence problem rather than a user-interface problem. A user may access a document only when the backend authorizes the current request. Important document and grant operations must be traceable without recording document plaintext in the audit ledger.

## Technology stack

- **Frontend:** React, TypeScript, Vite, and Lucide icons.
- **Backend:** Node.js, TypeScript, Fastify, HTTP-only session cookies, and multipart upload handling.
- **Database:** PostgreSQL with optional Supabase connectivity through `DATABASE_URL`.
- **Storage:** AES-256-GCM encrypted local files for development and private Supabase Storage for configured deployments.
- **Deployment configuration:** Docker-based Render backend configuration and Vercel SPA configuration.

## Core functional requirements

- Support authenticated `ADMIN`, `OWNER`, and `VIEWER` roles.
- Allow active users to upload supported documents and view only documents they are authorized to access.
- Support per-document named grants with read and edit capabilities.
- Allow owners to update grants, set an optional future expiry, and revoke active grants.
- Enforce document authorization on the backend for listing, download, replacement, sharing, category updates, and deletion.
- Record uploads, downloads, replacements, deletions, grant changes, revocations, and relevant access denials.
- Provide authorized document search by name, owner, category, and date.
- Provide an administrator activity view without automatically granting access to document contents.

## Security requirements

### Encryption and integrity

- Accept only PDF, PNG, JPEG, and plain-text files, subject to server-side type, signature, and size validation.
- Encrypt accepted content with AES-256-GCM using a 32-byte hexadecimal `VAULT_ENCRYPTION_KEY`.
- Store a random storage key, IV, authentication tag, size, and SHA-256 content hash with document metadata.
- Verify authenticated decryption and the content hash before releasing plaintext.
- Use a new encrypted storage key during replacement; remove previous ciphertext only after the replacement metadata and audit transaction commits.

### Authorization and sessions

- Treat frontend visibility as a usability concern only; the backend remains the source of truth for authorization.
- Re-evaluate ownership, active status, grant permissions, expiry, and revocation on every protected request.
- Use secure, HTTP-only session cookies. In production, configure the exact frontend origin and secure cross-site cookie behavior.
- Do not permit administrators to access document contents without ownership or an explicit active grant.

### Audit records

- Use append-only database triggers for audit events.
- Link audit events using HMACs and verify the active audit epoch through the protected verification endpoint.
- Fail closed for protected download release when required audit evidence cannot be appended.
- Never write document plaintext, encryption material, service-role credentials, or session tokens to audit metadata.

### Secret management

- Keep `DATABASE_URL`, `VAULT_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`, and Supabase service-role credentials on the backend only.
- Do not expose server secrets through Vite environment variables or frontend bundles.
- Preserve the encryption key for existing ciphertext; rotating it requires a planned, verified re-encryption process.

## User interface and design system

- Maintain a professional, accessible interface using Mocha Brown, Pale Lavender, and Platinum Silver.
- Use responsive layouts with keyboard-visible focus states and reduced-motion support.
- Keep public landing pages, sign-in/sign-up views, and authenticated workspace views distinct.
- Present access status, grant capability, expiry, revocation, audit outcomes, loading states, and errors clearly.

## Architecture and implementation guidelines

- Keep authorization logic centralized in the backend decision engine.
- Use reusable React components and avoid duplicating business logic in the user interface.
- Add database changes through new, ordered migrations; do not rewrite applied migrations.
- Use parameterized database queries, explicit validation, transaction boundaries for related changes and audit events, and safe temporary-file cleanup.
- Use stable API error responses that do not disclose document existence to unauthorized users.
- Keep deployment configuration and environment examples free of real values.

## Testing and quality assurance

- Run backend unit tests with `npm test` and compile with `npm run build` from `backend`.
- Run frontend lint and production build with `npm run lint` and `npm run build` from `frontend`.
- Use isolated databases for `test:uploads` and `test:grants` through `TEST_DATABASE_URL`.
- Run the guarded end-to-end flow only with explicit `E2E_TEST_ALLOWED=true`.
- Cover owner, ungranted, read-only, write-enabled, expired, revoked, and administrator scenarios when changing authorization.
- Verify uploads, downloads, replacement integrity, audit behavior, and invalid-file rejection after storage changes.

## Deployment and configuration

- Configure the backend with database, encryption, audit, and private Supabase Storage variables through the deployment provider's protected environment-variable interface.
- Set `SUPABASE_STORAGE_BUCKET` to the private bucket used for encrypted objects.
- Configure `FRONTEND_ORIGIN` with the exact deployed frontend origin.
- Set only `VITE_API_BASE_URL` in the Vercel frontend environment.
- Confirm `/health` and `/ready` before deploying the frontend. Production readiness requires private storage configuration.
- Migrate available local ciphertext to private storage only from an environment that can access both the legacy ciphertext and the configured backend-only storage credentials.

## Development priorities

### Implemented

The repository includes session authentication, document encryption, server-side authorization, grants and revocation, document replacement, audit epochs, search filters, administrator activity views, and responsive frontend routes.

### Pending operational work

- Configure production storage credentials and migrate available encrypted legacy files.
- Complete backend and frontend deployment configuration with the final origins.
- Verify the complete workflow against the deployed environment.
- Address version recovery only if product requirements require it; the current supported update model is replacement.

## Acceptance criteria

A feature is complete only when all applicable conditions are met:

1. The backend independently authorizes every protected route affected by the feature.
2. Valid and denied outcomes produce the required audit evidence without storing sensitive file contents.
3. Validation, error handling, transaction cleanup, and encrypted-storage behavior are covered by appropriate tests.
4. Builds and relevant automated tests pass.
5. The interface accurately reflects backend outcomes without relying on hidden controls for security.
6. Deployment-dependent functionality is described as pending until it is verified in the target environment.
