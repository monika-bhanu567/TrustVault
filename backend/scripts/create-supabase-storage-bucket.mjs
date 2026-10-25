import "dotenv/config";
import { pool } from "../dist/db/pool.js";

const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "trustvault-encrypted";

try {
  await pool.query(
    `INSERT INTO storage.buckets (id, name, public)
     VALUES ($1, $1, FALSE)
     ON CONFLICT (id) DO UPDATE SET public = FALSE`,
    [bucket]
  );
  console.log(JSON.stringify({ bucket, isPublic: false }));
} finally {
  await pool.end();
}
