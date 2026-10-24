
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
import { appendAuditEventWithClient } from "../audit/postgres-audit-service.js";

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
  original_name: string;
  mime_type: string;
  size_bytes: string;
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

  app.get("/documents", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);

    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const result = await pool.query<DocumentRow>(
      `SELECT DISTINCT d.id, d.original_name, d.mime_type,
              d.size_bytes, d.created_at
       FROM documents d
       LEFT JOIN document_grants g
         ON g.document_id = d.id
        AND g.user_id = $1
        AND g.can_read = TRUE
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > NOW())
       WHERE d.status = 'ACTIVE'
         AND (d.owner_id = $1 OR g.id IS NOT NULL)
       ORDER BY d.created_at DESC`,
      [auth.user.id]
    );

    return { documents: result.rows };
  });

  app.get<{ Params: { id: string } }>(
    "/documents/:id/download",
    async (request, reply) => {
      const auth = await guard.validate(request.cookies[COOKIE_NAME]);

      if (!auth.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const documentId = request.params.id;

      if (!UUID_PATTERN.test(documentId)) {
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
        return reply.code(404).send({ error: "Document not found" });
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
}
