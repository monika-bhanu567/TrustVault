
import { createHash } from "node:crypto";
import { pool } from "./pool.js";
import type {
  SessionRecord,
  SessionStore,
  SessionUser
} from "../security/session-guard.js";

export class PostgresSessionStore implements SessionStore {
  async findSession(
    token: string
  ): Promise<SessionRecord | null> {
    // Store only a hash of the session token in PostgreSQL.
    const tokenHash = createHash("sha256")
      .update(token, "utf8")
      .digest("hex");

    const result = await pool.query<{
      user_id: string;
      session_epoch: number;
      expires_at: Date;
    }>(
      `SELECT user_id, session_epoch, expires_at
       FROM sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      // This token is supplied by the caller; it is not read
      // from or stored in the database.
      token,
      userId: row.user_id,
      sessionEpoch: row.session_epoch,
      expiresAt: new Date(row.expires_at).getTime()
    };
  }

  async findUser(
    userId: string
  ): Promise<SessionUser | null> {
    const result = await pool.query<{
      id: string;
      is_active: boolean;
      session_epoch: number;
    }>(
      `SELECT id, is_active, session_epoch
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      isActive: row.is_active,
      sessionEpoch: row.session_epoch
    };
  }
}
