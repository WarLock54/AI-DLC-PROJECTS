import { PutObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it } from "vitest";
import { ArchivalRepository } from "../../../src/operations/archival/archival-repository.js";
import { S3ArchiveStore } from "../../../src/operations/archival/archive-store.js";
import { ReminderRepository } from "../../../src/operations/reminders/reminder-repository.js";
import { StatisticsRepository } from "../../../src/operations/statistics/statistics-repository.js";
import { archiveCutoff } from "../../../src/operations/shared/time.js";
import { awsError, FakeDynamoDb } from "../support/fake-dynamodb.js";
import {
  ARCHIVE_CANDIDATE_ID,
  COMMUNITY_EVENT_ID,
  seedDataset,
  seedEvent,
  seedRegistration,
  seedView,
  withLifecycle,
} from "../support/fixtures.js";

const TABLE = "team32-ceb-events";
const DEPLOYED_AT = new Date("2026-10-05T12:00:00.000Z");

let fake: FakeDynamoDb;

beforeEach(() => {
  fake = new FakeDynamoDb(TABLE);
});

describe("ReminderRepository", () => {
  const window = { from: "2026-10-06T11:45:00.000Z", to: "2026-10-06T12:15:00.000Z" };

  it("finds active events in the half-open window across pages", async () => {
    fake.queryPageSize = 1;
    fake.seed([
      seedEvent("at-from", window.from),
      seedEvent("inside", "2026-10-06T12:00:00.000Z"),
      seedEvent("at-to", window.to),
      seedEvent("before", "2026-10-06T11:44:59.999Z"),
      withLifecycle(seedEvent("deleted", "2026-10-06T12:01:00.000Z"), "deleted"),
    ]);
    const repository = new ReminderRepository(fake.asClient(), TABLE);
    const events = await repository.findActiveEventsStartingIn(window);
    expect(events.map((event) => event.eventId)).toEqual(["at-from", "inside"]);
    expect(fake.commandsNamed("QueryCommand").length).toBeGreaterThan(2);
  });

  it("reads every confirmed registration and looks one up by registration id", async () => {
    fake.queryPageSize = 1;
    fake.seed([
      seedRegistration("e1", "r1", "one@example.com"),
      seedRegistration("e1", "r2", "two@example.com"),
      seedRegistration("e1", "r3", "three@example.com", "waitlisted", "2026-10-01T00:00:00.000Z"),
      seedRegistration("e1", "r4", "four@example.com", "cancelled"),
    ]);
    const repository = new ReminderRepository(fake.asClient(), TABLE);
    const confirmed = await repository.findConfirmedRegistrations("e1");
    expect(confirmed.map((item) => item.registrationId).sort()).toEqual(["r1", "r2"]);
    expect(await repository.findConfirmedRegistration("e1", "r2")).toEqual({
      eventId: "e1",
      registrationId: "r2",
      normalizedEmail: "two@example.com",
    });
    expect(await repository.findConfirmedRegistration("e1", "r3")).toBeUndefined();
    expect(await repository.findConfirmedRegistration("e1", "r4")).toBeUndefined();
  });

  it("creates one attempt per registration and detects duplicates", async () => {
    const repository = new ReminderRepository(fake.asClient(), TABLE);
    const attempt = {
      eventId: "e1",
      registrationId: "r1",
      scheduledFor: "2026-10-05T12:00:00.000Z",
      createdAt: "2026-10-05T11:50:00.000Z",
    };
    expect(await repository.createAttempt(attempt)).toBe(true);
    expect(await repository.createAttempt(attempt)).toBe(false);
    expect(fake.get("REMINDER#e1", "REG#r1")).toMatchObject({
      gsi6pk: "REMINDER#e1#r1",
      gsi6sk: "SCHEDULED#2026-10-05T12:00:00.000Z",
      outcome: "queued",
      entityType: "ReminderAttempt",
    });
    expect(await repository.getAttempt("e1", "r1")).toEqual({
      eventId: "e1",
      registrationId: "r1",
      scheduledFor: "2026-10-05T12:00:00.000Z",
      outcome: "queued",
    });
  });

  it("records an outcome, deletes only queued attempts, and surfaces other errors", async () => {
    const repository = new ReminderRepository(fake.asClient(), TABLE);
    await repository.createAttempt({
      eventId: "e1",
      registrationId: "r1",
      scheduledFor: "2026-10-05T12:00:00.000Z",
      createdAt: "2026-10-05T11:50:00.000Z",
    });
    await repository.recordOutcome("e1", "r1", "sent", "2026-10-05T12:01:00.000Z", "delivered");
    expect(fake.get("REMINDER#e1", "REG#r1")).toMatchObject({
      outcome: "sent",
      deliveredAt: "2026-10-05T12:01:00.000Z",
      outcomeReason: "delivered",
    });
    await expect(repository.deleteQueuedAttempt("e1", "r1")).rejects.toThrow(/conditional/);
    await expect(
      repository.recordOutcome("e1", "missing", "skipped", "2026-10-05T12:01:00.000Z", "x"),
    ).rejects.toThrow(/conditional/);
    fake.failNext("PutCommand", awsError("ProvisionedThroughputExceededException", "slow down"));
    await expect(
      repository.createAttempt({
        eventId: "e1",
        registrationId: "r2",
        scheduledFor: "2026-10-05T12:00:00.000Z",
        createdAt: "2026-10-05T11:50:00.000Z",
      }),
    ).rejects.toThrow(/slow down/);
    expect(await repository.getAttempt("e1", "r2")).toBeUndefined();
  });

  it("reads Event META strongly consistently", async () => {
    fake.seed(seedDataset(DEPLOYED_AT));
    const repository = new ReminderRepository(fake.asClient(), TABLE);
    expect(await repository.getEvent(COMMUNITY_EVENT_ID)).toMatchObject({
      eventId: COMMUNITY_EVENT_ID,
      lifecycleStatus: "active",
      title: "Community Market",
    });
    expect(await repository.getEvent("missing")).toBeUndefined();
    expect(fake.commandsNamed("GetCommand")[0].input.ConsistentRead).toBe(true);
  });
});

