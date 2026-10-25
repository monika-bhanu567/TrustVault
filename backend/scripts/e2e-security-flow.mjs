import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

if (process.env.E2E_TEST_ALLOWED !== "true") {
  throw new Error("Refusing to create test data. Set E2E_TEST_ALLOWED=true to run this guarded flow.");
}

function multipartPayload(cookie, filename, bytes) {
  const boundary = `----TrustVaultE2E${randomUUID().replaceAll("-", "")}`;
  return {
    headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  };
}

function cookieFrom(response) {
  const setCookie = response.headers["set-cookie"];
  assert.ok(setCookie, "Login must return a session cookie");
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
}

const suffix = randomUUID();
const password = `Tv-${randomUUID()}-Security-2026!`;
const emails = {
  owner: `e2e-owner-${suffix}@example.invalid`,
  viewer: `e2e-viewer-${suffix}@example.invalid`,
  outsider: `e2e-outsider-${suffix}@example.invalid`,
  admin: `e2e-admin-${suffix}@example.invalid`
};
const userIds = [];
let app;
let pool;
let documentId;
let ownerCookie;
let checks = 0;

function check(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`PASS ${checks}: ${label}`);
}

async function login(email) {
  const response = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  check("Temporary account login succeeds", response.statusCode === 200);
  return cookieFrom(response);
}

