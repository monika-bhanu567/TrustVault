
export interface SessionRecord {
  token: string;
  userId: string;
  sessionEpoch: number;
  expiresAt: number;
}

export interface SessionUser {
  id: string;
  isActive: boolean;
  sessionEpoch: number;
}

export interface SessionStore {
  findSession(token: string): Promise<SessionRecord | null>;
  findUser(userId: string): Promise<SessionUser | null>;
}

export type SessionValidationResult =
  | {
      valid: true;
      user: SessionUser;
    }
  | {
      valid: false;
      reason:
        | "MISSING_TOKEN"
        | "INVALID_SESSION"
        | "SESSION_EXPIRED"
        | "USER_INACTIVE"
        | "SESSION_INVALIDATED";
    };

export class AuthSessionGuard {
  constructor(private readonly store: SessionStore) {}

  async validate(
    token: string | undefined
  ): Promise<SessionValidationResult> {
    if (!token) {
      return {
        valid: false,
        reason: "MISSING_TOKEN"
      };
    }

    const session = await this.store.findSession(token);

    if (!session) {
      return {
        valid: false,
        reason: "INVALID_SESSION"
      };
    }

    if (session.expiresAt <= Date.now()) {
      return {
        valid: false,
        reason: "SESSION_EXPIRED"
      };
    }

    const user = await this.store.findUser(session.userId);

    if (!user || !user.isActive) {
      return {
        valid: false,
        reason: "USER_INACTIVE"
      };
    }

    if (session.sessionEpoch !== user.sessionEpoch) {
      return {
        valid: false,
        reason: "SESSION_INVALIDATED"
      };
    }

    return {
      valid: true,
      user
    };
  }
}
