import { beforeEach, describe, expect, it } from "vitest";
import { ArchivalRepository } from "../../../src/operations/archival/archival-repository.js";
import { ArchivalService } from "../../../src/operations/archival/archival-service.js";
import { parseArchiveObject } from "../../../src/operations/archival/archive-object.js";
import { awsError, FakeDynamoDb } from "../support/fake-dynamodb.js";
import { FakeArchiveStore, fixedClock, recordingLogger } from "../support/fakes.js";
import {
  ARCHIVE_CANDIDATE_ID,
  COMMUNITY_EVENT_ID,
  seedDataset,
  seedEvent,
  seedRegistration,
  withLifecycle,
} from "../support/fixtures.js";

const TABLE = "team32-ceb-events";
const DEPLOYED_AT = new Date("2026-10-05T12:00:00.000Z");
const RUN_AT = "2026-10-05T12:05:00.000Z";
const KEY = `archive/${ARCHIVE_CANDIDATE_ID}.json`;

let fake: FakeDynamoDb;
let store: FakeArchiveStore;

function service(now = RUN_AT) {
  const { logger, lines } = recordingLogger();
  return {
    lines,
    service: new ArchivalService({
      repository: new ArchivalRepository(fake.asClient(), TABLE),
      store,
      clock: fixedClock(now),
      logger,
    }),
  };
}

beforeEach(() => {
  fake = new FakeDynamoDb(TABLE);
  store = new FakeArchiveStore();
});

