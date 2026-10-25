
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { pool } from "../db/pool.js";
import { AuthSessionGuard } from "../security/session-guard.js";
import {
  AuthorizationDecisionEngine,
  type UserRole,
  type DocumentGrant
} from "../security/authorization.js";
import { EncryptedStorage } from "../storage/encrypted-storage.js";
import {
  appendAuditEventWithClient,
  PostgresAuditService
} from "../audit/postgres-audit-service.js";

const COOKIE_NAME = "trustvault_session";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain"
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DocumentRow {
  id: string;
  owner_id: string;
  owner_email: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  category: string;
  created_at: Date;
}

interface DownloadRow {
  id: string;
  owner_id: string;
  storage_key: string;
  original_name: string;
  encryption_iv: Buffer;
  encryption_tag: Buffer;
  content_sha256: string;
}

interface EditableDocumentRow extends DownloadRow {
  mime_type: string;
}

interface GrantRow {
  document_id: string;
  user_id: string;
  can_read: boolean;
  can_edit: boolean;
  expires_at: Date | null;
  revoked_at: Date | null;
}

interface UserRoleRow {
  role: string;
  is_active: boolean;
}

const authorization = new AuthorizationDecisionEngine();

function safeFilename(name: string): string {
  return (
    path.basename(name)
      .replace(/[\r\n"\\/]/g, "_")
      .replace(/[^\w. ()-]/g, "_")
      .slice(0, 150) || "document"
  );
}

function hasValidSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "application/pdf") {
    return bytes.subarray(0, 5).toString() === "%PDF-";
  }

  if (mimeType === "image/png") {
    return bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
  }

  if (mimeType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (mimeType === "text/plain") {
    return !bytes.includes(0);
  }

  return false;
}

function validateStream(mimeType: string): Transform {
  let prefix = Buffer.alloc(0);
  let validated = false;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (mimeType === "text/plain" && chunk.includes(0)) {
        callback(new Error("INVALID_FILE_CONTENT"));
        return;
      }

      if (!validated) {
        const needed = 16 - prefix.length;
        prefix = Buffer.concat([
          prefix,
          chunk.subarray(0, Math.max(0, needed))
        ]);

        const minimum =
          mimeType === "application/pdf" ? 5 :
          mimeType === "image/png" ? 8 :
          mimeType === "image/jpeg" ? 3 : 1;

        if (prefix.length >= minimum) {
          if (!hasValidSignature(mimeType, prefix)) {
            callback(new Error("INVALID_FILE_CONTENT"));
            return;
          }

          validated = true;
        }
      }

      callback(null, chunk);
    },

    flush(callback) {
      if (!validated && hasValidSignature(mimeType, prefix)) {
        validated = true;
      }

      if (!validated) {
        callback(new Error("INVALID_FILE_CONTENT"));
        return;
      }

      callback();
    }
  });
}

