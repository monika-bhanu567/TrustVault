import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";

import {
  AuthSessionGuard,
  type SessionStore
} from "./security/session-guard.js";

import { AuthService } from "./auth/auth-service.js";
import { EncryptedStorage } from "./storage/encrypted-storage.js";
import { registerDocumentRoutes } from "./documents/document-routes.js";
import { registerGrantRoutes } from "./grants/grant-routes.js";

const COOKIE_NAME = "trustvault_session";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function buildApp(sessionStore?: SessionStore) {
  const app = Fastify({
    logger: true,
    bodyLimit: MAX_FILE_BYTES + 1024 * 1024
  });

  const authService = new AuthService();

  app.register(cookie);

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
          error: "Invalid email or password"
        });
      }

      if (
        error instanceof Error &&
        error.message === "EMAIL_ALREADY_REGISTERED"
      ) {
        return reply.code(409).send({
          error: "Unable to register this account"
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
          expires: result.expiresAt
        })
        .send({ user: result.user });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "INVALID_CREDENTIALS"
      ) {
        return reply.code(401).send({
          error: "Invalid email or password"
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
          path: "/"
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
        request.cookies[COOKIE_NAME]
      );

      if (!result.valid) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      return {
        authenticated: true,
        userId: result.user.id
      };
    });

    app.register(async (protectedApp) => {
      const storage = new EncryptedStorage();

      await registerDocumentRoutes(protectedApp, guard, storage);
      await registerGrantRoutes(protectedApp, guard);
    });
  }

  return app;
}
