
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";

import {
  AuthSessionGuard,
  type SessionStore,
} from "./security/session-guard.js";

import { AuthService } from "./auth/auth-service.js";
import { pool } from "./db/pool.js";
import { EncryptedStorage } from "./storage/encrypted-storage.js";
import { registerDocumentRoutes } from "./documents/document-routes.js";
import { registerGrantRoutes } from "./grants/grant-routes.js";
import { PostgresAuditService } from "./audit/postgres-audit-service.js";

const COOKIE_NAME = "trustvault_session";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function buildApp(sessionStore?: SessionStore) {
  const app = Fastify({
    logger: true,
    bodyLimit: MAX_FILE_BYTES + 1024 * 1024,
  });

  const authService = new AuthService();
  const auditService = new PostgresAuditService();

  app.register(cookie);

  app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 1,
      fields: 0,
    },
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "trustvault-api",
  }));

  app.post<{
    Body: { email: string; password: string };
  }>("/auth/register", async (request, reply) => {
    const { email, password } = request.body ?? {};

    if (typeof email !== "string" || typeof password !== "string") {
      return reply.code(400).send({ error: "Invalid request" });
    }

    try {
      const user = await authService.register(email, password);
      return reply.code(201).send({ user });
    } catch (error) {
      if (
        error instanceof Error &&
        ["INVALID_EMAIL", "INVALID_PASSWORD"].includes(error.message)
      ) {
        return reply.code(400).send({
          error: "Invalid email or password",
        });
      }

      if (
        error instanceof Error &&
        error.message === "EMAIL_ALREADY_REGISTERED"
      ) {
        return reply.code(409).send({
          error: "Unable to register this account",
        });
      }

      request.log.error({ err: error }, "Registration failed");
      return reply.code(500).send({ error: "Registration failed" });
    }
  });

  app.post<{
    Body: { email: string; password: string };
  }>("/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};

    if (typeof email !== "string" || typeof password !== "string") {
      return reply.code(400).send({ error: "Invalid request" });
    }

    try {
      const result = await authService.login(email, password);

      return reply
        .setCookie(COOKIE_NAME, result.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          expires: result.expiresAt,
        })
        .send({ user: result.user });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "INVALID_CREDENTIALS"
      ) {
        return reply.code(401).send({
          error: "Invalid email or password",
        });
      }

      request.log.error({ err: error }, "Login failed");
      return reply.code(500).send({ error: "Login failed" });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    try {
      await authService.logout(request.cookies[COOKIE_NAME]);

      return reply
        .clearCookie(COOKIE_NAME, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
        })
        .code(204)
        .send();
    } catch (error) {
      request.log.error({ err: error }, "Logout failed");
      return reply.code(500).send({ error: "Logout failed" });
    }
  });

  if (sessionStore) {
    const guard = new AuthSessionGuard(sessionStore);

    app.get("/session/check", async (request, reply) => {
      const result = await guard.validate(
        request.cookies[COOKIE_NAME],
      );

      if (!result.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      return {
        authenticated: true,
        userId: result.user.id,
      };
    });

    app.get("/auth/me", async (request, reply) => {
      const result = await guard.validate(
        request.cookies[COOKIE_NAME],
      );

      if (!result.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const userResult = await pool.query<{
        id: string;
        email: string;
        role: string;
      }>(
        `SELECT id, email, role
         FROM users
         WHERE id = $1 AND is_active = TRUE
         LIMIT 1`,
        [result.user.id],
      );

      const user = userResult.rows[0];

      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      return { user };
    });

    // Return recent audit events without exposing signatures or secrets.
    app.get<{
      Querystring: { limit?: string };
    }>("/audit", async (request, reply) => {
      const auth = await guard.validate(
        request.cookies[COOKIE_NAME],
      );

      if (!auth.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const requestedLimit = Number(request.query.limit ?? 50);

      if (
        !Number.isInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > 100
      ) {
        return reply.code(400).send({
          error: "Limit must be between 1 and 100",
        });
      }

      try {
        const result = await pool.query<{
          id: string;
          event_type: string;
          entity_type: string;
          created_at: Date | string;
          metadata: Record<string, unknown>;
        }>(
          `SELECT id::text, event_type, entity_type,
                  created_at, metadata
           FROM audit_events
           ORDER BY id DESC
           LIMIT $1`,
          [requestedLimit],
        );

        return {
          events: result.rows.map((event) => ({
            id: event.id,
            eventType: event.event_type,
            entityType: event.entity_type,
            createdAt: new Date(event.created_at).toISOString(),
            metadata: event.metadata,
          })),
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to load audit events");
        return reply.code(500).send({
          error: "Unable to load audit events",
        });
      }
    });

    // Verify the integrity of the complete audit chain.
    app.get("/audit/verify", async (request, reply) => {
      const auth = await guard.validate(
        request.cookies[COOKIE_NAME],
      );

      if (!auth.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await auditService.verify();

        return {
          valid: result.valid,
          checkedEvents: result.checkedEvents,
          ...(result.invalidEventId
            ? { invalidEventId: result.invalidEventId }
            : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        };
      } catch (error) {
        request.log.error({ err: error }, "Audit verification failed");
        return reply.code(500).send({
          error: "Unable to verify audit chain",
        });
      }
    });

    app.register(async (protectedApp) => {
      const storage = new EncryptedStorage();

      await registerDocumentRoutes(protectedApp, guard, storage);
      await registerGrantRoutes(protectedApp, guard);
    });
  }

  return app;
}
