import { describe, expect, it } from "vitest";
import { safeReturnTarget } from "../../../ui/src/auth/return-target.js";

describe("safe return target (D9)", () => {
  it("accepts an allowed protected route for the signed-in role", () => {
    expect(safeReturnTarget("/admin/events", "admin")).toBe("/admin/events");
    expect(safeReturnTarget("/admin/events?status=archived", "admin")).toBe(
      "/admin/events?status=archived",
    );
    expect(safeReturnTarget("/organizer/events", "organizer")).toBe("/organizer/events");
  });

  it("rejects protocol-relative targets", () => {
    expect(safeReturnTarget("//evil.example/admin/events", "admin")).toBe("/admin/events");
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(safeReturnTarget("https://x/admin/events", "admin")).toBe("/admin/events");
    expect(safeReturnTarget("javascript:alert(1)", "organizer")).toBe("/organizer/events");
  });

  it("rejects backslash paths", () => {
    expect(safeReturnTarget("/\\x", "admin")).toBe("/admin/events");
    expect(safeReturnTarget("/%5C%5Cevil.example", "admin")).toBe("/admin/events");
  });

  it("rejects encoded control characters", () => {
    expect(safeReturnTarget("/admin/events%0d%0aSet-Cookie:x", "admin")).toBe("/admin/events");
    expect(safeReturnTarget("/admin/events%00", "admin")).toBe("/admin/events");
    expect(safeReturnTarget("/admin/%E0%A4%A", "admin")).toBe("/admin/events");
  });

  it("rejects unknown and public routes", () => {
    expect(safeReturnTarget("/admin/secret", "admin")).toBe("/admin/events");
    expect(safeReturnTarget("/events", "organizer")).toBe("/organizer/events");
  });

  it("rejects a route the role may not open", () => {
    expect(safeReturnTarget("/admin/stats", "organizer")).toBe("/organizer/events");
  });

  it("falls back to the role default when no target is given", () => {
    expect(safeReturnTarget(null, "admin")).toBe("/admin/events");
    expect(safeReturnTarget("", "organizer")).toBe("/organizer/events");
    expect(safeReturnTarget("/admin/events", null)).toBe("/events");
  });
});