export async function registerDocumentRoutes(
  app: FastifyInstance,
  guard: AuthSessionGuard,
  storage: EncryptedStorage
): Promise<void> {
  const auditService = new PostgresAuditService();

  async function recordAccessAttempt(
    eventType: "DOCUMENT_DOWNLOADED" | "DOCUMENT_ACCESS_DENIED",
    actorId: string | null,
    documentId: string | null,
    action: "READ" | "EDIT",
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await auditService.append({
      eventType,
      actorId,
      entityType: "document",
      entityId: documentId,
      metadata: { action, ...metadata }
    });
  }

  app.post("/documents", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);

    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    let part;

    try {
      part = await request.file();
    } catch (error) {
      request.log.warn({ err: error }, "Multipart upload rejected");
      return reply.code(400).send({ error: "Invalid upload" });
    }

    if (!part || !ALLOWED_TYPES.has(part.mimetype)) {
      part?.file.destroy();
      return reply.code(400).send({ error: "Unsupported file type" });
    }

    const bridge = new PassThrough();
    const validator = validateStream(part.mimetype);
    const sourcePipeline = pipeline(part.file, validator, bridge);

    let encrypted;

    try {
      const encryptionPromise = storage.encrypt(
        bridge,
        MAX_FILE_BYTES
      );

      [encrypted] = await Promise.all([
        encryptionPromise,
        sourcePipeline
      ]);
    } catch (error) {
      bridge.destroy();
      request.log.warn({ err: error }, "Document upload rejected");

      if (error instanceof Error && error.message === "FILE_TOO_LARGE") {
        return reply.code(413).send({ error: "File too large" });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_FILE_CONTENT"
      ) {
        return reply.code(400).send({
          error: "File content does not match its declared type"
        });
      }

      return reply.code(500).send({ error: "Upload failed" });
    }

    let client: PoolClient | undefined;
    let transactionOpen = false;

    try {
      client = await pool.connect();

      await client.query("BEGIN");
      transactionOpen = true;

      const result = await client.query<DocumentRow>(
        `INSERT INTO documents
          (owner_id, storage_key, original_name, mime_type,
           size_bytes, encryption_iv, encryption_tag, content_sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, original_name, mime_type, size_bytes, created_at`,
        [
          auth.user.id,
          encrypted.storageKey,
          safeFilename(part.filename),
          part.mimetype,
          encrypted.sizeBytes,
          encrypted.iv,
          encrypted.tag,
          encrypted.sha256
        ]
      );

      const document = result.rows[0];

      // Keep the audit event and document record in the same transaction.
      // Do not log filenames, document contents, or encryption secrets.
      await appendAuditEventWithClient(client, {
        eventType: "DOCUMENT_UPLOADED",
        actorId: auth.user.id,
        entityType: "document",
        entityId: document.id,
        metadata: {
          mimeType: document.mime_type,
          sizeBytes: document.size_bytes
        }
      });

      await client.query("COMMIT");
      transactionOpen = false;

      return reply.code(201).send({
        document
      });
    } catch (error) {
      if (client && transactionOpen) {
        await client.query("ROLLBACK").catch(() => {});
      }

      request.log.error(
        { err: error },
        "Document database save or audit failed"
      );

      // The encrypted file was created before the database transaction.
      // Remove it if either the document insert or audit write fails.
      try {
        await storage.deleteEncryptedFile(encrypted.storageKey);
      } catch (cleanupError) {
        request.log.error(
          { err: cleanupError },
          "Encrypted file cleanup failed"
        );
      }

      return reply.code(500).send({ error: "Upload failed" });
    } finally {
      client?.release();
    }
  });

  app.get<{ Querystring: { q?: string; owner?: string; category?: string; from?: string; to?: string } }>("/documents", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);

    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const query = request.query;
    const q = query.q?.trim() ?? "";
    const owner = query.owner?.trim().toLowerCase() ?? "";
    const category = query.category?.trim() ?? "";
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
      return reply.code(400).send({ error: "Invalid date filter" });
    }

    const result = await pool.query<DocumentRow>(
      `SELECT DISTINCT d.id, d.owner_id, u.email AS owner_email, d.original_name, d.mime_type,
              d.size_bytes, d.category, d.created_at
       FROM documents d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN document_grants g
         ON g.document_id = d.id
        AND g.user_id = $1
        AND g.can_read = TRUE
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > NOW())
       WHERE d.status = 'ACTIVE'
         AND (d.owner_id = $1 OR g.id IS NOT NULL)
         AND ($2 = '' OR d.original_name ILIKE '%' || $2 || '%')
         AND ($3 = '' OR u.email ILIKE '%' || $3 || '%')
         AND ($4 = '' OR d.category = $4)
         AND ($5::timestamptz IS NULL OR d.created_at >= $5)
         AND ($6::timestamptz IS NULL OR d.created_at < $6 + INTERVAL '1 day')
       ORDER BY d.created_at DESC`,
      [auth.user.id, q, owner, category, from?.toISOString() ?? null, to?.toISOString() ?? null]
    );

    return {
      documents: result.rows.map(({ owner_id, owner_email, ...document }) => ({
        ...document,
        isOwner: owner_id === auth.user.id,
        ownerEmail: owner_email
      }))
    };
  });

  app.patch<{ Params: { id: string }; Body: { category?: string } }>("/documents/:id/category", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);
    if (!auth.valid) return reply.code(401).send({ error: "Unauthorized" });
    const category = request.body?.category?.trim();
    if (!UUID_PATTERN.test(request.params.id) || !category || category.length > 80) {
      return reply.code(400).send({ error: "Invalid category update" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `UPDATE documents SET category = $1, updated_at = NOW()
         WHERE id = $2 AND owner_id = $3 AND status = 'ACTIVE' RETURNING id`,
        [category, request.params.id, auth.user.id]
      );
      if (!result.rows[0]) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Document not found" }); }
      await appendAuditEventWithClient(client, { eventType: "DOCUMENT_CATEGORY_UPDATED", actorId: auth.user.id, entityType: "document", entityId: request.params.id, metadata: { category } });
      await client.query("COMMIT");
      return { category };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      request.log.error({ err: error }, "Category update failed");
      return reply.code(500).send({ error: "Unable to update category" });
    } finally { client.release(); }
  });

  app.get<{ Params: { id: string } }>(
    "/documents/:id/download",
    async (request, reply) => {
      const auth = await guard.validate(request.cookies[COOKIE_NAME]);

      if (!auth.valid) {
        await recordAccessAttempt("DOCUMENT_ACCESS_DENIED", null, null, "READ", {
          reason: "UNAUTHENTICATED"
        }).catch((error) => request.log.error({ err: error }, "Failed to audit denied access"));
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const documentId = request.params.id;

      if (!UUID_PATTERN.test(documentId)) {
        await recordAccessAttempt("DOCUMENT_ACCESS_DENIED", auth.user.id, null, "READ", {
          reason: "INVALID_DOCUMENT_ID"
        }).catch((error) => request.log.error({ err: error }, "Failed to audit denied access"));
        return reply.code(404).send({ error: "Document not found" });
      }

      const result = await pool.query<DownloadRow>(
        `SELECT id, owner_id, storage_key, original_name,
                encryption_iv, encryption_tag, content_sha256
         FROM documents
         WHERE id = $1 AND status = 'ACTIVE'
         LIMIT 1`,
        [documentId]
      );

      const document = result.rows[0];

      if (!document) {
        await recordAccessAttempt("DOCUMENT_ACCESS_DENIED", auth.user.id, documentId, "READ", {
          reason: "DOCUMENT_NOT_FOUND"
        }).catch((error) => request.log.error({ err: error }, "Failed to audit denied access"));
        return reply.code(404).send({ error: "Document not found" });
      }

      const userResult = await pool.query<UserRoleRow>(
        `SELECT role, is_active
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [auth.user.id]
      );

      const currentUser = userResult.rows[0];

      if (
        !currentUser ||
        !currentUser.is_active ||
        !["ADMIN", "OWNER", "VIEWER"].includes(currentUser.role)
      ) {
        await recordAccessAttempt("DOCUMENT_ACCESS_DENIED", auth.user.id, documentId, "READ", {
          reason: "INACTIVE_OR_INVALID_ROLE"
        }).catch((error) => request.log.error({ err: error }, "Failed to audit denied access"));
        return reply.code(404).send({ error: "Document not found" });
      }

      const grantResult = await pool.query<GrantRow>(
        `SELECT document_id, user_id, can_read, can_edit,
                expires_at, revoked_at
         FROM document_grants
         WHERE document_id = $1 AND user_id = $2
         ORDER BY created_at DESC`,
        [documentId, auth.user.id]
      );

      const grants: DocumentGrant[] = grantResult.rows.map((grant) => ({
        documentId: grant.document_id,
        userId: grant.user_id,
        canRead: grant.can_read,
        canEdit: grant.can_edit,
        isActive: grant.revoked_at === null,
        expiresAt: grant.expires_at,
        revokedAt: grant.revoked_at
      }));

      const decision = authorization.decide({
        principal: {
          id: auth.user.id,
          role: currentUser.role as UserRole,
          isActive: currentUser.is_active
        },
        document: {
          id: document.id,
          ownerId: document.owner_id
        },
        action: "READ",
        grants
      });

      if (!decision.allowed) {
        await recordAccessAttempt("DOCUMENT_ACCESS_DENIED", auth.user.id, documentId, "READ", {
          reason: decision.reason
        }).catch((error) => request.log.error({ err: error }, "Failed to audit denied access"));
        return reply.code(404).send({ error: "Document not found" });
      }

      // Audit before decryption so no plaintext is released without durable evidence.
      try {
        await recordAccessAttempt("DOCUMENT_DOWNLOADED", auth.user.id, documentId, "READ");
      } catch (error) {
        request.log.error({ err: error, documentId }, "Download audit write failed");
        return reply.code(503).send({ error: "Document temporarily unavailable" });
      }

      let temporaryPath: string;

      try {
        temporaryPath = await storage.decryptToTemporaryFile(
          document.storage_key,
          document.encryption_iv,
          document.encryption_tag,
          document.content_sha256
        );
      } catch (error) {
        request.log.error({ err: error }, "Document integrity check failed");
        return reply.code(500).send({ error: "Document unavailable" });
      }

      reply
        .header("Content-Type", "application/octet-stream")
        .header(
          "Content-Disposition",
          `attachment; filename="${safeFilename(document.original_name)}"`
        )
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store, private")
        .header("Pragma", "no-cache");

      const stream = createReadStream(temporaryPath);

      const cleanup = () => {
        void rm(temporaryPath, { force: true }).catch((error) => {
          request.log.error({ err: error }, "Temporary file cleanup failed");
        });
      };

      stream.once("close", cleanup);
      stream.once("error", cleanup);

      return reply.send(stream);
    }
  );

  // Deletion is deliberately owner-only. EDIT grants allow content replacement,
  // not destructive lifecycle changes.
  app.delete<{ Params: { id: string } }>("/documents/:id", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);
    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const documentId = request.params.id;
    if (!UUID_PATTERN.test(documentId)) {
      return reply.code(404).send({ error: "Document not found" });
    }

    let client: PoolClient | undefined;
    let transactionOpen = false;
    let deletedDocument: Pick<DownloadRow, "storage_key"> | undefined;

    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionOpen = true;
      const result = await client.query<Pick<DownloadRow, "storage_key">>(
        `UPDATE documents
         SET status = 'DELETED', updated_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND status = 'ACTIVE'
         RETURNING storage_key`,
        [documentId, auth.user.id]
      );
      deletedDocument = result.rows[0];
      if (!deletedDocument) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return reply.code(404).send({ error: "Document not found" });
      }

      await appendAuditEventWithClient(client, {
        eventType: "DOCUMENT_DELETED",
        actorId: auth.user.id,
        entityType: "document",
        entityId: documentId,
        metadata: {}
      });
      await client.query("COMMIT");
      transactionOpen = false;

      await storage.deleteEncryptedFile(deletedDocument.storage_key).catch((error) => {
        request.log.error({ err: error, documentId }, "Deleted ciphertext cleanup failed");
      });
      return reply.code(204).send();
    } catch (error) {
      if (client && transactionOpen) {
        await client.query("ROLLBACK").catch(() => {});
      }
      request.log.error({ err: error, documentId }, "Document deletion failed");
      return reply.code(500).send({ error: "Unable to delete document" });
    } finally {
      client?.release();
    }
  });

  // Replaces a document with a newly validated and independently encrypted file.
  // This is intentionally a replacement workflow: PDFs and images are not editable
  // in the browser merely because a recipient has EDIT access.
  app.post<{ Params: { id: string } }>(
    "/documents/:id/content",
    async (request, reply) => {
      const auth = await guard.validate(request.cookies[COOKIE_NAME]);

      if (!auth.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const documentId = request.params.id;
      if (!UUID_PATTERN.test(documentId)) {
        return reply.code(404).send({ error: "Document not found" });
      }

      let part;
      try {
        part = await request.file();
      } catch (error) {
        request.log.warn({ err: error }, "Replacement upload rejected");
        return reply.code(400).send({ error: "Invalid upload" });
      }

      if (!part || !ALLOWED_TYPES.has(part.mimetype)) {
        part?.file.destroy();
        return reply.code(400).send({ error: "Unsupported file type" });
      }

      const bridge = new PassThrough();
      const validator = validateStream(part.mimetype);
      const sourcePipeline = pipeline(part.file, validator, bridge);
      let encrypted;

      try {
        [encrypted] = await Promise.all([
          storage.encrypt(bridge, MAX_FILE_BYTES),
          sourcePipeline
        ]);
      } catch (error) {
        bridge.destroy();
        request.log.warn({ err: error }, "Replacement upload rejected");
        if (error instanceof Error && error.message === "FILE_TOO_LARGE") {
          return reply.code(413).send({ error: "File too large" });
        }
        if (error instanceof Error && error.message === "INVALID_FILE_CONTENT") {
          return reply.code(400).send({
            error: "File content does not match its declared type"
          });
        }
        return reply.code(500).send({ error: "Replacement failed" });
      }

      let client: PoolClient | undefined;
      let transactionOpen = false;
      let replacementCommitted = false;

      try {
        client = await pool.connect();
        await client.query("BEGIN");
        transactionOpen = true;

        const documentResult = await client.query<EditableDocumentRow>(
          `SELECT id, owner_id, storage_key, original_name, mime_type,
                  encryption_iv, encryption_tag, content_sha256
           FROM documents
           WHERE id = $1 AND status = 'ACTIVE'
           FOR UPDATE`,
          [documentId]
        );
        const document = documentResult.rows[0];

        if (!document) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return reply.code(404).send({ error: "Document not found" });
        }

        const userResult = await client.query<UserRoleRow>(
          `SELECT role, is_active FROM users WHERE id = $1 LIMIT 1`,
          [auth.user.id]
        );
        const currentUser = userResult.rows[0];
        const grantResult = await client.query<GrantRow>(
          `SELECT document_id, user_id, can_read, can_edit, expires_at, revoked_at
           FROM document_grants
           WHERE document_id = $1 AND user_id = $2
           ORDER BY created_at DESC`,
          [documentId, auth.user.id]
        );
        const grants: DocumentGrant[] = grantResult.rows.map((grant) => ({
          documentId: grant.document_id,
          userId: grant.user_id,
          canRead: grant.can_read,
          canEdit: grant.can_edit,
          isActive: grant.revoked_at === null,
          expiresAt: grant.expires_at,
          revokedAt: grant.revoked_at
        }));
        const decision = currentUser && ["ADMIN", "OWNER", "VIEWER"].includes(currentUser.role)
          ? authorization.decide({
              principal: {
                id: auth.user.id,
                role: currentUser.role as UserRole,
                isActive: currentUser.is_active
              },
              document: { id: document.id, ownerId: document.owner_id },
              action: "EDIT",
              grants
            })
          : { allowed: false };

        if (!decision.allowed) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          request.log.warn({ documentId, userId: auth.user.id }, "Document replacement denied");
          await recordAccessAttempt("DOCUMENT_ACCESS_DENIED", auth.user.id, documentId, "EDIT", {
            reason: "NO_EDIT_PERMISSION"
          }).catch((error) => request.log.error({ err: error }, "Failed to audit denied access"));
          return reply.code(403).send({ error: "You do not have permission to replace this document" });
        }

        await client.query(
          `UPDATE documents
           SET storage_key = $1, original_name = $2, mime_type = $3,
               size_bytes = $4, encryption_iv = $5, encryption_tag = $6,
               content_sha256 = $7, updated_at = NOW()
           WHERE id = $8`,
          [
            encrypted.storageKey, safeFilename(part.filename), part.mimetype,
            encrypted.sizeBytes, encrypted.iv, encrypted.tag, encrypted.sha256,
            documentId
          ]
        );
        await appendAuditEventWithClient(client, {
          eventType: "DOCUMENT_REPLACED",
          actorId: auth.user.id,
          entityType: "document",
          entityId: documentId,
          metadata: { mimeType: part.mimetype, sizeBytes: encrypted.sizeBytes }
        });
        await client.query("COMMIT");
        transactionOpen = false;
        replacementCommitted = true;

        // The database points to the new authenticated ciphertext before the
        // previous ciphertext is removed, so a failed cleanup cannot lose data.
        await storage.deleteEncryptedFile(document.storage_key).catch((error) => {
          request.log.error({ err: error, documentId }, "Previous encrypted file cleanup failed");
        });

        return reply.send({
          document: {
            id: documentId,
            originalName: safeFilename(part.filename),
            mimeType: part.mimetype,
            sizeBytes: encrypted.sizeBytes
          }
        });
      } catch (error) {
        if (client && transactionOpen) {
          await client.query("ROLLBACK").catch(() => {});
        }
        request.log.error({ err: error }, "Document replacement failed");
        return reply.code(500).send({ error: "Replacement failed" });
      } finally {
        client?.release();
        // New ciphertext is orphaned unless its metadata transaction committed.
        if (!replacementCommitted && encrypted) {
          await storage.deleteEncryptedFile(encrypted.storageKey).catch(() => {});
        }
      }
    }
  );
}
