
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
      return {
        allowed: false,
        reason: "USER_INACTIVE"
      };
    }

    // Administrative privileges do not automatically permit
    // reading or editing document contents.
    if (principal.role === "ADMIN") {
      const adminGrant = grants.find(
        (grant) =>
          grant.documentId === document.id &&
          grant.userId === principal.id &&
          grant.isActive
      );

      if (adminGrant && this.grantAllows(adminGrant, action)) {
        return {
          allowed: true,
          reason: "ACTIVE_GRANT"
        };
      }

      return {
        allowed: false,
        reason: "ADMIN_CONTENT_ACCESS_REQUIRES_GRANT"
      };
    }

    // Owners can read and edit their own documents.
    if (principal.id === document.ownerId) {
      if (action === "READ" || action === "EDIT") {
        return {
          allowed: true,
          reason: "OWNER_ACCESS"
        };
      }

      // Sharing is allowed only for the document owner.
      return {
        allowed: true,
        reason: "OWNER_ACCESS"
      };
    }

    // Non-owners must have an active, document-specific grant.
    const grant = grants.find(
      (item) =>
        item.documentId === document.id &&
        item.userId === principal.id &&
        item.isActive
    );

    if (grant && this.grantAllows(grant, action)) {
      return {
        allowed: true,
        reason: "ACTIVE_GRANT"
      };
    }

    return {
      allowed: false,
      reason: "NO_PERMISSION"
    };
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

    // A viewer's grant never authorizes onward sharing.
    return false;
  }
}
