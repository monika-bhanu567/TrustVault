
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import {
  AuthSessionGuard,
  type SessionStore
} from "./security/session-guard.js";

export function buildApp(sessionStore?: SessionStore) {
  const app = Fastify({
    logger: false
  });

  app.register(cookie);

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "trustvault-api"
    };
  });

  if (sessionStore) {
    const sessionGuard = new AuthSessionGuard(sessionStore);

    app.get("/session/check", async (request, reply) => {
      const token = request.cookies["trustvault_session"];

      const result = await sessionGuard.validate(token);

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
  }

  return app;
}
