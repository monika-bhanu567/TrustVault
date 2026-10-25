
import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuditEventInput {
  eventType: string;
  actorId?: string | null;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  previousHmac: string | null;
  eventHmac: string;
}

export interface AuditPayload {
  eventType: string;
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  previousHmac: string | null;
}

export interface AuditVerificationResult {
  valid: boolean;
  checkedEvents: number;
  invalidEventId?: string;
  reason?: string;
  epochId?: string;
  legacyEventCount?: number;
  legacyVerificationStatus?: "UNVERIFIABLE_KEY_UNAVAILABLE";
}

const GENESIS_HMAC = "GENESIS";

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return JSON.stringify(value);
  }

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(sorted).map(([key, item]) => [
        key,
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item)
          ? JSON.parse(canonicalJson(item))
          : item
      ])
    )
  );
}

export function calculateAuditHmac(
  payload: AuditPayload,
  secret: string
): string {
  if (secret.length < 32) {
    throw new Error(
      "AUDIT_HMAC_KEY must contain at least 32 characters."
    );
  }

  const canonicalPayload = canonicalJson({
    eventType: payload.eventType,
    actorId: payload.actorId,
    entityType: payload.entityType,
    entityId: payload.entityId,
    metadata: payload.metadata,
    createdAt: payload.createdAt,
    previousHmac: payload.previousHmac
  });

  return createHmac("sha256", secret)
    .update(canonicalPayload, "utf8")
    .digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (
    !/^[a-f0-9]{64}$/i.test(left) ||
    !/^[a-f0-9]{64}$/i.test(right)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex")
  );
}

export function verifyAuditEvents(
  events: AuditEvent[],
  secret: string
): AuditVerificationResult {
  if (secret.length < 32) {
    throw new Error(
      "AUDIT_HMAC_KEY must contain at least 32 characters."
    );
  }

  let expectedPreviousHmac: string | null = null;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    if (event.previousHmac !== expectedPreviousHmac) {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "PREVIOUS_HMAC_MISMATCH"
      };
    }

    const expectedHmac = calculateAuditHmac(
      {
        eventType: event.eventType,
        actorId: event.actorId,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: event.metadata,
        createdAt: event.createdAt,
        previousHmac: event.previousHmac
      },
      secret
    );

    if (!safeEqualHex(event.eventHmac, expectedHmac)) {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "EVENT_HMAC_MISMATCH"
      };
    }

    expectedPreviousHmac = event.eventHmac;
  }

  return {
    valid: true,
    checkedEvents: events.length
  };
}

export function getAuditGenesisHmac(): null {
  // The first event has no predecessor.
  // Its HMAC still covers the explicit null previousHmac value.
  void GENESIS_HMAC;
  return null;
}
