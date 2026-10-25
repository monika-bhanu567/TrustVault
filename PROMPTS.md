# AI work log

This log was started on 25 October 2026 while completing the security review. Earlier commits predate this log, so they are not represented as invented historical prompts.

## 2026-10-25 — replacement access control

- **Prompt/request:** Inspect the existing grant selector and backend routes, then implement real write access without treating PDFs or images as browser-editable text.
- **Produced:** A proposal to use a new file-replacement endpoint guarded by `EDIT`.
- **What was wrong:** A first cleanup implementation tied cleanup to transaction state, which could miss cleanup after an explicit rollback.
- **What changed:** Added an explicit `replacementCommitted` flag so uncommitted new ciphertext is removed independently of rollback state. Fixed in [17f787a](../commit/17f787a).

## 2026-10-25 — grant expiry and revocation

- **Prompt/request:** Verify that write grants cannot survive expiry or revocation.
- **Produced:** Existing centralized authorization logic already checked both.
- **What was wrong:** Existing tests concentrated on `READ`, so removing the edit branch could have gone undetected.
- **What changed:** Added edit-specific active, read-only, expired, and revoked assertions in [17f787a](../commit/17f787a).

## 2026-10-25 — audit evidence for access

- **Prompt/request:** Compare the implementation with the challenge requirement to prove who reached a document, including refused attempts.
- **Produced:** Identified upload/grant/replacement audit events but no download event and only logs for denied requests.
- **What was wrong:** The earlier implementation could release a downloaded plaintext without an audit record.
- **What changed:** Added `DOCUMENT_DOWNLOADED` before decryption and `DOCUMENT_ACCESS_DENIED` for download/replacement denials in the current working change.

## 2026-10-25 — integration verification

- **Prompt/request:** Exercise owner, reader, editor, revoke, download, and audit behavior through the running local service.
- **Produced:** The PowerShell multipart client initially supplied a generic MIME type.
- **What was wrong:** The server correctly rejected that request as an unsupported upload, so it did not model a browser text upload.
- **What changed:** Retried with an explicit `text/plain` multipart part. Reader replacement returned 403, editor replacement succeeded, post-revoke replacement returned 403, downloaded content matched, and audit verification passed.

## 2026-10-25 — threat review

- **Prompt/request:** Assess the project against the Snovasys challenge and document credible attack paths rather than claiming completeness.
- **Produced:** A broad requirements review.
- **What was wrong:** It initially focused on CRUD/UI gaps rather than the non-negotiable audit evidence gap.
- **What changed:** Prioritized download and denied-access audit events and recorded accepted limitations in `THREATS.md`.
