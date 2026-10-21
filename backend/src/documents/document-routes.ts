
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { pool } from "../db/pool.js";
import { AuthSessionGuard } from "../security/session-guard.js";
import { EncryptedStorage } from "../storage/encrypted-storage.js";

const COOKIE_NAME = "trustvault_session";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain"
]);

interface DocumentRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  created_at: Date;
}

interface DownloadRow {
  storage_key: string;
  original_name: string;
  encryption_iv: Buffer;
  encryption_tag: Buffer;
  content_sha256: string;
}

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

        const minimum = mimeType === "application/pdf"
          ? 5
          : mimeType === "image/png"
            ? 8
            : mimeType === "image/jpeg"
              ? 3
              : 1;

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
    } catch {
      return reply.code(400).send({ error: "Invalid upload" });
    }

    if (!part || !ALLOWED_TYPES.has(part.mimetype)) {
      part?.file.destroy();
      return reply.code(400).send({ error: "Unsupported file type" });
    }

    const bridge = new PassThrough();
    const validator = validateStream(part.mimetype);

    // Start the source pipeline before encryption so stream errors
    // propagate and every original byte is preserved.
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

      request.log.error({ err: error }, "Document encryption failed");
      return reply.code(400).send({ error: "Upload failed" });
    }

    try {
      const result = await pool.query<DocumentRow>(
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

      return reply.code(201).send({ document: result.rows[0] });
    } catch (error) {
      await storage.deleteEncryptedFile(encrypted.storageKey);

      request.log.error({ err: error }, "Document metadata save failed");
      return reply.code(500).send({ error: "Upload failed" });
    }
  });

  app.get("/documents", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);

    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const result = await pool.query<DocumentRow>(
      `SELECT id, original_name, mime_type, size_bytes, created_at
       FROM documents
       WHERE owner_id = $1 AND status = 'ACTIVE'
       ORDER BY created_at DESC`,
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

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          request.params.id
        )
      ) {
        return reply.code(404).send({ error: "Document not found" });
      }

      const result = await pool.query<DownloadRow>(
        `SELECT storage_key, original_name,
                encryption_iv, encryption_tag, content_sha256
         FROM documents
         WHERE id = $1 AND owner_id = $2 AND status = 'ACTIVE'
         LIMIT 1`,
        [request.params.id, auth.user.id]
      );

      const document = result.rows[0];

      if (!document) {
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
        void rm(temporaryPath, { force: true });
      };

      stream.once("close", cleanup);
      stream.once("error", cleanup);

      return reply.send(stream);
    }
  );
}
