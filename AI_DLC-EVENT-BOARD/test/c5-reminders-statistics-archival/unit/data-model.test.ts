import { describe, expect, it } from "vitest";
import {
  buildArchiveObject,
  parseArchiveObject,
  sanitizeRecord,
  serializeArchiveObject,
} from "../../../src/operations/archival/archive-object.js";
import {
  InvalidReminderMessageError,
  parseReminderMessage,
  serializeReminderMessage,
  validateReminderMessage,
} from "../../../src/operations/reminders/message.js";
import {
  ACTIVE_LIFECYCLE_PARTITION,
  ARCHIVED_LIFECYCLE_PARTITION,
  archiveEligibilityUpperBound,
  archiveObjectKey,
  archivedEventKey,
  confirmedRegistrationIndexKeys,
  eventPartition,
  reminderAttemptIndexKeys,
  reminderAttemptKey,
  startBound,
  startKey,
  viewPartition,
} from "../../../src/operations/shared/keys.js";
import { createOperationsLogger } from "../../../src/operations/shared/logger.js";
import { archiveCutoff } from "../../../src/operations/shared/time.js";
import { seedRegistration, seedEvent, COMMUNITY_EVENT_ID } from "../support/fixtures.js";

describe("C-03 key shapes", () => {
  it("builds ReminderAttempt keys per (eventId, registrationId)", () => {
    expect(reminderAttemptKey("event-1", "reg-1")).toEqual({
      pk: "REMINDER#event-1",
      sk: "REG#reg-1",
    });
    expect(reminderAttemptIndexKeys("event-1", "reg-1", "2026-10-06T10:00:00.000Z")).toEqual({
      gsi6pk: "REMINDER#event-1#reg-1",
      gsi6sk: "SCHEDULED#2026-10-06T10:00:00.000Z",
    });
  });

  it("builds the archive marker, lifecycle, view, and object keys", () => {
    expect(archivedEventKey("event-1")).toEqual({ pk: "EVENT#event-1", sk: "ARCHIVE" });
    expect(eventPartition("event-1")).toBe("EVENT#event-1");
    expect(ACTIVE_LIFECYCLE_PARTITION).toBe("LIFECYCLE#active");
    expect(ARCHIVED_LIFECYCLE_PARTITION).toBe("LIFECYCLE#archived");
    expect(viewPartition("list")).toBe("VIEW#list");
    expect(viewPartition("detail")).toBe("VIEW#detail");
    expect(archiveObjectKey("event-1")).toBe("archive/event-1.json");
  });

  it("matches the C1 seed GSI5 shape for confirmed registrations", () => {
    expect(confirmedRegistrationIndexKeys("e", "r")).toEqual({
      gsi5pk: "REGISTRATION#EVENT#e#STATUS#confirmed",
      gsi5sk: "WAITLIST##REG#r",
    });
  });

  it("keeps the archive boundary strict: an event starting exactly at the cutoff is not eligible", () => {
    const cutoff = archiveCutoff(new Date("2024-02-29T12:00:00.000Z"));
    const upper = archiveEligibilityUpperBound(cutoff);
    expect(startKey("2023-02-28T11:59:59.999Z", "a") < upper).toBe(true);
    expect(startKey(cutoff, "a") < upper).toBe(false);
    expect(startKey("2023-02-28T12:00:00.001Z", "a") < upper).toBe(false);
    expect(startBound(cutoff)).toBe(`START#${cutoff}`);
  });
});

describe("C-05 reminder message", () => {
  const valid = {
    eventId: "seed-event-community-market",
    registrationId: "seed-registration-resident-one",
    scheduledFor: "2026-10-06T10:00:00.000Z",
  };

  it("round-trips a valid message with a fixed field order", () => {
    const body = serializeReminderMessage(valid);
    expect(body).toBe(
      '{"eventId":"seed-event-community-market","registrationId":"seed-registration-resident-one","scheduledFor":"2026-10-06T10:00:00.000Z"}',
    );
    expect(parseReminderMessage(body)).toEqual(valid);
  });

  it.each([
    ["an extra PII field", { ...valid, email: "resident.one@example.com" }],
    ["a display name", { ...valid, displayName: "Synthetic Resident One" }],
    ["a missing field", { eventId: valid.eventId, registrationId: valid.registrationId }],
    ["a non-canonical timestamp", { ...valid, scheduledFor: "2026-10-06T10:00:00Z" }],
    ["a malformed identifier", { ...valid, eventId: "EVENT#x" }],
    ["an array", [valid]],
  ])("rejects %s", (_, candidate) => {
    expect(() => validateReminderMessage(candidate)).toThrow(InvalidReminderMessageError);
  });

  it("rejects a body that is not JSON", () => {
    expect(() => parseReminderMessage("{not json")).toThrow(/not valid JSON/);
  });
});

