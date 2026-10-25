# TrustVault

TrustVault is an encrypted, zero-trust document-sharing application. The server authorizes every protected operation; a visible UI control never grants access by itself.

## Roles

- **Owner:** uploads documents, replaces or deletes only their own documents, and grants/revokes recipient access.
- **Viewer:** can read or replace a document only through a current, explicit per-document grant. An edit grant does not permit sharing or deletion.
- **Administrator:** has a global activity view but does not automatically receive document contents. Content still requires an explicit grant.

## Local setup

1. Install Node.js 20+ and PostgreSQL.
2. In `backend`, copy `.env.example` to `.env` and configure database credentials, `VAULT_ENCRYPTION_KEY` (64 hexadecimal characters), and `AUDIT_HMAC_KEY` (at least 32 characters).
3. Create the configured PostgreSQL database.
4. Apply `backend/migrations/001_initial_schema.sql` through `007_audit_chain_epochs.sql` in numeric order. Use the migration scripts in `backend/scripts/` where supplied; never replay migrations blindly against production.
5. Run `npm install` in `backend` and `frontend`.
6. Start the backend with `npm run dev` from `backend`, then the frontend with `npm run dev` from `frontend`.
7. Open `http://localhost:5173`.

## Verification

```text
backend:  npm run build && npm test
frontend: npm run build && npm run lint
```

The backend listens on port 3000. Vite proxies `/api` to it; confirm the proxy configuration in `frontend/vite.config.ts` before deployment.

## Security design

- Supported files are streamed, size-limited, signature-validated, AES-256-GCM encrypted, and content-hashed.
- `AuthorizationDecisionEngine` evaluates owner access, active grants, expiry, revocation, roles, and action on every read/replacement request.
- Replacement writes fresh ciphertext and commits metadata/audit evidence before old-ciphertext cleanup.
- Downloads are audit-gated: plaintext is not decrypted if `DOCUMENT_DOWNLOADED` cannot be durably appended.
- Audit events are append-only and HMAC-chain verified.

See [API.md](API.md), [THREATS.md](THREATS.md), and [PROMPTS.md](PROMPTS.md) for endpoint access, threat analysis, and AI-work evidence.

For architecture, recording a five-minute demo, and final deployment handoff, see [TECHNICAL_WRITEUP.md](TECHNICAL_WRITEUP.md), [DEMO.md](DEMO.md), and [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md).

## Controlled demo accounts

The configured database contains the following controlled accounts for local/staging demonstration only:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `demo-admin@trustvault.local` | `TrustVaultDemo!2026#Review` |
| Owner | `demo-owner@trustvault.local` | `TrustVaultDemo!2026#Review` |
| Viewer | `demo-viewer@trustvault.local` | `TrustVaultDemo!2026#Review` |

These are intentionally public demonstration credentials, not production-user accounts. Rotate or replace the shared password before any broader deployment.

## Deliberate scope limits

This repository includes Docker/Render and Vercel deployment configuration, but no public deployment, production secret-manager configuration, or recorded five-minute video yet. Categories and authorized search filters are implemented. Version recovery remains intentionally out of scope; the supported change workflow is a validated, authorized document replacement.
