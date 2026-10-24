
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import {
  calculateAuditHmac,
  verifyAuditEvents,
  type AuditEvent,
  type AuditEventInput,
  type AuditPayload,
  type AuditVerificationResult
} from "./audit-service.js";

interface AuditRow {
  id: string;
  event_type: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  previous_hmac: string | null;
  event_hmac: string;
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    createdAt: new Date(row.created_at).toISOString(),
    previousHmac: row.previous_hmac?.trimEnd() ?? null,
    eventHmac: row.event_hmac.trimEnd()
  };
}

function getSigningKey(): string {
  const key = process.env.AUDIT_HMAC_KEY;

  if (!key || key.length < 32) {
    throw new Error(
      "AUDIT_HMAC_KEY must be configured with at least 32 characters."
    );
  }

  return key;
}

/**
 * Append an audit event using an existing, open PostgreSQL transaction.
 *
 * The caller is responsible for BEGIN, COMMIT, ROLLBACK, and releasing
 * the client. This allows the business change and audit record to commit
 * or roll back together.
 */
export async function appendAuditEventWithClient(
  client: PoolClient,
  input: AuditEventInput
): Promise<AuditEvent> {
  const secret = getSigningKey();

  if (!input.eventType.trim() || !input.entityType.trim()) {
    throw new Error("Audit event and entity types are required.");
  }

  // Serialize audit-chain appends, including appends from different routes.
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [2051, 505]);

  const previousResult = await client.query<{ event_hmac: string }>(
    `SELECT event_hmac
     FROM audit_events
     ORDER BY id DESC
     LIMIT 1`
  );

  const previousHmac =
    previousResult.rows[0]?.event_hmac.trimEnd() ?? null;

  const payload: AuditPayload = {
    eventType: input.eventType,
    actorId: input.actorId ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
    previousHmac
  };

  const eventHmac = calculateAuditHmac(payload, secret);

  const result = await client.query<AuditRow>(
    `INSERT INTO audit_events (
       event_type,
       actor_id,
       entity_type,
       entity_id,
       metadata,
       created_at,
       previous_hmac,
       event_hmac
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     RETURNING
       id::text,
       event_type,
       actor_id,
       entity_type,
       entity_id,
       metadata,
       created_at,
       previous_hmac,
       event_hmac`,
    [
      payload.eventType,
      payload.actorId,
      payload.entityType,
      payload.entityId,
      JSON.stringify(payload.metadata),
      payload.createdAt,
      payload.previousHmac,
      eventHmac
    ]
  );

  return toAuditEvent(result.rows[0]);
}

/**
 * Standalone append API for operations that don't need to share a
 * transaction with another database change.
 */
export class PostgresAuditService {
  async append(input: AuditEventInput): Promise<AuditEvent> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const event = await appendAuditEventWithClient(client, input);

      await client.query("COMMIT");

      return event;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async verify(): Promise<AuditVerificationResult> {
    const secret = getSigningKey();

    const result = await pool.query<AuditRow>(
      `SELECT
         id::text,
         event_type,
         actor_id,
         entity_type,
         entity_id,
         metadata,
         created_at,
         previous_hmac,
         event_hmac
       FROM audit_events
       ORDER BY audit_events.id ASC`
    );

    return verifyAuditEvents(result.rows.map(toAuditEvent), secret);
  }
}
