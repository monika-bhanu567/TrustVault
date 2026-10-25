import "dotenv/config";
import { pool } from "../dist/db/pool.js";

try {
  const result = await pool.query(
    "SELECT id, public FROM storage.buckets WHERE id = 'trustvault-encrypted'"
  );
  console.log(JSON.stringify({
    bucketExists: result.rowCount === 1,
    isPublic: result.rows[0]?.public ?? null
  }));
} catch {
  console.log(JSON.stringify({
    bucketExists: null,
    storageCatalogAccessible: false
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
