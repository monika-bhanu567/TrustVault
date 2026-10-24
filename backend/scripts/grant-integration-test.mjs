import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_NAME = "trustvault_test";
const storageDir = await mkdtemp(path.join(tmpdir(), "trustvault-grants-"));
process.env.VAULT_STORAGE_DIR = storageDir;
process.env.VAULT_ENCRYPTION_KEY = "cd".repeat(32);

const { buildApp } = await import("../dist/app.js");
const { PostgresSessionStore } = await import("../dist/db/postgres-session-store.js");
const { AuthService } = await import("../dist/auth/auth-service.js");
const { EncryptedStorage } = await import("../dist/storage/encrypted-storage.js");
const { pool } = await import("../dist/db/pool.js");

const runId = randomUUID();
const ownerEmail = `grant-owner-${runId}@example.com`;
const recipientEmail = `grant-recipient-${runId}@example.com`;
const password = `Test-${randomUUID()}-Secure`;
const content = "TrustVault temporary grant integration test.";
const contentBuffer = Buffer.from(content, "utf8");

const auth = new AuthService();
const storage = new EncryptedStorage();

let app;
let ownerId;
let recipientId;
let documentId;
let storageKey;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAILED: ${message}`);
  }

  console.log(`PASS: ${message}`);
}

async function main() {
  try {
    const dbCheck = await pool.query("SELECT current_database() AS name");
    if (dbCheck.rows[0].name !== "trustvault_test") {
      throw new Error("Safety check failed: refusing to run against a non-test database.");
    }
    console.log("Database:", dbCheck.rows[0].name);

    const owner = await auth.register(ownerEmail, password);
    ownerId = owner.id;

    const recipient = await auth.register(recipientEmail, password);
    recipientId = recipient.id;

    console.log("Created temporary test accounts.");

    const encrypted = await storage.encrypt(
      Readable.from([contentBuffer])
    );

    storageKey = encrypted.storageKey;

    const inserted = await pool.query(
      `INSERT INTO documents
        (owner_id, storage_key, original_name, mime_type, size_bytes,
         encryption_iv, encryption_tag, content_sha256, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
       RETURNING id`,
      [
        ownerId,
        encrypted.storageKey,
        "grant-integration-test.txt",
        "text/plain",
        encrypted.sizeBytes,
        encrypted.iv,
        encrypted.tag,
        encrypted.sha256
      ]
    );

    documentId = inserted.rows[0].id;

    app = buildApp(new PostgresSessionStore());
    await app.ready();

    const ownerSession = await auth.login(ownerEmail, password);
    const recipientSession = await auth.login(recipientEmail, password);

    const ownerCookie = `trustvault_session=${ownerSession.token}`;
    const recipientCookie = `trustvault_session=${recipientSession.token}`;

    async function shareDocument(canEdit = false) {
      return app.inject({
        method: "POST",
        url: `/documents/${documentId}/grants`,
        headers: { cookie: ownerCookie },
        payload: {
          email: recipientEmail,
          canRead: true,
          canEdit
        }
      });
    }

    async function downloadDocument() {
      return app.inject({
        method: "GET",
        url: `/documents/${documentId}/download`,
        headers: { cookie: recipientCookie }
      });
    }

    async function listDocuments() {
      return app.inject({
        method: "GET",
        url: "/documents",
        headers: { cookie: recipientCookie }
      });
    }

    async function revokeGrant(grantId) {
      return app.inject({
        method: "DELETE",
        url: `/documents/${documentId}/grants/${grantId}`,
        headers: { cookie: ownerCookie }
      });
    }

    async function getOwnerGrants() {
      return app.inject({
        method: "GET",
        url: `/documents/${documentId}/grants`,
        headers: { cookie: ownerCookie }
      });
    }

    // 1. Initial share and download.
    const firstShare = await shareDocument(false);

    assert(firstShare.statusCode === 201, "Owner can grant read access");

    const originalGrantId = firstShare.json().grant?.id;

    assert(
      typeof originalGrantId === "string",
      "Initial share response contains a grant ID"
    );

    const initialListing = await listDocuments();

    assert(
      initialListing.statusCode === 200,
      "Recipient can list accessible documents"
    );

    assert(
      initialListing.body.includes(documentId),
      "Shared document appears in recipient's document list"
    );

    const initialDownload = await downloadDocument();

    assert(
      initialDownload.statusCode === 200,
      "Recipient can download while grant is active"
    );

    assert(
      initialDownload.body === content,
      "Downloaded content matches the original"
    );

    // 2. Re-share while the original grant is still active.
    const reshared = await shareDocument(true);

    assert(
      reshared.statusCode === 201,
      "Owner can update an existing active grant"
    );

    const updatedGrantId = reshared.json().grant?.id;

    assert(
      updatedGrantId === originalGrantId,
      "Re-sharing an active grant preserves its ID"
    );

    const grantsAfterUpdate = await getOwnerGrants();

    assert(
      grantsAfterUpdate.statusCode === 200,
      "Owner can inspect document grants"
    );

    const activeRecipientGrants = (
      grantsAfterUpdate.json().grants ?? []
    ).filter(
      (grant) =>
        grant.userId === recipientId &&
        grant.active === true
    );

    assert(
      activeRecipientGrants.length === 1,
      "Only one active grant exists for the recipient"
    );

    assert(
      activeRecipientGrants[0].canEdit === true,
      "Re-sharing updates the grant permissions"
    );

    assert(
      (await downloadDocument()).statusCode === 200,
      "Recipient retains download access after re-sharing"
    );

    // 3. Revoke the updated grant.
    const firstRevoke = await revokeGrant(originalGrantId);

    assert(
      firstRevoke.statusCode === 204,
      "Owner can revoke the active grant"
    );

    assert(
      (await downloadDocument()).statusCode === 404,
      "Revocation blocks the recipient's subsequent download"
    );

    const listingAfterRevocation = await listDocuments();

    assert(
      listingAfterRevocation.statusCode === 200,
      "Recipient can still access the document listing endpoint"
    );

    assert(
      !listingAfterRevocation.body.includes(documentId),
      "Revoked document disappears from the recipient's list"
    );

    // 4. Share again after revocation.
    const secondShare = await shareDocument(false);

    assert(
      secondShare.statusCode === 201,
      "Owner can share the document again after revocation"
    );

    const newGrantId = secondShare.json().grant?.id;

    assert(
      typeof newGrantId === "string" &&
        newGrantId !== originalGrantId,
      "Re-sharing after revocation creates a new grant ID"
    );

    const downloadAfterReshare = await downloadDocument();

    assert(
      downloadAfterReshare.statusCode === 200,
      "Recipient regains download access after a new grant"
    );

    const grantsAfterReshare = await getOwnerGrants();

    assert(
      grantsAfterReshare.statusCode === 200,
      "Owner can inspect grant history"
    );

    const recipientGrantHistory = (
      grantsAfterReshare.json().grants ?? []
    ).filter((grant) => grant.userId === recipientId);

    assert(
      recipientGrantHistory.some(
        (grant) =>
          grant.id === originalGrantId &&
          grant.active === false
      ),
      "Grant history retains the revoked grant"
    );

    assert(
      recipientGrantHistory.some(
        (grant) =>
          grant.id === newGrantId &&
          grant.active === true
      ),
      "Grant history records the new active grant"
    );

    // 5. Revoke the new grant and confirm access is denied again.
    const secondRevoke = await revokeGrant(newGrantId);

    assert(
      secondRevoke.statusCode === 204,
      "Owner can revoke the newly created grant"
    );

    assert(
      (await downloadDocument()).statusCode === 404,
      "Revoking the new grant blocks subsequent downloads"
    );

    const finalListing = await listDocuments();

    assert(
      finalListing.statusCode === 200,
      "Recipient listing remains available after final revocation"
    );

    assert(
      !finalListing.body.includes(documentId),
      "Document remains absent after final revocation"
    );

    console.log("\nALL GRANT INTEGRATION CHECKS PASSED.");
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }

    if (documentId) {
      await pool.query(
        "DELETE FROM documents WHERE id = $1",
        [documentId]
      ).catch(() => {});
    }

    const userIds = [ownerId, recipientId].filter(Boolean);

    if (userIds.length) {
      await pool.query(
        "UPDATE sessions SET revoked_at = NOW() WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL",
        [userIds]
      ).catch((error) => console.error("Warning: session cleanup failed:", error.message));

      await pool.query(
        "UPDATE users SET is_active = FALSE WHERE id = ANY($1::uuid[])",
        [userIds]
      ).catch((error) => console.error("Warning: test account deactivation failed:", error.message));
    }

    if (storageKey) {
      await storage.deleteEncryptedFile(storageKey).catch(() => {});
    }

    await pool.end();
    await rm(storageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("\nINTEGRATION TEST FAILED:", error);
  process.exitCode = 1;
});
