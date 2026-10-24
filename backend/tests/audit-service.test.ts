
import { describe, expect, it } from "vitest";
import {
  calculateAuditHmac,
  verifyAuditEvents,
  type AuditEvent,
  type AuditPayload
} from "../src/audit/audit-service.js";

const secret =
  "test-only-audit-key-that-is-at-least-32-characters";

function makeEvent(
  id: string,
  payload: AuditPayload
): AuditEvent {
  return {
    id,
    ...payload,
    eventHmac: calculateAuditHmac(payload, secret)
  };
}

describe("audit service", () => {
  it("produces a deterministic HMAC for the same event", () => {
    const payload: AuditPayload = {
      eventType: "DOCUMENT_UPLOADED",
      actorId: "user-1",
      entityType: "document",
      entityId: "doc-1",
      metadata: { sizeBytes: 123, mimeType: "text/plain" },
      createdAt: "2026-10-23T10:00:00.000Z",
      previousHmac: null
    };

    expect(calculateAuditHmac(payload, secret)).toBe(
      calculateAuditHmac(payload, secret)
    );
  });

  it("changes the HMAC when event data changes", () => {
    const original: AuditPayload = {
      eventType: "DOCUMENT_UPLOADED",
      actorId: "user-1",
      entityType: "document",
      entityId: "doc-1",
      metadata: { sizeBytes: 123 },
      createdAt: "2026-10-23T10:00:00.000Z",
      previousHmac: null
    };

    const changed: AuditPayload = {
      ...original,
      metadata: { sizeBytes: 999 }
    };

    expect(calculateAuditHmac(original, secret)).not.toBe(
      calculateAuditHmac(changed, secret)
    );
  });

  it("rejects a signing key shorter than 32 characters", () => {
    const payload: AuditPayload = {
      eventType: "TEST",
      actorId: null,
      entityType: "system",
      entityId: null,
      metadata: {},
      createdAt: "2026-10-23T10:00:00.000Z",
      previousHmac: null
    };

    expect(() => calculateAuditHmac(payload, "short")).toThrow(
      /at least 32 characters/
    );
  });

  it("accepts a correctly signed event chain", () => {
    const firstPayload: AuditPayload = {
      eventType: "DOCUMENT_UPLOADED",
      actorId: "user-1",
      entityType: "document",
      entityId: "doc-1",
      metadata: { sizeBytes: 123 },
      createdAt: "2026-10-23T10:00:00.000Z",
      previousHmac: null
    };

    const first = makeEvent("1", firstPayload);

    const secondPayload: AuditPayload = {
      eventType: "GRANT_CREATED",
      actorId: "user-1",
      entityType: "document",
      entityId: "doc-1",
      metadata: { recipientId: "user-2" },
      createdAt: "2026-10-23T10:01:00.000Z",
      previousHmac: first.eventHmac
    };

    const second = makeEvent("2", secondPayload);

    expect(verifyAuditEvents([first, second], secret)).toEqual({
      valid: true,
      checkedEvents: 2
    });
  });

  it("detects modified event metadata", () => {
    const payload: AuditPayload = {
      eventType: "DOCUMENT_UPLOADED",
      actorId: "user-1",
      entityType: "document",
      entityId: "doc-1",
      metadata: { sizeBytes: 123 },
      createdAt: "2026-10-23T10:00:00.000Z",
      previousHmac: null
    };

    const event = makeEvent("1", payload);

    const tampered: AuditEvent = {
      ...event,
      metadata: { sizeBytes: 999 }
    };

    const result = verifyAuditEvents([tampered], secret);

    expect(result.valid).toBe(false);
    expect(result.invalidEventId).toBe("1");
    expect(result.reason).toBe("EVENT_HMAC_MISMATCH");
  });

  it("detects a broken link between events", () => {
    const firstPayload: AuditPayload = {
      eventType: "DOCUMENT_UPLOADED",
      actorId: "user-1",
      entityType: "document",
      entityId: "doc-1",
      metadata: {},
      createdAt: "2026-10-23T10:00:00.000Z",
      previousHmac: null
    };

    const first = makeEvent("1", firstPayload);

    const secondPayload: AuditPayload = {
      eventType: "GRANT_REVOKED",
      actorId: "user-1",
      entityType: "document",
      entityId: "doc-1",
      metadata: {},
      createdAt: "2026-10-23T10:01:00.000Z",
      previousHmac: "a".repeat(64)
    };

    const second = makeEvent("2", secondPayload);
    const result = verifyAuditEvents([first, second], secret);

    expect(result.valid).toBe(false);
    expect(result.invalidEventId).toBe("2");
    expect(result.reason).toBe("PREVIOUS_HMAC_MISMATCH");
  });

  it("accepts an empty chain", () => {
    expect(verifyAuditEvents([], secret)).toEqual({
      valid: true,
      checkedEvents: 0
    });
  });
});
