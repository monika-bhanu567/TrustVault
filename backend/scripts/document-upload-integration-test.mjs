import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

function multipartPayload(cookie, filename, contentType, bytes) {
  const boundary = "----TrustVaultBoundary" + Date.now().toString(16);

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
    "utf8"
  );

  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  return {
    headers: {
      cookie,
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    payload: Buffer.concat([header, bytes, footer])
  };
}

async function main() {
  let app;
  let pool;
  let userId;
  let storageDir;
  let cookie;
  const documentIds = [];
  let passed = 0;

  if (process.env.DATABASE_URL) {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("Set TEST_DATABASE_URL to an isolated trustvault_test database before running this integration test.");
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else {
    process.env.DB_NAME = "trustvault_test";
  }
  storageDir = await mkdtemp(path.join(tmpdir(), "trustvault-integration-"));
  process.env.VAULT_STORAGE_DIR = storageDir;
  process.env.VAULT_ENCRYPTION_KEY = "ab".repeat(32);

  function check(name, condition) {
    assert.ok(condition, name);
    passed++;
    console.log(`PASS ${passed}: ${name}`);
  }

  try {
    const { buildApp } = await import("../dist/app.js");
    const { PostgresSessionStore } = await import("../dist/db/postgres-session-store.js");
    const poolModule = await import("../dist/db/pool.js");
    pool = poolModule.pool;

    const dbResult = await pool.query("SELECT current_database() AS name");
    check("Connected to trustvault_test only", dbResult.rows[0].name === "trustvault_test");

    check(
      "Audit HMAC key is configured",
      typeof process.env.AUDIT_HMAC_KEY === "string" &&
        process.env.AUDIT_HMAC_KEY.length >= 32
    );

    app = await buildApp(new PostgresSessionStore());
    await app.ready();

    const unauthenticatedList = await app.inject({
      method: "GET",
      url: "/documents"
    });
    check("Unauthenticated document listing returns 401", unauthenticatedList.statusCode === 401);

    const unauthenticatedUpload = await app.inject({
      method: "POST",
      url: "/documents"
    });
    check("Unauthenticated upload returns 401", unauthenticatedUpload.statusCode === 401);

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `document-test-${suffix}@example.com`;
    const password = "TrustVault-Test-Password-2026!";

    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password }
    });

    check("Test account registration succeeds", registration.statusCode === 201 || registration.statusCode === 200);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password }
    });

    check("Login succeeds", login.statusCode === 200);

    const setCookie = login.headers["set-cookie"];
    assert.ok(setCookie, "Login response should set a session cookie");
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    assert.equal(userResult.rowCount, 1);
    userId = userResult.rows[0].id;

    check("Login sets a session cookie", Boolean(cookie));

    const authenticatedList = await app.inject({
      method: "GET",
      url: "/documents",
      headers: { cookie }
    });

    check(
      "Authenticated document listing succeeds",
      authenticatedList.statusCode === 200
    );

    const content = Buffer.from("TrustVault integration test document.\n", "utf8");
    const uploadPayload = multipartPayload(
      cookie,
      "integration-test.txt",
      "text/plain",
      content
    );

    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      ...uploadPayload
    });

    check(
      "Valid text document upload succeeds",
      upload.statusCode === 201 || upload.statusCode === 200
    );

    const uploadBody = upload.json();
    const documentId =
      uploadBody.id ??
      uploadBody.document?.id ??
      uploadBody.documentId;

    assert.ok(documentId, `Upload response should contain a document ID: ${upload.body}`);
    documentIds.push(documentId);

    const download = await app.inject({
      method: "GET",
      url: `/documents/${documentId}/download`,
      headers: { cookie }
    });

    check("Uploaded document downloads successfully", download.statusCode === 200);
    check(
      "Downloaded content matches original plaintext",
      Buffer.from(download.rawPayload).equals(content)
    );

    const invalidPdfPayload = multipartPayload(
      cookie,
      "invalid.pdf",
      "application/pdf",
      Buffer.from("This is not a PDF", "utf8")
    );

    const invalidPdf = await app.inject({
      method: "POST",
      url: "/documents",
      ...invalidPdfPayload
    });

    check("Invalid PDF signature is rejected", invalidPdf.statusCode === 400);

    const nulTextPayload = multipartPayload(
      cookie,
      "invalid.txt",
      "text/plain",
      Buffer.from([0x41, 0x00, 0x42])
    );

    const nulText = await app.inject({
      method: "POST",
      url: "/documents",
      ...nulTextPayload
    });

    check("Text upload containing a NUL byte is rejected", nulText.statusCode === 400);

    const unsupportedPayload = multipartPayload(
      cookie,
      "invalid.exe",
      "application/octet-stream",
      Buffer.from("not allowed", "utf8")
    );

    const unsupported = await app.inject({
      method: "POST",
      url: "/documents",
      ...unsupportedPayload
    });

    check("Unsupported MIME type is rejected", unsupported.statusCode === 400);

    console.log(`\nIntegration tests passed: ${passed}`);
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (error) {
        console.error("Warning: app cleanup failed:", error.message);
      }
    }

    if (pool) {
      if (userId) {
        try {
          await pool.query("DELETE FROM documents WHERE owner_id = $1", [userId]);
        } catch (error) {
          console.error("Warning: test document cleanup failed:", error.message);
        }

        try {
          await pool.query(
            "UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
            [userId]
          );
        } catch (error) {
          console.error("Warning: session cleanup failed:", error.message);
        }

        try {
          await pool.query(
            "UPDATE users SET is_active = FALSE WHERE id = $1",
            [userId]
          );
        } catch (error) {
          console.error("Warning: test account deactivation failed:", error.message);
        }
      }

      try {
        await pool.end();
      } catch (error) {
        console.error("Warning: database pool cleanup failed:", error.message);
      }
    }

    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("\nIntegration test failed:", error);
  process.exitCode = 1;
});