describe("StatisticsRepository", () => {
  it("lists active event counters across pages, defaulting waitlistCount to 0", async () => {
    fake.queryPageSize = 1;
    fake.seed([
      ...seedDataset(DEPLOYED_AT),
      seedEvent("with-waitlist", "2026-11-01T00:00:00.000Z", {
        category: "Sports",
        confirmedRsvpCount: 2,
        waitlistCount: 3,
      }),
      withLifecycle(
        seedEvent("gone", "2026-11-02T00:00:00.000Z", { confirmedRsvpCount: 9 }),
        "deleted",
      ),
    ]);
    const repository = new StatisticsRepository(fake.asClient(), TABLE);
    const counters = await repository.listActiveEventCounters();
    expect(counters.sort((a, b) => (a.eventId < b.eventId ? -1 : 1))).toEqual([
      {
        eventId: ARCHIVE_CANDIDATE_ID,
        category: "Community",
        confirmedRsvpCount: 0,
        waitlistCount: 0,
      },
      {
        eventId: COMMUNITY_EVENT_ID,
        category: "Community",
        confirmedRsvpCount: 1,
        waitlistCount: 0,
      },
      { eventId: "with-waitlist", category: "Sports", confirmedRsvpCount: 2, waitlistCount: 3 },
    ]);
  });

  it("counts views per type with Select COUNT across pages", async () => {
    fake.queryPageSize = 2;
    fake.seed([
      seedView("v1", "list", "2026-10-05T12:00:00.000Z"),
      seedView("v2", "list", "2026-10-05T12:00:01.000Z"),
      seedView("v3", "list", "2026-10-05T12:00:02.000Z"),
      seedView("v4", "detail", "2026-10-05T12:00:03.000Z"),
    ]);
    const repository = new StatisticsRepository(fake.asClient(), TABLE);
    expect(await repository.countViews("list")).toBe(3);
    expect(await repository.countViews("detail")).toBe(1);
    const queries = fake.commandsNamed("QueryCommand");
    expect(queries.every((query) => query.input.Select === "COUNT")).toBe(true);
    expect(queries.length).toBe(3);
  });

  it("rejects corrupt counters and surfaces query failures", async () => {
    fake.seed([seedEvent("bad", "2026-11-01T00:00:00.000Z", { confirmedRsvpCount: -1 })]);
    const repository = new StatisticsRepository(fake.asClient(), TABLE);
    await expect(repository.listActiveEventCounters()).rejects.toThrow(/invalid RSVP counter/);
    fake.failNext("QueryCommand", awsError("InternalServerError", "boom"));
    await expect(repository.countViews("list")).rejects.toThrow(/boom/);
  });
});