describe("ArchivalService (C-06/C-07 v1)", () => {
  it("archives the seeded older-than-one-year event and leaves current events alone", async () => {
    fake.seed([
      ...seedDataset(DEPLOYED_AT),
      seedRegistration(ARCHIVE_CANDIDATE_ID, "old-reg-1", "old1@example.com"),
      seedRegistration(ARCHIVE_CANDIDATE_ID, "old-reg-2", "old2@example.com", "cancelled"),
    ]);
    const { service: subject, lines } = service();
    expect(await subject.run("postDeploy")).toEqual({
      scanned: 1,
      archived: 1,
      skippedAlreadyArchived: 0,
      failures: 0,
    });
    const archive = parseArchiveObject(store.objects.get(KEY) ?? "", ARCHIVE_CANDIDATE_ID);
    expect(archive).toMatchObject({ schemaVersion: "v1", archivedAt: RUN_AT });
    expect(archive.event).toMatchObject({
      eventId: ARCHIVE_CANDIDATE_ID,
      lifecycleStatus: "archived",
    });
    expect(archive.registrations.map((item) => item.registrationId)).toEqual([
      "old-reg-1",
      "old-reg-2",
    ]);
    expect(store.objects.get(KEY)).not.toMatch(/CANCEL#|cancellationTokenDigest|cancelToken/);
    expect(fake.get(`EVENT#${ARCHIVE_CANDIDATE_ID}`, "META")).toBeUndefined();
    expect(fake.all().filter((item) => item.eventId === ARCHIVE_CANDIDATE_ID)).toEqual([
      expect.objectContaining({ sk: "ARCHIVE", archiveReference: KEY, registrationCount: 2 }),
    ]);
    expect(fake.get(`EVENT#${COMMUNITY_EVENT_ID}`, "META")).toMatchObject({
      lifecycleStatus: "active",
    });
    expect(lines.at(-1)).toMatchObject({ level: "info", event: "ARCHIVAL_COMPLETED", archived: 1 });
  });

  it("is idempotent: a rerun finds nothing, and a re-seeded event overwrites the same key", async () => {
    fake.seed(seedDataset(DEPLOYED_AT));
    await service().service.run("postDeploy");
    expect(await service().service.run("scheduled")).toEqual({
      scanned: 0,
      archived: 0,
      skippedAlreadyArchived: 0,
      failures: 0,
    });
    // The C1 seed loader recreates the absent META on the next pipeline run.
    fake.seed(seedDataset(DEPLOYED_AT).filter((item) => item.eventId === ARCHIVE_CANDIDATE_ID));
    expect(await service("2026-10-06T12:05:00.000Z").service.run("postDeploy")).toMatchObject({
      archived: 1,
    });
    expect(store.writes).toBe(2);
    expect([...store.objects.keys()]).toEqual([KEY]);
  });

  it("deletes nothing when the S3 write fails, counts the failure, and resumes next run", async () => {
    fake.seed([
      ...seedDataset(DEPLOYED_AT),
      seedRegistration(ARCHIVE_CANDIDATE_ID, "old-reg-1", "old1@example.com"),
    ]);
    store.failNext(awsError("ServiceUnavailable", "s3 down"));
    const { service: subject, lines } = service();
    expect(await subject.run("postDeploy")).toEqual({
      scanned: 1,
      archived: 0,
      skippedAlreadyArchived: 0,
      failures: 1,
    });
    expect(fake.get(`EVENT#${ARCHIVE_CANDIDATE_ID}`, "META")).toMatchObject({
      lifecycleStatus: "archived",
      archivedAt: RUN_AT,
    });
    expect(fake.get(`EVENT#${ARCHIVE_CANDIDATE_ID}`, "REG#old1@example.com")).toBeDefined();
    expect(lines.find((line) => line.event === "ARCHIVAL_EVENT_FAILED")).toMatchObject({
      eventId: ARCHIVE_CANDIDATE_ID,
      errorName: "ServiceUnavailable",
    });
    expect(lines.at(-1)).toMatchObject({ level: "error", failures: 1 });

    // The next run resumes the frozen event first and reuses the freeze time.
    expect(await service("2026-10-06T00:00:00.000Z").service.run("scheduled")).toEqual({
      scanned: 1,
      archived: 1,
      skippedAlreadyArchived: 0,
      failures: 0,
    });
    expect(parseArchiveObject(store.objects.get(KEY) ?? "", ARCHIVE_CANDIDATE_ID).archivedAt).toBe(
      RUN_AT,
    );
    expect(fake.get(`EVENT#${ARCHIVE_CANDIDATE_ID}`, "REG#old1@example.com")).toBeUndefined();
  });

  it("counts an event another invocation froze first as skippedAlreadyArchived", async () => {
    fake.seed(seedDataset(DEPLOYED_AT));
    // A concurrent invocation freezes the event between our GSI read and freeze.
    let raced = false;
    const originalSend = fake.send.bind(fake);
    fake.send = async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      if (!raced && name === "UpdateCommand") {
        raced = true;
        const meta = fake.get(`EVENT#${ARCHIVE_CANDIDATE_ID}`, "META") ?? {};
        fake.seed([withLifecycle(meta, "archived")]);
      }
      return originalSend(command);
    };
    expect(await service().service.run("postDeploy")).toEqual({
      scanned: 1,
      archived: 0,
      skippedAlreadyArchived: 1,
      failures: 0,
    });
    expect(store.writes).toBe(0);
  });

  it("treats a resumable event whose META is already gone as already archived", async () => {
    fake.seed([withLifecycle(seedEvent("finished", "2020-01-01T00:00:00.000Z"), "archived")]);
    const repository = new ArchivalRepository(fake.asClient(), TABLE);
    // The GSI7 view lags: an earlier run's finalization already deleted META.
    repository.getEvent = async () => undefined;
    const { logger } = recordingLogger();
    const subject = new ArchivalService({
      repository,
      store,
      clock: fixedClock(RUN_AT),
      logger,
    });
    expect(await subject.run("scheduled")).toEqual({
      scanned: 1,
      archived: 0,
      skippedAlreadyArchived: 1,
      failures: 0,
    });
  });

  it("skips events that stopped being eligible and fails loudly on unexpected state", async () => {
    fake.seed([
      seedEvent("rescheduled", "2020-01-01T00:00:00.000Z"),
      withLifecycle(seedEvent("odd", "2020-01-01T00:00:00.000Z"), "archived"),
    ]);
    // "rescheduled" is moved into the future after the eligibility query.
    let moved = false;
    const originalSend = fake.send.bind(fake);
    fake.send = async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      if (!moved && name === "UpdateCommand") {
        moved = true;
        const meta = fake.get("EVENT#rescheduled", "META") ?? {};
        fake.seed([{ ...meta, startsAt: "2030-01-01T00:00:00.000Z" }]);
      }
      if (name === "GetCommand") {
        // "odd" was reactivated outside the archival path.
        const meta = fake.get("EVENT#odd", "META");
        if (meta) fake.seed([{ ...meta, lifecycleStatus: "active" }]);
      }
      return originalSend(command);
    };
    const { service: subject, lines } = service();
    expect(await subject.run("scheduled")).toEqual({
      scanned: 2,
      archived: 0,
      skippedAlreadyArchived: 0,
      failures: 1,
    });
    expect(lines.find((line) => line.event === "ARCHIVAL_NOT_ELIGIBLE")).toMatchObject({
      eventId: "rescheduled",
    });
    expect(lines.find((line) => line.event === "ARCHIVAL_EVENT_FAILED")).toMatchObject({
      eventId: "odd",
      code: "NOT_FROZEN",
    });
  });

  it("propagates a failed eligibility query instead of reporting zero work", async () => {
    fake.failNext("QueryCommand", awsError("InternalServerError", "boom"));
    await expect(service().service.run("postDeploy")).rejects.toThrow(/boom/);
  });

  it("uses the leap-day clamp for the cutoff", async () => {
    fake.seed([
      seedEvent("just-older", "2023-02-28T11:59:59.999Z"),
      seedEvent("exactly-cutoff", "2023-02-28T12:00:00.000Z"),
    ]);
    expect(await service("2024-02-29T12:00:00.000Z").service.run("scheduled")).toMatchObject({
      scanned: 1,
      archived: 1,
    });
    expect(fake.get("EVENT#exactly-cutoff", "META")).toMatchObject({ lifecycleStatus: "active" });
  });
});
