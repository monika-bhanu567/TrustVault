
import { describe, expect, it } from "vitest";
import {
  AuthSessionGuard,
  type SessionRecord,
  type SessionStore,
  type SessionUser
} from "../src/security/session-guard.js";

const activeUser: SessionUser = {
  id: "user-1",
  isActive: true,
  sessionEpoch: 3
};

const validSession: SessionRecord = {
  token: "test-session-token",
  userId: activeUser.id,
  sessionEpoch: 3,
  expiresAt: Date.now() + 60_000
};

function makeGuard(options?: {
  session?: SessionRecord | null;
  user?: SessionUser | null;
}) {
  const store: SessionStore = {
    async findSession() {
      return options?.session === undefined
        ? validSession
        : options.session;
    },
    async findUser() {
      return options?.user === undefined
        ? activeUser
        : options.user;
    }
  };

  return new AuthSessionGuard(store);
}

describe("AuthSessionGuard", () => {
  it("rejects a missing token", async () => {
    const result = await makeGuard().validate(undefined);

    expect(result).toEqual({
      valid: false,
      reason: "MISSING_TOKEN"
    });
  });

  it("rejects an unknown session", async () => {
    const result = await makeGuard({
      session: null
    }).validate("unknown-token");

    expect(result).toEqual({
      valid: false,
      reason: "INVALID_SESSION"
    });
  });

  it("rejects an expired session", async () => {
    const result = await makeGuard({
      session: {
        ...validSession,
        expiresAt: Date.now() - 1000
      }
    }).validate(validSession.token);

    expect(result).toEqual({
      valid: false,
      reason: "SESSION_EXPIRED"
    });
  });

  it("rejects an inactive user", async () => {
    const result = await makeGuard({
      user: {
        ...activeUser,
        isActive: false
      }
    }).validate(validSession.token);

    expect(result).toEqual({
      valid: false,
      reason: "USER_INACTIVE"
    });
  });

  it("rejects a session with an outdated epoch", async () => {
    const result = await makeGuard({
      user: {
        ...activeUser,
        sessionEpoch: 4
      }
    }).validate(validSession.token);

    expect(result).toEqual({
      valid: false,
      reason: "SESSION_INVALIDATED"
    });
  });

  it("accepts a valid, current session", async () => {
    const result = await makeGuard().validate(validSession.token);

    expect(result).toEqual({
      valid: true,
      user: activeUser
    });
  });
});
