# Five-minute demo script

## 0:00–0:30 — Product and landing page

Open the public TrustVault landing page. State that the product is a zero-trust document vault: the API decides access, not the UI.

## 0:30–1:15 — Authentication and roles

Sign in as the Owner demo account. Point out that Owners manage their own documents; Viewers require named grants; Administrators inspect security activity but do not gain automatic content access.

## 1:15–2:00 — Upload and encryption

Upload a small supported text or PDF document. Show it in My Documents. Explain that the backend validates the upload, encrypts it using AES-256-GCM, stores integrity metadata, and writes an audit event.

## 2:00–3:00 — Read/write sharing and server enforcement

Share the document with the Viewer using Read only. Sign in as the Viewer and download it. Attempt replacement and show that the backend denies it. Return to the Owner, update the grant to Write access, then show that replacement succeeds.

## 3:00–3:40 — Immediate revocation

Revoke the active grant as the Owner. Refresh the Viewer session and show that the document disappears from Shared with me and direct download/replacement access is denied.

## 3:40–4:30 — Audit evidence

Open Audit Trail. Show upload, grant, download, edit/replacement, revoke, and denied-access events. Run audit integrity verification and show the successful HMAC-chain result.

## 4:30–5:00 — Admin dashboard and limits

Sign in as Admin and show global security metrics and recent activity. Briefly show `THREATS.md`, then state the two honest deployment limits: encrypted Supabase object migration requires backend-only Storage credentials, and the known legacy missing ciphertext is quarantined/reported rather than recreated.
