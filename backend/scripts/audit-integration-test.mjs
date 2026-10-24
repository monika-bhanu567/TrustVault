
import "dotenv/config";
import { pool } from "../dist/db/pool.js";
import { PostgresAuditService } from "../dist/audit/postgres-audit-service.js";

const audit = new PostgresAuditService();

async function expectBlocked(label, query, values) {
  try {
    await pool.query(query, values);
    throw new Error(`${label} was unexpectedly allowed`);
  } catch (error) {
    if (error instanceof Error &&
        error.message === `${label} was unexpectedly allowed`) {
      throw error;
    }

    console.log(`PASS: ${label} was rejected`);
  }
}

async function main() {
  if (
    !process.env.AUDIT_HMAC_KEY ||
    process.env.AUDIT_HMAC_KEY.length < 32
  ) {
    throw new Error(
      "Configure AUDIT_HMAC_KEY in .env before running this test."
    );
  }

  console.log("1. Appending a test audit event...");

  const first = await audit.append({
    eventType: "AUDIT_INTEGRATION_TEST",
    actorId: "integration-test",
    entityType: "system",
    entityId: "audit-test",
    metadata: { test: "single-write" }
  });

  if (!first.id || !first.eventHmac) {
    throw new Error("The first event was not persisted correctly.");
  }

  console.log("PASS: Event persisted with an HMAC.");

  console.log("2. Testing concurrent appends...");

  const concurrentEvents = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      audit.append({
        eventType: "AUDIT_CONCURRENCY_TEST",
        actorId: "integration-test",
        entityType: "system",
        entityId: "audit-test",
        metadata: { sequence: index + 1 }
      })
    )
  );

  if (concurrentEvents.length !== 5) {
    throw new Error("Unexpected concurrent event count.");
  }

  console.log("PASS: All 5 concurrent appends completed.");

  console.log("3. Verifying the complete HMAC chain...");

  const verification = await audit.verify();

  if (!verification.valid) {
    throw new Error(
      `Audit chain verification failed: ${JSON.stringify(verification)}`
    );
  }

  console.log(
    `PASS: ${verification.checkedEvents} stored events verified.`
  );

  console.log("4. Testing append-only database triggers...");

  await expectBlocked(
    "Audit event UPDATE",
    "UPDATE audit_events SET metadata = metadata WHERE id = $1",
    [first.id]
  );

  await expectBlocked(
    "Audit event DELETE",
    "DELETE FROM audit_events WHERE id = $1",
    [first.id]
  );

  const finalVerification = await audit.verify();

  if (!finalVerification.valid) {
    throw new Error("Audit chain failed after trigger tests.");
  }

  console.log("PASS: Chain remains valid after trigger tests.");
  console.log("ALL AUDIT INTEGRATION CHECKS PASSED.");
}

try {
  await main();
} catch (error) {
  console.error(
    "AUDIT INTEGRATION TEST FAILED:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
