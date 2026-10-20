
import { describe, expect, it } from "vitest";
import {
  AuthorizationDecisionEngine,
  type AuthorizationRequest
} from "../src/security/authorization.js";

const engine = new AuthorizationDecisionEngine();

const owner = {
  id: "user-owner",
  role: "OWNER" as const,
  isActive: true
};

const viewer = {
  id: "user-viewer",
  role: "VIEWER" as const,
  isActive: true
};

const admin = {
  id: "user-admin",
  role: "ADMIN" as const,
  isActive: true
};

const document = {
  id: "document-1",
  ownerId: owner.id
};

function request(
  overrides: Partial<AuthorizationRequest> = {}
): AuthorizationRequest {
  return {
    principal: viewer,
    document,
    action: "READ",
    grants: [],
    ...overrides
  };
}

describe("AuthorizationDecisionEngine", () => {
  it("allows an owner to read their own document", () => {
    const decision = engine.decide(
      request({
        principal: owner,
        action: "READ"
      })
    );

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("OWNER_ACCESS");
  });

  it("denies a viewer without a grant", () => {
    const decision = engine.decide(request());

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("NO_PERMISSION");
  });

  it("allows a viewer with an active read grant", () => {
    const decision = engine.decide(
      request({
        grants: [
          {
            documentId: document.id,
            userId: viewer.id,
            canRead: true,
            canEdit: false,
            isActive: true
          }
        ]
      })
    );

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ACTIVE_GRANT");
  });

  it("denies a viewer whose grant has been revoked", () => {
    const decision = engine.decide(
      request({
        grants: [
          {
            documentId: document.id,
            userId: viewer.id,
            canRead: true,
            canEdit: false,
            isActive: false
          }
        ]
      })
    );

    expect(decision.allowed).toBe(false);
  });

  it("does not automatically allow an administrator to read a document", () => {
    const decision = engine.decide(
      request({
        principal: admin,
        action: "READ"
      })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(
      "ADMIN_CONTENT_ACCESS_REQUIRES_GRANT"
    );
  });

  it("denies inactive users", () => {
    const decision = engine.decide(
      request({
        principal: {
          ...viewer,
          isActive: false
        }
      })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("USER_INACTIVE");
  });

  it("does not allow a viewer to share a document onward", () => {
    const decision = engine.decide(
      request({
        action: "SHARE",
        grants: [
          {
            documentId: document.id,
            userId: viewer.id,
            canRead: true,
            canEdit: true,
            isActive: true
          }
        ]
      })
    );

    expect(decision.allowed).toBe(false);
  });
});
