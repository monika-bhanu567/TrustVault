export type UserRole = "ADMIN" | "OWNER" | "VIEWER";

export type DocumentAction = "READ" | "EDIT" | "SHARE";

export interface Principal {
  id: string;
  role: UserRole;
  isActive: boolean;
}

export interface DocumentResource {
  id: string;
  ownerId: string;
}

export interface DocumentGrant {
  documentId: string;
  userId: string;
  canRead: boolean;
  canEdit: boolean;
  isActive: boolean;
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
}

export interface AuthorizationRequest {
  principal: Principal;
  document: DocumentResource;
  action: DocumentAction;
  grants: DocumentGrant[];
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason:
    | "USER_INACTIVE"
    | "OWNER_ACCESS"
    | "ACTIVE_GRANT"
    | "NO_PERMISSION"
    | "ADMIN_CONTENT_ACCESS_REQUIRES_GRANT";
}

export class AuthorizationDecisionEngine {
  decide(request: AuthorizationRequest): AuthorizationDecision {
    const { principal, document, action, grants } = request;

    if (!principal.isActive) {
      return { allowed: false, reason: "USER_INACTIVE" };
    }

    // Admin privileges never imply automatic access to document content.
    if (principal.role === "ADMIN") {
      const grant = grants.find(
        (item) =>
          item.documentId === document.id &&
          item.userId === principal.id &&
          this.isGrantActive(item)
      );

      if (grant && this.grantAllows(grant, action)) {
        return { allowed: true, reason: "ACTIVE_GRANT" };
      }

      return {
        allowed: false,
        reason: "ADMIN_CONTENT_ACCESS_REQUIRES_GRANT"
      };
    }

    if (principal.id === document.ownerId) {
      return {
        allowed: true,
        reason: "OWNER_ACCESS"
      };
    }

    const grant = grants.find(
      (item) =>
        item.documentId === document.id &&
        item.userId === principal.id &&
        this.isGrantActive(item)
    );

    if (grant && this.grantAllows(grant, action)) {
      return { allowed: true, reason: "ACTIVE_GRANT" };
    }

    return { allowed: false, reason: "NO_PERMISSION" };
  }

  private isGrantActive(grant: DocumentGrant): boolean {
    if (!grant.isActive || grant.revokedAt != null) {
      return false;
    }

    if (grant.expiresAt == null) {
      return true;
    }

    const expiry = new Date(grant.expiresAt).getTime();

    return Number.isFinite(expiry) && expiry > Date.now();
  }

  private grantAllows(
    grant: DocumentGrant,
    action: DocumentAction
  ): boolean {
    if (action === "READ") {
      return grant.canRead;
    }

    if (action === "EDIT") {
      return grant.canEdit;
    }

    // Only the document owner may share it.
    return false;
  }
}
