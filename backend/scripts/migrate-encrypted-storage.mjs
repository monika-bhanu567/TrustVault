import "dotenv/config";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pool } from "../dist/db/pool.js";
import { EncryptedStorage } from "../dist/storage/encrypted-storage.js";
import { appendAuditEventWithClient } from "../dist/audit/postgres-audit-service.js";

const quarantineMissing = process.argv.includes("--quarantine-missing");
const root = path.resolve(process.env.VAULT_STORAGE_DIR ?? path.join(process.cwd(), "storage"));
const storage = new EncryptedStorage();

try {
  const result = await pool.query(`SELECT id, storage_key, encryption_iv, encryption_tag, content_sha256 FROM documents WHERE status = 'ACTIVE' ORDER BY created_at`);
  let migrated = 0;
  const missing = [];
  const failedIntegrity = [];
  const failedStorage = [];
  for (const document of result.rows) {
    const file = path.join(root, `${document.storage_key}.enc`);
    try { await access(file, constants.R_OK); }
    catch { missing.push(document.id); continue; }
    try {
      await storage.migrateLocalCiphertext(document.storage_key, document.encryption_iv, document.encryption_tag, document.content_sha256);
      migrated += 1;
    } catch (error) {
      const entry = { id: document.id, reason: error instanceof Error ? error.message : "MIGRATION_FAILURE" };
      if (entry.reason === "CONTENT_INTEGRITY_FAILURE") failedIntegrity.push(entry);
      else failedStorage.push(entry);
    }
  }
  if (quarantineMissing && missing.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const id of missing) {
        await client.query("UPDATE documents SET status = 'QUARANTINED', updated_at = NOW() WHERE id = $1 AND status = 'ACTIVE'", [id]);
        await appendAuditEventWithClient(client, { eventType: "DOCUMENT_STORAGE_UNAVAILABLE", entityType: "document", entityId: id, metadata: { reason: "MISSING_LEGACY_CIPHERTEXT" } });
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  console.log(JSON.stringify({
    migrated,
    missingCiphertextRecords: missing.length,
    integrityFailures: failedIntegrity,
    storageFailures: failedStorage,
    quarantined: quarantineMissing ? missing.length : 0
  }));
  if (missing.length || failedIntegrity.length || failedStorage.length) process.exitCode = 2;
} finally { await pool.end(); }
