import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../dist/db/pool.js";

const password = process.env.DEMO_ACCOUNT_PASSWORD;
if (!password || password.length < 12) throw new Error("DEMO_ACCOUNT_PASSWORD must be at least 12 characters");
const accounts = [
  ["demo-admin@trustvault.local", "ADMIN"],
  ["demo-owner@trustvault.local", "OWNER"],
  ["demo-viewer@trustvault.local", "VIEWER"]
];
const hash = await bcrypt.hash(password, 12);
try {
  for (const [email, role] of accounts) {
    await pool.query(`INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3)
      ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, is_active = TRUE`, [email, hash, role]);
  }
  console.log("Demo roles seeded: ADMIN, OWNER, VIEWER");
} finally { await pool.end(); }
