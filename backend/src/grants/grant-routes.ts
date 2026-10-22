import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { AuthSessionGuard } from "../security/session-guard.js";

const COOKIE_NAME = "trustvault_session";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OwnedDocument {
  id: string;
}

interface GrantRow {
  id: string;
  document_id: string;
  user_id: string;
  email: string;
  can_read: boolean;
  can_edit: boolean;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

export async function registerGrantRoutes(
  app: FastifyInstance,
  guard: AuthSessionGuard
): Promise<void> {
  // Create a grant. Only the document owner may share it.
  app.post<{
    Params: { id: string };
    Body: {
      email: string;
      canRead?: boolean;
      canEdit?: boolean;
      expiresAt?: string | null;
    };
  }>("/documents/:id/grants", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);

    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const documentId = request.params.id;

    if (!UUID_PATTERN.test(documentId)) {
      return reply.code(404).send({ error: "Document not found" });
    }

    const body = request.body;

    if (
      !body ||
      typeof body.email !== "string" ||
      (body.canRead !== undefined && typeof body.canRead !== "boolean") ||
      (body.canEdit !== undefined && typeof body.canEdit !== "boolean") ||
      (body.expiresAt !== undefined &&
        body.expiresAt !== null &&
        typeof body.expiresAt !== "string")
    ) {
      return reply.code(400).send({ error: "Invalid grant request" });
    }

    const canRead = body.canRead ?? true;
    const canEdit = body.canEdit ?? false;

    if (!canRead && !canEdit) {
      return reply.code(400).send({
        error: "At least one permission is required"
      });
    }

    let expiresAt: Date | null = null;

    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt);

      if (
        Number.isNaN(expiresAt.getTime()) ||
        expiresAt.getTime() <= Date.now()
      ) {
        return reply.code(400).send({
          error: "Expiry must be a valid future date"
        });
      }
    }

    const ownerResult = await pool.query<OwnedDocument>(
      `SELECT id FROM documents
       WHERE id = $1 AND owner_id = $2 AND status = 'ACTIVE'`,
      [documentId, auth.user.id]
    );

    if (!ownerResult.rows[0]) {
      return reply.code(404).send({ error: "Document not found" });
    }

    const normalizedEmail = body.email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return reply.code(400).send({ error: "Invalid email address" });
    }

    const targetResult = await pool.query<{ id: string }>(
      `SELECT id FROM users
       WHERE email = $1 AND is_active = TRUE`,
      [normalizedEmail]
    );

    const target = targetResult.rows[0];

    if (!target) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (target.id === auth.user.id) {
      return reply.code(400).send({
        error: "You already own this document"
      });
    }

    try {
      const result = await pool.query<GrantRow>(
        `INSERT INTO document_grants
          (document_id, user_id, granted_by, can_read, can_edit, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, document_id, user_id, can_read, can_edit,
                   created_at, expires_at, revoked_at,
                   ''::text AS email`,
        [
          documentId,
          target.id,
          auth.user.id,
          canRead,
          canEdit,
          expiresAt
        ]
      );

      return reply.code(201).send({
        grant: {
          id: result.rows[0].id,
          documentId,
          userId: target.id,
          canRead,
          canEdit,
          expiresAt
        }
      });
    } catch (error) {
      request.log.error({ err: error }, "Failed to create document grant");
      return reply.code(500).send({ error: "Unable to create grant" });
    }
  });

  // List grants. Only the document owner may inspect them.
  app.get<{ Params: { id: string } }>(
    "/documents/:id/grants",
    async (request, reply) => {
      const auth = await guard.validate(request.cookies[COOKIE_NAME]);

      if (!auth.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const documentId = request.params.id;

      if (!UUID_PATTERN.test(documentId)) {
        return reply.code(404).send({ error: "Document not found" });
      }

      const result = await pool.query<GrantRow>(
        `SELECT g.id, g.document_id, g.user_id, u.email,
                g.can_read, g.can_edit, g.created_at,
                g.expires_at, g.revoked_at
         FROM document_grants g
         JOIN users u ON u.id = g.user_id
         JOIN documents d ON d.id = g.document_id
         WHERE g.document_id = $1
           AND d.owner_id = $2
         ORDER BY g.created_at DESC`,
        [documentId, auth.user.id]
      );

      if (result.rows.length === 0) {
        const document = await pool.query(
          `SELECT id FROM documents
           WHERE id = $1 AND owner_id = $2 AND status = 'ACTIVE'`,
          [documentId, auth.user.id]
        );

        if (!document.rows[0]) {
          return reply.code(404).send({ error: "Document not found" });
        }
      }

      return {
        grants: result.rows.map((grant) => ({
          id: grant.id,
          userId: grant.user_id,
          email: grant.email,
          canRead: grant.can_read,
          canEdit: grant.can_edit,
          createdAt: grant.created_at,
          expiresAt: grant.expires_at,
          revokedAt: grant.revoked_at,
          active:
            grant.revoked_at === null &&
            (grant.expires_at === null ||
              new Date(grant.expires_at).getTime() > Date.now())
        }))
      };
    }
  );

  // Revoke a grant. Only the document owner may revoke it.
  app.delete<{
    Params: { id: string; grantId: string };
  }>("/documents/:id/grants/:grantId", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);

    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { id: documentId, grantId } = request.params;

    if (
      !UUID_PATTERN.test(documentId) ||
      !UUID_PATTERN.test(grantId)
    ) {
      return reply.code(404).send({ error: "Grant not found" });
    }

    const result = await pool.query(
      `UPDATE document_grants g
       SET revoked_at = NOW()
       FROM documents d
       WHERE g.id = $1
         AND g.document_id = $2
         AND d.id = g.document_id
         AND d.owner_id = $3
         AND d.status = 'ACTIVE'
         AND g.revoked_at IS NULL
       RETURNING g.id`,
      [grantId, documentId, auth.user.id]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: "Grant not found" });
    }

    return reply.code(204).send();
  });
}
