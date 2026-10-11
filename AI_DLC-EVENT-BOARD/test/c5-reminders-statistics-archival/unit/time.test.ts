import { describe, expect, it } from "vitest";
import {
  archiveCutoff,
  isCanonicalTimestamp,
  isLeapYear,
  reminderScheduledFor,
  reminderWindow,
  requireValidDate,
  toCanonicalTimestamp,
} from "../../../src/operations/shared/time.js";

describe("archiveCutoff (C-03 one calendar year)", () => {
  it("subtracts one calendar year and keeps the time of day", () => {
    expect(archiveCutoff(new Date("2026-10-06T12:34:56.789Z"))).toBe("2025-10-06T12:34:56.789Z");
  });

  it("clamps a February 29 anniversary to February 28 in a non-leap target year", () => {
    expect(archiveCutoff(new Date("2024-02-29T12:00:00.000Z"))).toBe("2023-02-28T12:00:00.000Z");
  });

  it("keeps February 28 and March 1 unchanged around a leap year", () => {
    expect(archiveCutoff(new Date("2025-02-28T00:00:00.000Z"))).toBe("2024-02-28T00:00:00.000Z");
    expect(archiveCutoff(new Date("2025-03-01T00:00:00.000Z"))).toBe("2024-03-01T00:00:00.000Z");
  });

  it("rejects an invalid clock value", () => {
    expect(() => archiveCutoff(new Date("not a date"))).toThrow(/valid Date/);
  });
});

describe("reminder window (Q3 B)", () => {
  it("covers [now+23h, now+25h)", () => {
    expect(reminderWindow(new Date("2026-10-06T00:00:00.000Z"))).toEqual({
      from: "2026-10-06T23:00:00.000Z",
      to: "2026-10-07T01:00:00.000Z",
    });
  });

  it("schedules a reminder 24 hours before the start", () => {
    expect(reminderScheduledFor("2026-10-07T10:00:00.000Z")).toBe("2026-10-06T10:00:00.000Z");
  });

  it("rejects a non-canonical start time", () => {
    expect(() => reminderScheduledFor("2026-10-07T10:00:00Z")).toThrow(/canonical/);
  });
});

describe("timestamp helpers", () => {
  it("recognizes only canonical millisecond UTC timestamps", () => {
    expect(isCanonicalTimestamp("2026-10-06T00:00:00.000Z")).toBe(true);
    expect(isCanonicalTimestamp("2026-10-06T00:00:00Z")).toBe(false);
    expect(isCanonicalTimestamp(42)).toBe(false);
  });

  it("formats dates canonically and validates clock output", () => {
    expect(toCanonicalTimestamp(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    expect(() => requireValidDate("2026-01-01")).toThrow(/valid Date/);
  });

  it("applies the Gregorian leap-year rule", () => {
    expect([2024, 2023, 1900, 2000].map(isLeapYear)).toEqual([true, false, false, true]);
  });
});
