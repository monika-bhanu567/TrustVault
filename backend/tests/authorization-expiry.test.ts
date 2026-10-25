import { describe, expect, it } from "vitest";
import {
  AuthorizationDecisionEngine,
  type AuthorizationRequest
} from "../src/security/authorization.js";

const engine = new AuthorizationDecisionEngine();

function viewerRequest(
  overrides: Partial<AuthorizationRequest["grants"][number]> = {}
): AuthorizationRequest {
  return {
    principal: {
      id: "viewer-1",
      role: "VIEWER",
      isActive: true
    },
    document: {
      id: "document-1",
      ownerId: "owner-1"
    },
    action: "READ",
    grants: [
      {
        documentId: "document-1",
        userId: "viewer-1",
        canRead: true,
        canEdit: false,
        isActive: true,
        ...overrides
      }
    ]
  };
}

describe("Grant expiry and revocation", () => {
  it("denies an expired grant", () => {
    const request = viewerRequest({
      expiresAt: new Date(Date.now() - 60_000)
    });

    expect(engine.decide(request).allowed).toBe(false);
  });

  it("denies a revoked grant", () => {
    const request = viewerRequest({
      isActive: false,
      revokedAt: new Date()
    });

    expect(engine.decide(request).allowed).toBe(false);
  });

  it("allows a valid, unexpired read grant", () => {
    const request = viewerRequest({
      expiresAt: new Date(Date.now() + 60_000)
    });

    expect(engine.decide(request).allowed).toBe(true);
  });

  it("denies edit when a write grant is expired or revoked", () => {
    const expired = viewerRequest({
      canEdit: true,
      expiresAt: new Date(Date.now() - 60_000)
    });
    expired.action = "EDIT";

    const revoked = viewerRequest({
      canEdit: true,
      isActive: false,
      revokedAt: new Date()
    });
    revoked.action = "EDIT";

    expect(engine.decide(expired).allowed).toBe(false);
    expect(engine.decide(revoked).allowed).toBe(false);
  });
});
