import { authenticationRequired, forbidden } from "../http/errors.js";

// D9 AccessControl over Cognito JWT claims already verified by the API Gateway
// JWT authorizer. This layer adds role and ownership decisions.
export type Group = "organizer" | "admin";

export type Claims = Record<string, unknown> | undefined;

export interface Principal {
  subject: string;
  groups: ReadonlySet<string>;
}

/**
 * Parses `cognito:groups` in either form API Gateway may pass: an array, or
 * the bracketed string form such as "[admin organizer]".
 */
export function parseGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) {
    return claim.filter((group): group is string => typeof group === "string" && group !== "");
  }
  if (typeof claim !== "string") {
    return [];
  }
  return claim
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .map((group) => group.trim())
    .filter((group) => group !== "");
}

export function requireAuthenticated(claims: Claims): Principal {
  const subject = claims?.sub;
  if (typeof subject !== "string" || subject.trim() === "") {
    throw authenticationRequired();
  }
  return { subject, groups: new Set(parseGroups(claims?.["cognito:groups"])) };
}

export function isAdmin(principal: Principal): boolean {
  return principal.groups.has("admin");
}

export function requireGroup(principal: Principal, allowed: readonly Group[]): void {
  if (!allowed.some((group) => principal.groups.has(group))) {
    throw forbidden(`This operation requires one of the groups: ${allowed.join(", ")}.`);
  }
}

/** Admins may manage any event; organizers only the events they own. */
export function requireOwnerOrAdmin(principal: Principal, ownerSubject: string): void {
  if (isAdmin(principal)) {
    return;
  }
  if (principal.groups.has("organizer") && principal.subject === ownerSubject) {
    return;
  }
  throw forbidden("Only the event owner or an admin may manage this event.");
}
