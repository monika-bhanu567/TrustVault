import "dotenv/config";
import { pool } from "../dist/db/pool.js";

try {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM documents WHERE category = 'Uncategorized'"
  );
  console.log(JSON.stringify({ categoryColumnVerified: true, defaultedDocuments: result.rows[0].count }));
} finally {
  await pool.end();
}
