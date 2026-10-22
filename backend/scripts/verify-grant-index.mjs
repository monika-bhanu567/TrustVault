import "dotenv/config";
import { pool } from "../dist/db/pool.js";

try {
  const result = await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'document_grants'
      AND indexname = 'uq_document_grants_one_unrevoked_per_user'
  `);

  if (result.rows.length !== 1) {
    throw new Error("Expected unique grant index was not found");
  }

  console.log("PASS: Unique active-grant index exists.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
