
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "../dist/db/pool.js";

const client = await pool.connect();

try {
  const migration = await readFile(
    new URL("../migrations/005_audit_events.sql", import.meta.url),
    "utf8"
  );

  await client.query("BEGIN");
  await client.query(migration);
  await client.query("COMMIT");

  console.log("Migration 005 applied successfully.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Migration 005 failed:", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
