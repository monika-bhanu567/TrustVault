import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

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
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function main() {
  try {
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

    const share = await app.inject({
      method: "POST",
      url: `/documents/${documentId}/grants`,
      headers: { cookie: ownerCookie },
      payload: {
        email: recipientEmail,
        canRead: true,
        canEdit: false
      }
    });

    assert(share.statusCode === 201, "Owner can grant read access");
    const grantId = share.json().grant?.id;
    assert(typeof grantId === "string", "Share response contains a grant ID");

    const listedBeforeRevocation = await app.inject({
      method: "GET",
      url: "/documents",
      headers: { cookie: recipientCookie }
    });

    assert(listedBeforeRevocation.statusCode === 200, "Recipient can list accessible documents");
    assert(
      listedBeforeRevocation.body.includes(documentId),
      "Shared document appears in recipient's document list"
    );

    const downloadBefore = await app.inject({
      method: "GET",
      url: `/documents/${documentId}/download`,
      headers: { cookie: recipientCookie }
    });

    assert(downloadBefore.statusCode === 200, "Recipient can download while grant is active");
    assert(downloadBefore.body === content, "Downloaded content matches the original");

    const revoke = await app.inject({
      method: "DELETE",
      url: `/documents/${documentId}/grants/${grantId}`,
      headers: { cookie: ownerCookie }
    });

    assert(revoke.statusCode === 204, "Owner can revoke the grant");

    const downloadAfter = await app.inject({
      method: "GET",
      url: `/documents/${documentId}/download`,
      headers: { cookie: recipientCookie }
    });

    assert(downloadAfter.statusCode === 404, "Revoked recipient is denied subsequent download");

    const listedAfterRevocation = await app.inject({
      method: "GET",
      url: "/documents",
      headers: { cookie: recipientCookie }
    });

    assert(listedAfterRevocation.statusCode === 200, "Recipient document listing remains available");
    assert(
      !listedAfterRevocation.body.includes(documentId),
      "Revoked document no longer appears in recipient's list"
    );

    console.log("\nALL GRANT INTEGRATION CHECKS PASSED.");
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }

    if (documentId) {
      await pool.query("DELETE FROM documents WHERE id = $1", [documentId]).catch(() => {});
    }

    const userIds = [ownerId, recipientId].filter(Boolean);

    if (userIds.length) {
      await pool.query(
        "DELETE FROM sessions WHERE user_id = ANY($1::uuid[])",
        [userIds]
      ).catch(() => {});

      await pool.query(
        "DELETE FROM users WHERE id = ANY($1::uuid[])",
        [userIds]
      ).catch(() => {});
    }

    if (storageKey) {
      await storage.deleteEncryptedFile(storageKey).catch(() => {});
    }

    await pool.end();
  }
}

main().catch((error) => {
  console.error("\nINTEGRATION TEST FAILED:", error);
  process.exitCode = 1;
});
