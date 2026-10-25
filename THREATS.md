# TrustVault threat model

## Security boundary

The API, not the React interface, makes every content-access decision. A document is stored only as AES-256-GCM ciphertext and is decrypted only after the current session, user state, ownership/grant, expiry, and revocation state have been evaluated by `AuthorizationDecisionEngine`.

| Threat | Control | Verification |
| --- | --- | --- |
| Guessing a document ID | UUIDs are validated and every download/replacement reloads the document and evaluates the server-side policy. The response is a non-enumerating 404 when access is denied. | `authorization.test.ts`; live denied-download/replacement checks. |
| Hiding a button but leaving an API route open | UI visibility is not trusted. Download and replacement independently invoke the centralized authorization engine. | Read-only, ungranted, expired, and revoked `EDIT` tests. |
| A revoked link/session continues working | No bearer document links exist. Every request reads the current grant state; `revoked_at` immediately makes the grant inactive. | Live revoke then replacement returned 403. |
| Expired access remains usable | The engine rejects expiry at decision time rather than relying on scheduled cleanup. | `authorization-expiry.test.ts`. |
| Ciphertext modification or metadata/file swapping | AES-GCM authentication and a SHA-256 plaintext hash are checked before a download stream is released. Storage keys are random UUIDs. | `encrypted-storage.test.ts`. |
| Uploading executable/polyglot content | MIME allowlist, PDF/PNG/JPEG signatures, NUL-byte rejection for text, and a 10 MiB stream limit run server-side. | Upload route validation and storage tests. |
| Audit evidence is altered quietly | Events are append-only at PostgreSQL level and form a serialized HMAC chain. Verification recalculates the entire chain. | `audit-service.test.ts`; `/audit/verify`. |
| A download occurs without evidence | A `DOCUMENT_DOWNLOADED` audit event is committed before decryption; an audit write failure prevents release. Denied read/edit attempts are also recorded without filenames or contents. | Live replacement/download/revoke test and audit verification. |
| File replacement destroys the only readable version on a failure | A replacement writes new ciphertext under a new UUID, commits database metadata and audit atomically, then attempts old-ciphertext cleanup. A cleanup failure can leave an orphan but cannot lose the committed document. | Replacement route design and live test. |
| Administrator automatically reads every document | `ADMIN` is deliberately not a content superuser. Admin content access still requires an explicit active grant. | `authorization.test.ts`. |

## Known limitations accepted for this iteration

- Audit-chain integrity depends on protecting `AUDIT_HMAC_KEY`; a database administrator who also obtains that key can forge a chain. Production deployment should keep the key in a dedicated secret manager or external signing service.
- Failed unauthenticated attempts are audited best-effort: failure to write that event never changes the denial decision. Successful downloads fail closed if their audit event cannot be written.
- There is no user-facing document deletion or version-recovery feature yet. This avoids pretending that secure deletion and recovery semantics are solved, but it also means test and obsolete documents require an operational retention process.
- Administrators require an operational provisioning step; self-registration intentionally creates only `OWNER` accounts, so production deployment must seed or promote the controlled administrator and viewer accounts.
