import { pool } from "./pool.js";

try {
  const result = await pool.query(`
    SELECT
      g.id AS grant_id,
      g.document_id,
      g.revoked_at,
      d.status AS document_status,
      CASE
        WHEN d.id IS NULL THEN 'DOCUMENT MISSING'
        WHEN d.owner_id = g.granted_by THEN 'OWNER MATCH'
        ELSE 'OWNER CHECK NEEDED'
      END AS ownership_check
    FROM document_grants g
    LEFT JOIN documents d ON d.id = g.document_id
    ORDER BY g.created_at DESC
    LIMIT 10
  `);

  console.table(result.rows);
} catch (error) {
  console.error(
    "Unable to inspect grants:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}