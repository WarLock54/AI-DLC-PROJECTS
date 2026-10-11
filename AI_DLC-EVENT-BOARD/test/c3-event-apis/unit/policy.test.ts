import { describe, expect, it } from "vitest";
import {
  parseGroups,
  requireAuthenticated,
  requireGroup,
  requireOwnerOrAdmin,
} from "../../../src/event-api/access/policy.js";
import { ApiError } from "../../../src/event-api/http/errors.js";
import { ADMIN, ORGANIZER, OTHER_ORGANIZER } from "../support/fixtures.js";

function denial(action: () => void): { code: string; statusCode: number } {
  try {
    action();
  } catch (error) {
    if (error instanceof ApiError) {
      return { code: error.code, statusCode: error.statusCode };
    }
    throw error;
  }
  throw new Error("Expected a denial.");
}

describe("AccessControl policy (D9)", () => {
  it("parses cognito:groups in the bracketed-string and array forms", () => {
    expect(parseGroups("[admin organizer]")).toEqual(["admin", "organizer"]);
    expect(parseGroups("[organizer]")).toEqual(["organizer"]);
    expect(parseGroups("organizer")).toEqual(["organizer"]);
    expect(parseGroups(["admin", "organizer", 7])).toEqual(["admin", "organizer"]);
    expect(parseGroups("[]")).toEqual([]);
    expect(parseGroups(undefined)).toEqual([]);
  });

  it("allows an organizer to manage an event they own", () => {
    const principal = requireAuthenticated({ sub: ORGANIZER, "cognito:groups": "[organizer]" });
    expect(() => requireGroup(principal, ["organizer", "admin"])).not.toThrow();
    expect(() => requireOwnerOrAdmin(principal, ORGANIZER)).not.toThrow();
  });

  it("denies a non-owner organizer with 403 FORBIDDEN", () => {
    const principal = requireAuthenticated({
      sub: OTHER_ORGANIZER,
      "cognito:groups": ["organizer"],
    });
    expect(denial(() => requireOwnerOrAdmin(principal, ORGANIZER))).toEqual({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("allows an admin to manage any event", () => {
    const principal = requireAuthenticated({ sub: ADMIN, "cognito:groups": "[admin]" });
    expect(() => requireOwnerOrAdmin(principal, ORGANIZER)).not.toThrow();
    expect(() => requireGroup(principal, ["admin"])).not.toThrow();
  });

  it("denies a principal without the required group with 403", () => {
    const resident = requireAuthenticated({ sub: OTHER_ORGANIZER });
    expect(denial(() => requireGroup(resident, ["organizer", "admin"]))).toEqual({
      code: "FORBIDDEN",
      statusCode: 403,
    });
    const organizer = requireAuthenticated({ sub: ORGANIZER, "cognito:groups": "[organizer]" });
    expect(denial(() => requireGroup(organizer, ["admin"])).statusCode).toBe(403);
    // A user subject alone never grants ownership without the organizer group.
    expect(denial(() => requireOwnerOrAdmin(resident, OTHER_ORGANIZER)).statusCode).toBe(403);
  });

  it("requires a sub claim, else 401 AUTHENTICATION_REQUIRED", () => {
    for (const claims of [undefined, {}, { sub: "" }, { sub: 42 }]) {
      expect(denial(() => requireAuthenticated(claims))).toEqual({
        code: "AUTHENTICATION_REQUIRED",
        statusCode: 401,
      });
    }
  });
});
