# TrustVault Backend

TrustVault is a document vault backend featuring session-based authentication, role-based access control, encrypted document storage, document grants, and an HMAC-linked audit log.

## Requirements

- Node.js and npm
- PostgreSQL
- A local TrustVault database

## Installation

Run these commands from the backend directory:

    npm install

## Environment configuration

Create your local environment file:

    Copy-Item .env.example .env

Edit .env and configure your PostgreSQL connection, server settings, and security keys.

Required security settings:

- VAULT_ENCRYPTION_KEY: exactly 64 hexadecimal characters representing a 32-byte key.
- AUDIT_HMAC_KEY: a secret of at least 32 characters.

Generate independent random keys locally:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Never commit .env or share its secrets.

## Database setup

Create the PostgreSQL database configured in .env.

Apply migrations 001 through 003 in order using psql:

    psql -h localhost -p 5432 -U postgres -d trustvault -v ON_ERROR_STOP=1 -f .\migrations\001_initial_schema.sql
    psql -h localhost -p 5432 -U postgres -d trustvault -v ON_ERROR_STOP=1 -f .\migrations\002_documents.sql
    psql -h localhost -p 5432 -U postgres -d trustvault -v ON_ERROR_STOP=1 -f .\migrations\003_document_grants.sql

Then inspect and run the dedicated scripts for migrations 004 and 005:

    node .\scripts\apply-migration-004.mjs
    node .\scripts\apply-migration-005.mjs

Do not reapply migrations blindly to a database that already contains them. Use a dedicated test database for integration testing when possible.

## Build and tests

Compile TypeScript:

    npm run build

Run automated tests:

    npm test

## Start the backend

Development mode:

    npm run dev

Compiled start, after a successful build:

    npm start

## Verification scripts

Inspect the audit table:

    node .\scripts\verify-audit-table.mjs

Inspect the audit chain:

    node .\scripts\inspect-audit-chain.mjs

Verify the document-grant index:

    node .\scripts\verify-grant-index.mjs

Integration tests can create records and append permanent audit events. Review their code before running them.

## Security notes

- Keep environment files and security keys private.
- Protect encrypted document storage and backups.
- Back up the encryption key securely; encrypted documents may be unrecoverable without it.
- An HMAC audit chain helps detect tampering but does not by itself guarantee protection against a database administrator who also obtains the signing key.
- Review deployment configuration and perform security testing before exposing the service publicly.
