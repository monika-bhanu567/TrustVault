# TrustVault API access model

All protected endpoints require the `trustvault_session` HTTP-only session cookie. The API decides access; frontend visibility is never an authorization mechanism.

| Endpoint | Who may call it | Notes |
| --- | --- | --- |
| `POST /auth/register`, `POST /auth/login` | Public | Registration creates an `OWNER`; deployment must provision `ADMIN` and `VIEWER` accounts separately. |
| `POST /documents` | Authenticated active user | Uploads a validated and encrypted document owned by the caller. |
| `GET /documents` | Owner or current read/edit grantee | Lists documents currently accessible to the caller. |
| `GET /documents/:id/download` | Owner or active read grantee | Re-evaluates policy, writes audit evidence, validates ciphertext integrity, then streams a temporary plaintext file. |
| `POST /documents/:id/content` | Owner or active edit grantee | Validates and replaces contents using new ciphertext; read-only, expired, and revoked grants are denied. |
| `DELETE /documents/:id` | Active owner only | Soft-deletes the database record, writes `DOCUMENT_DELETED`, then removes ciphertext after the transaction commits. |
| `POST /documents/:id/grants` | Active owner only | Creates/updates a named recipient's read/edit grant. |
| `GET /documents/:id/grants` | Active owner only | Shows access history for the caller's document. |
| `DELETE /documents/:id/grants/:grantId` | Active owner only | Immediately revokes the named grant. |
| `GET /shared-with-me` | Authenticated recipient | Lists only current, active grants. |
| `GET /audit` | Authenticated user | Administrators see the global trail. Others see only their own activity and events belonging to documents they own. |
| `GET /audit/verify` | Authenticated user | Returns integrity status only; it does not reveal hidden event contents. |
