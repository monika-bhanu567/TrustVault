import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { AuthSessionGuard } from "./security/session-guard.js";
import { AuthService } from "./auth/auth-service.js";
import { EncryptedStorage } from "./storage/encrypted-storage.js";
import { registerDocumentRoutes } from "./documents/document-routes.js";
const COOKIE_NAME = "trustvault_session";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export function buildApp(sessionStore) {
    const app = Fastify({
        logger: false,
        bodyLimit: MAX_FILE_BYTES + 1024 * 1024
    });
    const authService = new AuthService();
    app.register(cookie);
    // Register multipart once at the root.
    app.register(multipart, {
        limits: {
            fileSize: MAX_FILE_BYTES,
            files: 1,
            fields: 0
        }
    });
    app.get("/health", async () => ({
        status: "ok",
        service: "trustvault-api"
    }));
    app.post("/auth/register", async (request, reply) => {
        const { email, password } = request.body ?? {};
        if (typeof email !== "string" ||
            typeof password !== "string") {
            return reply.code(400).send({
                error: "Invalid request"
            });
        }
        try {
            const user = await authService.register(email, password);
            return reply.code(201).send({ user });
        }
        catch (error) {
            if (error instanceof Error &&
                error.message === "INVALID_EMAIL") {
                return reply.code(400).send({
                    error: "Invalid email or password"
                });
            }
            if (error instanceof Error &&
                error.message === "INVALID_PASSWORD") {
                return reply.code(400).send({
                    error: "Invalid email or password"
                });
            }
            if (error instanceof Error &&
                error.message === "EMAIL_ALREADY_REGISTERED") {
                return reply.code(409).send({
                    error: "Unable to register this account"
                });
            }
            request.log.error({ err: error }, "Registration failed");
            return reply.code(500).send({
                error: "Registration failed"
            });
        }
    });
    app.post("/auth/login", async (request, reply) => {
        const { email, password } = request.body ?? {};
        if (typeof email !== "string" ||
            typeof password !== "string") {
            return reply.code(400).send({
                error: "Invalid request"
            });
        }
        try {
            const result = await authService.login(email, password);
            return reply
                .setCookie(COOKIE_NAME, result.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                path: "/",
                expires: result.expiresAt
            })
                .send({ user: result.user });
        }
        catch (error) {
            if (error instanceof Error &&
                error.message === "INVALID_CREDENTIALS") {
                return reply.code(401).send({
                    error: "Invalid email or password"
                });
            }
            request.log.error({ err: error }, "Login failed");
            return reply.code(500).send({
                error: "Login failed"
            });
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
                path: "/"
            })
                .code(204)
                .send();
        }
        catch (error) {
            request.log.error({ err: error }, "Logout failed");
            return reply.code(500).send({
                error: "Logout failed"
            });
        }
    });
    if (sessionStore) {
        const sessionGuard = new AuthSessionGuard(sessionStore);
        app.get("/session/check", async (request, reply) => {
            const result = await sessionGuard.validate(request.cookies[COOKIE_NAME]);
            if (!result.valid) {
                return reply.code(401).send({
                    error: "Unauthorized"
                });
            }
            return {
                authenticated: true,
                userId: result.user.id
            };
        });
        // Register document routes outside the session-check handler.
        // Each document endpoint performs its own session validation.
        app.register(async (documentApp) => {
            const storage = new EncryptedStorage();
            await registerDocumentRoutes(documentApp, sessionGuard, storage);
        });
    }
    return app;
}
