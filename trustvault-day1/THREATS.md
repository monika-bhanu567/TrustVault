# TrustVault Threat Model

**Status:** Initial draft — Day 1  
**Scope:** Document access, grants, session validity, audit integrity, uploads, and administrative forensics.

This file is a living security document. Threats are not considered mitigated merely because a design mentions a control; mitigations must be implemented and tested.

## Assets to protect

- Document contents and document metadata.
- User credentials and active sessions.
- Ownership records and document grants.
- Audit events and integrity checkpoints.
- Encryption keys and private storage blobs.
- Internal authorization explanations and incident evidence.

## Trust boundaries

1. **Client → API:** all client input and client-reported identity are untrusted.
2. **API → database:** queries must enforce the authenticated principal and intended transaction scope.
3. **Authorization engine → storage:** storage access must require an authorization result that cannot be forged by a route handler.
4. **Application → private blob storage:** blobs must not be directly public or downloadable through public URLs.
5. **Audit ledger → forensic console:** internal traces are for authorized forensic users, not for unauthorized requesters.
6. **AI advisor → grant system:** AI suggestions are untrusted recommendations; only an authorized human owner can approve a grant.

## Initial threat register

| ID | Threat | Intended control | Evidence required |
|---|---|---|---|
| TV-01 | Insecure direct object reference (IDOR) exposes another user's document | Centralized authorization for each document operation | Cross-user API integration tests |
| TV-02 | Different errors reveal whether a document exists | Opaque external denial response and consistent error handling | Tests comparing unauthorized requests for existing and nonexistent IDs |
| TV-03 | Revoked or expired grant remains usable | Check current grant state on each protected request | Revocation and expiry tests |
| TV-04 | Viewer grants access to another user | Only owners may create/revoke grants for their own documents | Privilege-escalation tests |
| TV-05 | Administrator downloads confidential contents without a grant | Separate forensic/admin permissions from document-content permissions | Admin-isolation tests |
| TV-06 | Audit history is edited or deleted | Append-only database controls plus HMAC verification and external checkpoints | Tamper-detection tests |
| TV-07 | Malicious or disguised file is uploaded | Size/type allowlist and content/magic-byte validation | Upload-validation tests |
| TV-08 | Search leaks unauthorized document metadata or counts | Search only within the caller's authorized document set | Search side-channel tests |
| TV-09 | Session remains valid after account deactivation or epoch change | Validate active state and session epoch on protected requests | Session invalidation tests |
| TV-10 | AI-generated suggestion causes unauthorized sharing | AI is advisory; owner approval is required and audited | Prompt-injection and grant-write boundary tests |

## Accepted limitations to document and test

- A person who is legitimately allowed to view a document may still capture it with an external camera or otherwise copy information they can see.
- Revocation can block subsequent authorized requests, but it cannot retract bytes already delivered to a client.
- A complete compromise of the host, application secrets, or database superuser is outside the protection offered by application-level controls alone; external checkpoints can help reveal some audit-history rewriting.

## Verification policy

For every mitigation, record the implementation location and test that exercises it. If a test has not been run, label the control **planned** or **unverified**, not secure or complete.
