
import "dotenv/config";
import pg from "pg";
import fs from "node:fs/promises";

const { Pool } = pg;

const backup = JSON.parse(
  await fs.readFile(new URL("./trustvault-data-backup.json", import.meta.url), "utf8")
);

const tables = [
  "users",
  "sessions",
  "documents",
  "document_grants",
  "audit_events",
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

try {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const table of tables) {
      const rows = backup[table];

      if (!Array.isArray(rows)) {
        throw new Error(`Missing backup data for ${table}`);
      }

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${table}"`
      );

      if (countResult.rows[0].count !== 0) {
        throw new Error(`Supabase table ${table} is not empty`);
      }

      if (rows.length === 0) {
        console.log(`${table}: no records to import`);
        continue;
      }

      const columns = Object.keys(rows[0]);

      for (const row of rows) {
        const values = columns.map((column) => {
          const value = row[column];

          if (
            value &&
            typeof value === "object" &&
            value.type === "Buffer" &&
            Array.isArray(value.data)
          ) {
            return Buffer.from(value.data);
          }

          return value;

        });

        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
        const quotedColumns = columns.map((column) => `"${column}"`).join(", ");

        await client.query(
          `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`,
          values
        );
      }

      console.log(`${table}: imported ${rows.length} records`);
    }
    // Preserve the audit_events ID sequence after importing explicit IDs.
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('public.audit_events', 'id'),
        COALESCE((SELECT MAX(id) FROM public.audit_events), 1),
        EXISTS (SELECT 1 FROM public.audit_events)
      )
    `);

    await client.query("COMMIT");
    console.log("Import completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error("IMPORT FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
