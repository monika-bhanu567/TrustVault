import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { AuthSessionGuard, } from "./security/session-guard.js";
import { AuthService } from "./auth/auth-service.js";
import { pool } from "./db/pool.js";
import { EncryptedStorage } from "./storage/encrypted-storage.js";
import { registerDocumentRoutes } from "./documents/document-routes.js";
import { registerGrantRoutes } from "./grants/grant-routes.js";
import { PostgresAuditService } from "./audit/postgres-audit-service.js";
const COOKIE_NAME = "trustvault_session";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
function crossSiteCookiesEnabled() {
    return process.env.NODE_ENV === "production" && Boolean(process.env.FRONTEND_ORIGIN);
}
export function buildApp(sessionStore) {
    const app = Fastify({
        logger: true,
        bodyLimit: MAX_FILE_BYTES + 1024 * 1024,
    });
    const authService = new AuthService();
    const auditService = new PostgresAuditService();
    app.register(cookie);
    // The API only permits the explicitly configured deployed frontend to make
    // credentialed cross-origin requests. Local Vite development uses its proxy.
    app.addHook("onRequest", async (request, reply) => {
        const allowedOrigin = process.env.FRONTEND_ORIGIN;
        const origin = request.headers.origin;
        if (origin && allowedOrigin && origin === allowedOrigin) {
            reply
                .header("Access-Control-Allow-Origin", allowedOrigin)
                .header("Access-Control-Allow-Credentials", "true")
                .header("Vary", "Origin");
        }
        if (request.method === "OPTIONS") {
            if (!origin || !allowedOrigin || origin !== allowedOrigin) {
                return reply.code(403).send({ error: "Origin not allowed" });
            }
            return reply
                .header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
                .header("Access-Control-Allow-Headers", "Content-Type")
                .code(204)
                .send();
        }
    });
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
    app.get("/ready", async (_request, reply) => {
        const encryptionKey = process.env.VAULT_ENCRYPTION_KEY;
        const auditKey = process.env.AUDIT_HMAC_KEY;
        if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey) || !auditKey || auditKey.length < 32) {
            return reply.code(503).send({ status: "not_ready" });
        }
        // Production must use persistent, private object storage. Local
        // development deliberately retains encrypted filesystem storage.
        if (process.env.NODE_ENV === "production" &&
            (!process.env.SUPABASE_URL ||
                !process.env.SUPABASE_SERVICE_ROLE_KEY ||
                !process.env.SUPABASE_STORAGE_BUCKET)) {
            return reply.code(503).send({ status: "not_ready" });
        }
        try {
            await pool.query("SELECT 1");
            return { status: "ready" };
        }
        catch (error) {
            app.log.error({ err: error }, "Readiness database check failed");
            return reply.code(503).send({ status: "not_ready" });
        }
    });
    app.post("/auth/register", async (request, reply) => {
        const { email, password } = request.body ?? {};
        if (typeof email !== "string" || typeof password !== "string") {
            return reply.code(400).send({ error: "Invalid request" });
        }
        try {
            const user = await authService.register(email, password);
            return reply.code(201).send({ user });
        }
        catch (error) {
            if (error instanceof Error &&
                ["INVALID_EMAIL", "INVALID_PASSWORD"].includes(error.message)) {
                return reply.code(400).send({
                    error: "Invalid email or password",
                });
            }
            if (error instanceof Error &&
                error.message === "EMAIL_ALREADY_REGISTERED") {
                return reply.code(409).send({
                    error: "Unable to register this account",
                });
            }
            request.log.error({ err: error }, "Registration failed");
            return reply.code(500).send({ error: "Registration failed" });
        }
    });
    app.post("/auth/login", async (request, reply) => {
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
                sameSite: crossSiteCookiesEnabled() ? "none" : "strict",
                path: "/",
                expires: result.expiresAt,
            })
                .send({ user: result.user });
        }
        catch (error) {
            if (error instanceof Error &&
                error.message === "INVALID_CREDENTIALS") {
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
                sameSite: crossSiteCookiesEnabled() ? "none" : "strict",
                path: "/",
            })
                .code(204)
                .send();
        }
        catch (error) {
            request.log.error({ err: error }, "Logout failed");
            return reply.code(500).send({ error: "Logout failed" });
        }
    });
    if (sessionStore) {
        const guard = new AuthSessionGuard(sessionStore);
        app.get("/session/check", async (request, reply) => {
            const result = await guard.validate(request.cookies[COOKIE_NAME]);
            if (!result.valid) {
                return reply.code(401).send({ error: "Unauthorized" });
            }
            return {
                authenticated: true,
                userId: result.user.id,
            };
        });
        app.get("/auth/me", async (request, reply) => {
            const result = await guard.validate(request.cookies[COOKIE_NAME]);
            if (!result.valid) {
                return reply.code(401).send({ error: "Unauthorized" });
            }
            const userResult = await pool.query(`SELECT id, email, role
         FROM users
         WHERE id = $1 AND is_active = TRUE
         LIMIT 1`, [result.user.id]);
            const user = userResult.rows[0];
            if (!user) {
                return reply.code(401).send({ error: "Unauthorized" });
            }
            return { user };
        });
        app.get("/admin/overview", async (request, reply) => {
            const auth = await guard.validate(request.cookies[COOKIE_NAME]);
            if (!auth.valid)
                return reply.code(401).send({ error: "Unauthorized" });
            const admin = await pool.query("SELECT role FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1", [auth.user.id]);
            if (admin.rows[0]?.role !== "ADMIN")
                return reply.code(403).send({ error: "Administrator access required" });
            const [users, documents, activeGrants, denied, events] = await Promise.all([
                pool.query("SELECT COUNT(*)::text AS count FROM users WHERE is_active = TRUE"),
                pool.query("SELECT COUNT(*)::text AS count FROM documents WHERE status = 'ACTIVE'"),
                pool.query("SELECT COUNT(*)::text AS count FROM document_grants WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())"),
                pool.query("SELECT COUNT(*)::text AS count FROM audit_events WHERE event_type = 'DOCUMENT_ACCESS_DENIED' AND created_at > NOW() - INTERVAL '24 hours'"),
                pool.query("SELECT id::text, event_type, entity_type, created_at, metadata FROM audit_events ORDER BY id DESC LIMIT 25")
            ]);
            return {
                metrics: { activeUsers: Number(users.rows[0].count), activeDocuments: Number(documents.rows[0].count), activeGrants: Number(activeGrants.rows[0].count), deniedLast24Hours: Number(denied.rows[0].count) },
                events: events.rows.map((event) => ({ id: event.id, eventType: event.event_type, entityType: event.entity_type, createdAt: event.created_at.toISOString(), metadata: event.metadata }))
            };
        });
        // Return recent audit events without exposing signatures or secrets.
        app.get("/audit", async (request, reply) => {
            const auth = await guard.validate(request.cookies[COOKIE_NAME]);
            if (!auth.valid) {
                return reply.code(401).send({ error: "Unauthorized" });
            }
            const roleResult = await pool.query(`SELECT role FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1`, [auth.user.id]);
            const isAdmin = roleResult.rows[0]?.role === "ADMIN";
            const requestedLimit = Number(request.query.limit ?? 50);
            if (!Number.isInteger(requestedLimit) ||
                requestedLimit < 1 ||
                requestedLimit > 100) {
                return reply.code(400).send({
                    error: "Limit must be between 1 and 100",
                });
            }
            try {
                const result = await pool.query(`SELECT id::text, event_type, entity_type,
                  created_at, metadata
           FROM audit_events
           WHERE $2::boolean
              OR actor_id = $1::text
              OR (
                entity_type = 'document'
                AND entity_id IN (
                  SELECT id::text FROM documents WHERE owner_id = $1::uuid
                )
              )
              OR (
                COALESCE(metadata, '{}'::jsonb) ->> 'documentId' IN (
                  SELECT id::text FROM documents WHERE owner_id = $1::uuid
                )
              )
              OR COALESCE(metadata, '{}'::jsonb) ->> 'recipientUserId' = $1::text
           ORDER BY id DESC
           LIMIT $3`, [auth.user.id, isAdmin, requestedLimit]);
                return {
                    events: result.rows.map((event) => ({
                        id: event.id,
                        eventType: event.event_type,
                        entityType: event.entity_type,
                        createdAt: new Date(event.created_at).toISOString(),
                        metadata: event.metadata && typeof event.metadata === "object"
                            ? event.metadata
                            : {},
                    })),
                };
            }
            catch (error) {
                request.log.error({ err: error }, "Failed to load audit events");
                return reply.code(500).send({
                    error: "Unable to load audit events",
                });
            }
        });
        // Verify the integrity of the complete audit chain.
        app.get("/audit/verify", async (request, reply) => {
            const auth = await guard.validate(request.cookies[COOKIE_NAME]);
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
                    ...(result.epochId ? { epochId: result.epochId } : {}),
                    ...(result.legacyEventCount ? { legacyEventCount: result.legacyEventCount } : {}),
                    ...(result.legacyVerificationStatus ? { legacyVerificationStatus: result.legacyVerificationStatus } : {}),
                };
            }
            catch (error) {
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
