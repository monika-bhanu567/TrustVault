
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type {
  SessionRecord,
  SessionStore,
  SessionUser
} from "../src/security/session-guard.js";

function createSessionStore(): SessionStore {
  const users: SessionUser[] = [
    {
      id: "user-1",
      isActive: true,
      sessionEpoch: 1
    }
  ];

  const sessions: SessionRecord[] = [
    {
      token: "valid-test-token",
      userId: "user-1",
      sessionEpoch: 1,
      expiresAt: Date.now() + 60_000
    }
  ];

  return {
    async findSession(token) {
      return sessions.find((session) => session.token === token) ?? null;
    },

    async findUser(userId) {
      return users.find((user) => user.id === userId) ?? null;
    }
  };
}

describe("TrustVault API", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns a healthy status", async () => {
    app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "trustvault-api"
    });
  });

  it("rejects a request without a session cookie", async () => {
    app = buildApp(createSessionStore());

    const response = await app.inject({
      method: "GET",
      url: "/session/check"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized"
    });
  });

  it("rejects an invalid session token", async () => {
    app = buildApp(createSessionStore());

    const response = await app.inject({
      method: "GET",
      url: "/session/check",
      headers: {
        cookie: "trustvault_session=invalid-token"
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it("accepts a valid session cookie", async () => {
    app = buildApp(createSessionStore());

    const response = await app.inject({
      method: "GET",
      url: "/session/check",
      headers: {
        cookie: "trustvault_session=valid-test-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      userId: "user-1"
    });
  });
});
