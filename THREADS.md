# Engineering status

This document records current technical decisions and operational follow-up items. It is not a development transcript and does not duplicate the README.

## Current decisions

### Authorization

TrustVault uses per-document ownership and named grants. The backend evaluates authorization on every protected request. Read grants permit downloads; edit grants permit replacement. Expired and revoked grants are denied without relying on frontend state.

### Document replacement

The supported content-update workflow is validated replacement. New content is encrypted under a new storage key before document metadata is committed. Previous ciphertext cleanup occurs after the metadata and audit transaction, avoiding loss of the committed document if cleanup fails.

### Audit epochs

The audit ledger is append-only and HMAC-linked. Migration `007_audit_chain_epochs.sql` preserves older records while allowing a separate verifiable epoch when the historical signing key is unavailable. Historical evidence is not rewritten to claim verification that cannot be established.

### Cloud storage

The storage adapter uses local encrypted files during development and private Supabase Storage when backend-only Storage credentials are configured. Production readiness requires the private Storage configuration.

## Operational follow-up

- Configure backend-only Supabase Storage credentials in the deployment environment.
- Migrate available ciphertext from the environment that contains the local encrypted files.
- Review missing-ciphertext reports before explicitly quarantining a document record.
- Deploy backend and frontend, configure the exact `FRONTEND_ORIGIN`, and perform deployed end-to-end checks.
- Record a demonstration only after the deployed workflow and controlled accounts are validated.

## Scope boundaries

- Version recovery is not implemented; replacement is the supported content-update workflow.
- Administrators can view activity but do not automatically receive document-content access.
- The frontend does not receive database, encryption, audit, or Supabase service-role credentials.

See [API.md](API.md) for endpoint behavior and [THREATS.md](THREATS.md) for security risks and controls.