describe("ArchivalRepository", () => {
  const now = new Date("2026-10-06T00:00:00.000Z");
  const cutoff = archiveCutoff(now);

  it("finds strictly older active events and resumable archived events", async () => {
    fake.queryPageSize = 1;
    fake.seed([
      ...seedDataset(DEPLOYED_AT),
      seedEvent("exactly-cutoff", cutoff),
      withLifecycle(seedEvent("half-done", "2020-01-01T00:00:00.000Z"), "archived"),
    ]);
    const repository = new ArchivalRepository(fake.asClient(), TABLE);
    expect((await repository.findEligibleEvents(cutoff)).map((event) => event.eventId)).toEqual([
      ARCHIVE_CANDIDATE_ID,
    ]);
    expect((await repository.findResumableEvents()).map((event) => event.eventId)).toEqual([
      "half-done",
    ]);
  });

  it("freezes an eligible event once and reports why a second freeze fails", async () => {
    fake.seed([
      ...seedDataset(DEPLOYED_AT),
      withLifecycle(seedEvent("deleted-old", "2020-01-01T00:00:00.000Z"), "deleted"),
    ]);
    const repository = new ArchivalRepository(fake.asClient(), TABLE);
    const at = now.toISOString();
    expect(await repository.freeze(ARCHIVE_CANDIDATE_ID, cutoff, at)).toBe("frozen");
    const frozen = fake.get(`EVENT#${ARCHIVE_CANDIDATE_ID}`, "META");
    expect(frozen).toMatchObject({
      lifecycleStatus: "archived",
      gsi7pk: "LIFECYCLE#archived",
      archivedAt: at,
    });
    expect(frozen).not.toHaveProperty("gsi1pk");
    expect(frozen).not.toHaveProperty("gsi3sk");
    expect(await repository.freeze(ARCHIVE_CANDIDATE_ID, cutoff, at)).toBe("already-archived");
    expect(await repository.freeze("deleted-old", cutoff, at)).toBe("not-eligible");
    // An event rescheduled after the GSI read is no longer older than the cutoff.
    expect(await repository.freeze(COMMUNITY_EVENT_ID, cutoff, at)).toBe("not-eligible");
    expect(await repository.freeze("missing", cutoff, at)).toBe("not-eligible");
  });

  it("reads every registration strongly consistently across pages, including cancelled ones", async () => {
    fake.queryPageSize = 2;
    fake.seed([
      seedEvent("e1", "2020-01-01T00:00:00.000Z"),
      seedRegistration("e1", "r1", "a@example.com"),
      seedRegistration("e1", "r2", "b@example.com", "waitlisted", "2019-12-01T00:00:00.000Z"),
      seedRegistration("e1", "r3", "c@example.com", "cancelled"),
      seedRegistration("e2", "r4", "d@example.com"),
    ]);
    const repository = new ArchivalRepository(fake.asClient(), TABLE);
    const registrations = await repository.readRegistrations("e1");
    expect(registrations.map((item) => item.registrationId).sort()).toEqual(["r1", "r2", "r3"]);
    const queries = fake.commandsNamed("QueryCommand");
    expect(queries.every((query) => query.input.ConsistentRead === true)).toBe(true);
    expect(queries.length).toBeGreaterThan(1);
  });

  it("deletes registrations in batches of at most 25", async () => {
    const registrations = Array.from({ length: 60 }, (_, index) =>
      seedRegistration("e1", `r${index}`, `user${index}@example.com`),
    );
    fake.seed(registrations);
    const repository = new ArchivalRepository(fake.asClient(), TABLE);
    expect(await repository.deleteRegistrations(registrations)).toBe(60);
    const sizes = fake
      .commandsNamed("TransactWriteCommand")
      .map((command) => (command.input.TransactItems as unknown[]).length);
    expect(sizes).toEqual([25, 25, 10]);
    expect(fake.all()).toEqual([]);
  });

  it("finalizes atomically: marker and META removal happen together or not at all", async () => {
    fake.seed([withLifecycle(seedEvent("e1", "2020-01-01T00:00:00.000Z"), "archived")]);
    fake.seed([seedEvent("e2", "2020-01-01T00:00:00.000Z")]);
    const repository = new ArchivalRepository(fake.asClient(), TABLE);
    await repository.finalize({
      eventId: "e1",
      archivedAt: now.toISOString(),
      archiveReference: "archive/e1.json",
      registrationCount: 2,
    });
    expect(fake.get("EVENT#e1", "META")).toBeUndefined();
    expect(fake.get("EVENT#e1", "ARCHIVE")).toMatchObject({
      entityType: "ArchivedEvent",
      archiveReference: "archive/e1.json",
      registrationCount: 2,
    });
    // e2 is still active, so the transaction is cancelled and no marker appears.
    await expect(
      repository.finalize({
        eventId: "e2",
        archivedAt: now.toISOString(),
        archiveReference: "archive/e2.json",
        registrationCount: 0,
      }),
    ).rejects.toThrow(/Transaction cancelled/);
    expect(fake.get("EVENT#e2", "ARCHIVE")).toBeUndefined();
    expect(fake.get("EVENT#e2", "META")).toBeDefined();
  });

  it("surfaces non-conditional errors from freeze", async () => {
    fake.failNext("UpdateCommand", awsError("InternalServerError", "boom"));
    const repository = new ArchivalRepository(fake.asClient(), TABLE);
    await expect(repository.freeze("e1", cutoff, now.toISOString())).rejects.toThrow(/boom/);
    expect(await repository.getEvent("e1")).toBeUndefined();
  });
});

describe("S3ArchiveStore", () => {
  it("puts JSON under archive/ and rejects other prefixes", async () => {
    const sent: PutObjectCommand[] = [];
    const store = new S3ArchiveStore(
      {
        send: (async (command: PutObjectCommand) => {
          sent.push(command);
          return {};
        }) as never,
      },
      "team32-ceb-archive-bucket",
    );
    await store.putObject("archive/e1.json", "{}");
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent[0].input).toMatchObject({
      Bucket: "team32-ceb-archive-bucket",
      Key: "archive/e1.json",
      ContentType: "application/json",
    });
    await expect(store.putObject("banners/e1.json", "{}")).rejects.toThrow(/archive\/ prefix/);
  });
});