describe("C-07 archive object", () => {
  const event = seedEvent(COMMUNITY_EVENT_ID, "2025-01-01T10:00:00.000Z");
  const registration = seedRegistration(COMMUNITY_EVENT_ID, "reg-b", "b@example.com");

  it("builds a v1 object without keys, tokens, or digests", () => {
    const archive = buildArchiveObject({
      archivedAt: "2026-10-06T00:00:00.000Z",
      event: { ...event, lifecycleStatus: "archived" },
      registrations: [registration, seedRegistration(COMMUNITY_EVENT_ID, "reg-a", "a@example.com")],
    });
    expect(archive.schemaVersion).toBe("v1");
    expect(archive.event).not.toHaveProperty("pk");
    expect(archive.event).not.toHaveProperty("gsi7pk");
    expect(archive.event.eventId).toBe(COMMUNITY_EVENT_ID);
    expect(archive.registrations.map((item) => item.registrationId)).toEqual(["reg-a", "reg-b"]);
    const text = serializeArchiveObject(archive);
    expect(text).not.toMatch(/CANCEL#|cancellationTokenDigest|cancelToken|gsi6/);
    expect(parseArchiveObject(text, COMMUNITY_EVENT_ID)).toEqual(archive);
  });

  it("drops token-like attributes and undefined values", () => {
    expect(
      sanitizeRecord({ registrationId: "r", cancelToken: "raw", note: undefined, status: "x" }),
    ).toEqual({ registrationId: "r", status: "x" });
  });

  it("rejects registrations from another event and a non-canonical archivedAt", () => {
    expect(() =>
      buildArchiveObject({
        archivedAt: "2026-10-06T00:00:00.000Z",
        event,
        registrations: [seedRegistration("other-event", "r", "x@example.com")],
      }),
    ).toThrow(/belong to the archived event/);
    expect(() => buildArchiveObject({ archivedAt: "yesterday", event, registrations: [] })).toThrow(
      /canonical/,
    );
    expect(() =>
      buildArchiveObject({ archivedAt: "2026-10-06T00:00:00.000Z", event: {}, registrations: [] }),
    ).toThrow(/no eventId/);
  });

  it.each([
    ["invalid JSON", "{", /not valid JSON/],
    ["a non-object", "[]", /JSON object/],
    ["a wrong schema version", JSON.stringify({ schemaVersion: "v2" }), /schemaVersion/],
    ["a bad archivedAt", JSON.stringify({ schemaVersion: "v1", archivedAt: "x" }), /archivedAt/],
    [
      "a missing event",
      JSON.stringify({ schemaVersion: "v1", archivedAt: "2026-10-06T00:00:00.000Z" }),
      /no event/,
    ],
    [
      "another event",
      JSON.stringify({
        schemaVersion: "v1",
        archivedAt: "2026-10-06T00:00:00.000Z",
        event: { eventId: "other" },
        registrations: [],
      }),
      /different event/,
    ],
    [
      "non-array registrations",
      JSON.stringify({
        schemaVersion: "v1",
        archivedAt: "2026-10-06T00:00:00.000Z",
        event: { eventId: COMMUNITY_EVENT_ID },
        registrations: {},
      }),
      /must be an array/,
    ],
    [
      "token material in the event",
      JSON.stringify({
        schemaVersion: "v1",
        archivedAt: "2026-10-06T00:00:00.000Z",
        event: { eventId: COMMUNITY_EVENT_ID, cancelToken: "x" },
        registrations: [],
      }),
      /event contains token/,
    ],
    [
      "token material in a registration",
      JSON.stringify({
        schemaVersion: "v1",
        archivedAt: "2026-10-06T00:00:00.000Z",
        event: { eventId: COMMUNITY_EVENT_ID },
        registrations: [{ cancellationTokenDigest: "x" }],
      }),
      /registrations contain token/,
    ],
  ])("rejects a stored object with %s", (_, text, message) => {
    expect(() => parseArchiveObject(text, COMMUNITY_EVENT_ID)).toThrow(message);
  });
});

describe("operations logger", () => {
  it("writes one JSON line per call with its level", () => {
    const lines: string[] = [];
    const logger = createOperationsLogger((line) => lines.push(line));
    logger.info({ event: "A", count: 1 });
    logger.warn({ event: "B" });
    logger.error({ event: "C" });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { level: "info", event: "A", count: 1 },
      { level: "warn", event: "B" },
      { level: "error", event: "C" },
    ]);
  });
});
