import "dotenv/config";
import { pool } from "../dist/db/pool.js";

async function main() {
  const result = await pool.query(`
    SELECT
      id::text AS id,
      event_type,
      created_at,
      previous_hmac,
      event_hmac
    FROM audit_events
    ORDER BY audit_events.id ASC
  `);

  console.log("Audit chain link check (read-only)");

  let expectedPrevious = null;
  let firstMismatch = null;

  for (const row of result.rows) {
    const storedPrevious = row.previous_hmac?.trimEnd() ?? null;
    const eventHmac = row.event_hmac.trimEnd();
    const matches = storedPrevious === expectedPrevious;

    console.log({
      id: row.id,
      eventType: row.event_type,
      linkMatches: matches,
      storedPrevious: storedPrevious?.slice(0, 12) ?? null,
      expectedPrevious: expectedPrevious?.slice(0, 12) ?? null,
      eventHmac: eventHmac.slice(0, 12)
    });

    if (!matches && firstMismatch === null) {
      firstMismatch = row.id;
    }

    expectedPrevious = eventHmac;
  }

  console.log(
    firstMismatch === null
      ? "RESULT: All previous-HMAC links match."
      : `RESULT: First previous-HMAC link mismatch is at event ${firstMismatch}.`
  );
}

try {
  await main();
} catch (error) {
  console.error(
    "Diagnostic failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
