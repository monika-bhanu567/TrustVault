
import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { AuthSessionGuard } from "../security/session-guard.js";
import { appendAuditEventWithClient } from "../audit/postgres-audit-service.js";

const COOKIE_NAME = "trustvault_session";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

interface RevokedGrantRow {
  id: string;
  user_id: string;
  can_read: boolean;
  can_edit: boolean;
  expires_at: Date | null;
}

export async function registerGrantRoutes(
  app: FastifyInstance,
  guard: AuthSessionGuard
): Promise<void> {
  // Create or update a grant. Only the document owner may share it.
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

    const normalizedEmail = body.email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return reply.code(400).send({ error: "Invalid email address" });
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
        !Number.isFinite(expiresAt.getTime()) ||
        expiresAt.getTime() <= Date.now()
      ) {
        return reply.code(400).send({
          error: "Expiry must be a valid future date"
        });
      }
    }

    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const document = await client.query(
        `SELECT id
         FROM documents
         WHERE id = $1
           AND owner_id = $2
           AND status = 'ACTIVE'
         FOR UPDATE`,
        [documentId, auth.user.id]
      );

      if (!document.rows[0]) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return reply.code(404).send({ error: "Document not found" });
      }

      const targetResult = await client.query<{ id: string }>(
        `SELECT id
         FROM users
         WHERE email = $1 AND is_active = TRUE`,
        [normalizedEmail]
      );

      const target = targetResult.rows[0];

      if (!target) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return reply.code(404).send({ error: "User not found" });
      }

      if (target.id === auth.user.id) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return reply.code(400).send({
          error: "You already own this document"
        });
      }

      const existingGrant = await client.query<{ id: string }>(
        `SELECT id
         FROM document_grants
         WHERE document_id = $1
           AND user_id = $2
           AND revoked_at IS NULL
         FOR UPDATE`,
        [documentId, target.id]
      );

      const eventType = existingGrant.rows[0]
        ? "GRANT_UPDATED"
        : "GRANT_CREATED";

      const result = await client.query<GrantRow>(
        `INSERT INTO document_grants
          (document_id, user_id, granted_by, can_read, can_edit, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_id, user_id)
           WHERE revoked_at IS NULL
         DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           can_read = EXCLUDED.can_read,
           can_edit = EXCLUDED.can_edit,
           created_at = NOW(),
           expires_at = EXCLUDED.expires_at
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

      const grant = result.rows[0];

      await appendAuditEventWithClient(client, {
        eventType,
        actorId: auth.user.id,
        entityType: "document_grant",
        entityId: grant.id,
        metadata: {
          documentId,
          recipientUserId: target.id,
          canRead: grant.can_read,
          canEdit: grant.can_edit,
          expiresAt: grant.expires_at
            ? new Date(grant.expires_at).toISOString()
            : null
        }
      });

      await client.query("COMMIT");
      transactionOpen = false;

      return reply.code(201).send({
        grant: {
          id: grant.id,
          documentId: grant.document_id,
          userId: grant.user_id,
          canRead: grant.can_read,
          canEdit: grant.can_edit,
          expiresAt: grant.expires_at
        }
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => {});
      }

      request.log.error({ err: error }, "Failed to create document grant");
      return reply.code(500).send({ error: "Unable to create grant" });
    } finally {
      client.release();
    }
  });

  // List grant history for a document owned by the caller.
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
           AND d.status = 'ACTIVE'
         ORDER BY g.created_at DESC, g.id DESC`,
        [documentId, auth.user.id]
      );

      if (result.rows.length === 0) {
        const document = await pool.query(
          `SELECT id
           FROM documents
           WHERE id = $1
             AND owner_id = $2
             AND status = 'ACTIVE'`,
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

  // NEW: List documents shared with the logged-in recipient.
  app.get("/shared-with-me", async (request, reply) => {
    const auth = await guard.validate(request.cookies[COOKIE_NAME]);

    if (!auth.valid) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    try {
      const result = await pool.query<{
        grant_id: string;
        document_id: string;
        document_name: string;
        owner_email: string;
        can_read: boolean;
        can_edit: boolean;
        created_at: Date;
        expires_at: Date | null;
      }>(
        `SELECT
           g.id AS grant_id,
           d.id AS document_id,
           COALESCE(
             to_jsonb(d)->>'filename',
             to_jsonb(d)->>'original_name',
             to_jsonb(d)->>'name',
             to_jsonb(d)->>'title',
             'Shared document'
           ) AS document_name,
           owner.email AS owner_email,
           g.can_read,
           g.can_edit,
           g.created_at,
           g.expires_at
         FROM document_grants g
         JOIN documents d ON d.id = g.document_id
         JOIN users owner ON owner.id = d.owner_id
         WHERE g.user_id = $1
           AND g.revoked_at IS NULL
           AND d.status = 'ACTIVE'
           AND (g.expires_at IS NULL OR g.expires_at > NOW())
           AND (g.can_read = TRUE OR g.can_edit = TRUE)
         ORDER BY g.created_at DESC`,
        [auth.user.id]
      );

      return {
        documents: result.rows.map((item) => ({
          grantId: item.grant_id,
          documentId: item.document_id,
          documentName: item.document_name,
          ownerEmail: item.owner_email,
          canRead: item.can_read,
          canEdit: item.can_edit,
          sharedAt: item.created_at,
          expiresAt: item.expires_at
        }))
      };
    } catch (error) {
      request.log.error(
        { err: error },
        "Failed to list documents shared with user"
      );

      return reply.code(500).send({
        error: "Unable to load shared documents"
      });
    }
  });

  // Revoke a grant and audit the revocation atomically.
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

    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const result = await client.query<RevokedGrantRow>(
        `UPDATE document_grants g
         SET revoked_at = NOW()
         FROM documents d
         WHERE g.id = $1
           AND g.document_id = $2
           AND d.id = g.document_id
           AND d.owner_id = $3
           AND d.status = 'ACTIVE'
           AND g.revoked_at IS NULL
         RETURNING g.id, g.user_id, g.can_read, g.can_edit, g.expires_at`,
        [grantId, documentId, auth.user.id]
      );

      const grant = result.rows[0];

      if (!grant) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return reply.code(404).send({ error: "Grant not found" });
      }

      await appendAuditEventWithClient(client, {
        eventType: "GRANT_REVOKED",
        actorId: auth.user.id,
        entityType: "document_grant",
        entityId: grant.id,
        metadata: {
          documentId,
          recipientUserId: grant.user_id,
          canRead: grant.can_read,
          canEdit: grant.can_edit,
          expiresAt: grant.expires_at
            ? new Date(grant.expires_at).toISOString()
            : null
        }
      });

      await client.query("COMMIT");
      transactionOpen = false;

      return reply.code(204).send();
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => {});
      }

      request.log.error({ err: error }, "Failed to revoke document grant");
      return reply.code(500).send({ error: "Unable to revoke grant" });
    } finally {
      client.release();
    }
  });
}
