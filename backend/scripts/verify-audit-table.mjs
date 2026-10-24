
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "trustvault",
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000
});

try {
  const result = await pool.query(`
    SELECT
      to_regclass('public.audit_events') AS audit_table,
      COUNT(*)::int AS event_count
    FROM public.audit_events
  `);

  console.log("Audit table:", result.rows[0].audit_table);
  console.log("Existing events:", result.rows[0].event_count);

  const triggers = await pool.query(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'audit_events'
    ORDER BY trigger_name
  `);

  console.log(
    "Audit triggers:",
    triggers.rows.map((row) => row.trigger_name)
  );
} catch (error) {
  console.error("Audit verification failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
