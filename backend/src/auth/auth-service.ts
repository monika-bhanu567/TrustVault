
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class AuthService {
  async register(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("INVALID_EMAIL");
    }

    if (password.length < 12 || password.length > 72) {
      throw new Error("INVALID_PASSWORD");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const result = await pool.query<{ id: string; email: string; role: string }>(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, 'OWNER')
         RETURNING id, email, role`,
        [normalizedEmail, passwordHash]
      );

      return result.rows[0];
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new Error("EMAIL_ALREADY_REGISTERED");
      }

      throw error;
    }
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await pool.query<{
      id: string;
      email: string;
      password_hash: string;
      role: string;
      is_active: boolean;
      session_epoch: number;
    }>(
      `SELECT id, email, password_hash, role, is_active, session_epoch
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    const user = result.rows[0];

    if (
      !user ||
      !user.is_active ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, session_epoch, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, hashToken(token), user.session_epoch, expiresAt]
    );

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) {
      return;
    }

    await pool.query(
      `UPDATE sessions
       SET revoked_at = NOW()
       WHERE token_hash = $1
         AND revoked_at IS NULL`,
      [hashToken(token)]
    );
  }
}