async function main() {
  const appModule = await import("../dist/app.js");
  const sessionModule = await import("../dist/db/postgres-session-store.js");
  const poolModule = await import("../dist/db/pool.js");
  pool = poolModule.pool;
  app = appModule.buildApp(new sessionModule.PostgresSessionStore());
  await app.ready();
  const database = await pool.query("SELECT current_database() AS name");
  check("Database connection is available", Boolean(database.rows[0]?.name));

  for (const email of Object.values(emails)) {
    const response = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password } });
    check("Temporary account registration succeeds", response.statusCode === 201);
    userIds.push(response.json().user.id);
  }
  await pool.query(
    `UPDATE users SET role = CASE email WHEN $1 THEN 'VIEWER' WHEN $2 THEN 'VIEWER' WHEN $3 THEN 'ADMIN' ELSE role END
     WHERE email = ANY($4::text[])`,
    [emails.viewer, emails.outsider, emails.admin, Object.values(emails)]
  );

  ownerCookie = await login(emails.owner);
  const viewerCookie = await login(emails.viewer);
  const outsiderCookie = await login(emails.outsider);
  const adminCookie = await login(emails.admin);
  const original = Buffer.from("TrustVault end-to-end protected content.\n");
  const upload = await app.inject({ method: "POST", url: "/documents", ...multipartPayload(ownerCookie, "e2e-protected.txt", original) });
  check("Owner can upload a validated text document", upload.statusCode === 201);
  documentId = upload.json().document?.id;
  check("Upload returns a document ID", typeof documentId === "string");

  const unauthenticated = await app.inject({ method: "GET", url: `/documents/${documentId}/download` });
  check("Unauthenticated direct download is denied", unauthenticated.statusCode === 401);
  const outsider = await app.inject({ method: "GET", url: `/documents/${documentId}/download`, headers: { cookie: outsiderCookie } });
  check("Unrelated user direct download is denied", outsider.statusCode === 404);

  const readGrant = await app.inject({
    method: "POST", url: `/documents/${documentId}/grants`, headers: { cookie: ownerCookie },
    payload: { email: emails.viewer, canRead: true, canEdit: false }
  });
  check("Owner can create a read-only grant", readGrant.statusCode === 201);
  const grantId = readGrant.json().grant?.id;
  check("Grant response includes an ID", typeof grantId === "string");
  const readable = await app.inject({ method: "GET", url: `/documents/${documentId}/download`, headers: { cookie: viewerCookie } });
  check("Read-only recipient can download", readable.statusCode === 200);
  check("Downloaded plaintext matches the upload", Buffer.from(readable.rawPayload).equals(original));

  const replacement = Buffer.from("TrustVault replacement content.\n");
  const deniedReplacement = await app.inject({ method: "POST", url: `/documents/${documentId}/content`, ...multipartPayload(viewerCookie, "e2e-replacement.txt", replacement) });
  check("Read-only recipient cannot replace content", deniedReplacement.statusCode === 403);
  const writeGrant = await app.inject({
    method: "POST", url: `/documents/${documentId}/grants`, headers: { cookie: ownerCookie },
    payload: { email: emails.viewer, canRead: true, canEdit: true }
  });
  check("Owner can upgrade a grant to write access", writeGrant.statusCode === 201);
  const acceptedReplacement = await app.inject({ method: "POST", url: `/documents/${documentId}/content`, ...multipartPayload(viewerCookie, "e2e-replacement.txt", replacement) });
  check("Write-enabled recipient can replace content", acceptedReplacement.statusCode === 200);
  const ownerDownload = await app.inject({ method: "GET", url: `/documents/${documentId}/download`, headers: { cookie: ownerCookie } });
  check("Owner can download after replacement", ownerDownload.statusCode === 200);
  check("Replacement plaintext integrity is preserved", Buffer.from(ownerDownload.rawPayload).equals(replacement));

  // The schema correctly requires expiry to be after grant creation. Backdate
  // this disposable test grant before marking it expired.
  await pool.query(
    "UPDATE document_grants SET created_at = NOW() - INTERVAL '2 minutes', expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
    [grantId]
  );
  const expired = await app.inject({ method: "GET", url: `/documents/${documentId}/download`, headers: { cookie: viewerCookie } });
  check("Expired grant blocks downloads", expired.statusCode === 404);
  const renewedGrant = await app.inject({
    method: "POST", url: `/documents/${documentId}/grants`, headers: { cookie: ownerCookie },
    payload: { email: emails.viewer, canRead: true, canEdit: true }
  });
  check("Owner can renew an expired grant", renewedGrant.statusCode === 201);
  const revoke = await app.inject({ method: "DELETE", url: `/documents/${documentId}/grants/${grantId}`, headers: { cookie: ownerCookie } });
  check("Owner can revoke the active grant", revoke.statusCode === 204);
  const revokedDownload = await app.inject({ method: "GET", url: `/documents/${documentId}/download`, headers: { cookie: viewerCookie } });
  check("Revocation immediately blocks direct downloads", revokedDownload.statusCode === 404);
  const revokedReplacement = await app.inject({ method: "POST", url: `/documents/${documentId}/content`, ...multipartPayload(viewerCookie, "e2e-revoked.txt", replacement) });
  check("Revocation immediately blocks replacements", revokedReplacement.statusCode === 403);

  const viewerAdmin = await app.inject({ method: "GET", url: "/admin/overview", headers: { cookie: viewerCookie } });
  check("Viewer cannot access the administrator dashboard", viewerAdmin.statusCode === 403);
  const adminOverview = await app.inject({ method: "GET", url: "/admin/overview", headers: { cookie: adminCookie } });
  check("Administrator can access the administrator dashboard", adminOverview.statusCode === 200);
  const audit = await app.inject({ method: "GET", url: "/audit/verify", headers: { cookie: ownerCookie } });
  check("Audit verification endpoint succeeds", audit.statusCode === 200);
  check("Audit HMAC chain remains valid", audit.json().valid === true);
  console.log(`\nEND-TO-END SECURITY FLOW PASSED (${checks} checks).`);
}

try {
  await main();
} finally {
  if (app && documentId && ownerCookie) await app.inject({ method: "DELETE", url: `/documents/${documentId}`, headers: { cookie: ownerCookie } }).catch(() => {});
  if (pool && userIds.length) {
    await pool.query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = ANY($1::uuid[])", [userIds]).catch(() => {});
    await pool.query("UPDATE users SET is_active = FALSE WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
  }
  await app?.close().catch(() => {});
  await pool?.end().catch(() => {});
}
