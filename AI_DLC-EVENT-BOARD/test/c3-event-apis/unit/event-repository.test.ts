import { describe, expect, it } from "vitest";
import { EventRepository, toEventRecord } from "../../../src/event-api/events/event-repository.js";
import { ApiError } from "../../../src/event-api/http/errors.js";
import { awsError } from "../support/fake-dynamodb.js";
import {
  eventItem,
  fakeWithSeed,
  ORGANIZER,
  OTHER_ORGANIZER,
  SEED_EVENT_ID,
  TABLE_NAME,
} from "../support/fixtures.js";

const UPDATE = {
  title: "Community Market Updated",
  description: "Updated synthetic description.",
  startsAt: "2030-03-01T09:00:00.000Z",
  location: "Town Square",
  category: "Market",
  capacity: 60,
};

function setup() {
  const fake = fakeWithSeed();
  return { fake, repository: new EventRepository(fake.asClient(), TABLE_NAME) };
}

describe("EventRepository", () => {
  it("creates an event once under attribute_not_exists and reads it back consistently", async () => {
    const { fake, repository } = setup();
    const record = toEventRecord(eventItem({ eventId: "new-event" }));
    await repository.create(record);
    const put = fake.commandsNamed("PutCommand")[0].input;
    expect(put.ConditionExpression).toBe("attribute_not_exists(#pk)");
    expect(fake.get("EVENT#new-event", "META")).toMatchObject({
      gsi1pk: "EVENT#ACTIVE",
      gsi7pk: "LIFECYCLE#active",
      schemaVersion: 1,
    });
    await expect(repository.get("new-event")).resolves.toEqual(record);
    expect(fake.commandsNamed("GetCommand")[0].input.ConsistentRead).toBe(true);
    await expect(repository.create(record)).rejects.toMatchObject({
      name: "ConditionalCheckFailedException",
    });
  });

  it("updates the C1 seed event and rewrites every START#-derived index key", async () => {
    const { fake, repository } = setup();
    const updated = await repository.update(
      SEED_EVENT_ID,
      ORGANIZER,
      UPDATE,
      "2030-01-15T12:00:00.000Z",
    );
    expect(updated).toMatchObject({ ...UPDATE, confirmedRsvpCount: 1, lifecycleStatus: "active" });
    const sortKey = `START#2030-03-01T09:00:00.000Z#EVENT#${SEED_EVENT_ID}`;
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "META")).toMatchObject({
      gsi1sk: sortKey,
      gsi2pk: "CATEGORY#Market#ACTIVE",
      gsi2sk: sortKey,
      gsi3pk: "LOCATION#Town Square#ACTIVE",
      gsi3sk: sortKey,
      gsi4pk: `ORGANIZER#${ORGANIZER}`,
      gsi4sk: sortKey,
      gsi7sk: sortKey,
    });
    expect(fake.commandsNamed("UpdateCommand")[0].input.ConditionExpression).toBe(
      "attribute_exists(#pk) AND #lifecycleStatus = :active AND #confirmedRsvpCount <= :capacity",
    );
  });

  it("maps a capacity below confirmed RSVPs to CAPACITY_CONFLICT from the ALL_OLD item", async () => {
    const { fake, repository } = setup();
    fake.seed([eventItem({ eventId: "full", capacity: 5, confirmedRsvpCount: 4 })]);
    const failure = await repository
      .update("full", ORGANIZER, { ...UPDATE, capacity: 3 }, "2030-01-15T12:00:00.000Z")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).toBody()).toEqual({
      code: "CAPACITY_CONFLICT",
      message: "capacity cannot be lower than the 4 confirmed RSVPs.",
      field: "capacity",
    });
    await expect(
      repository.update("full", ORGANIZER, { ...UPDATE, capacity: 4 }, "2030-01-15T12:00:00.000Z"),
    ).resolves.toMatchObject({ capacity: 4 });
  });

  it("maps updates of missing or deleted events to NOT_FOUND", async () => {
    const { fake, repository } = setup();
    fake.seed([eventItem({ eventId: "gone", lifecycleStatus: "deleted" })]);
    for (const eventId of ["missing", "gone"]) {
      await expect(
        repository.update(eventId, ORGANIZER, UPDATE, "2030-01-15T12:00:00.000Z"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("soft-deletes by removing GSI1-GSI3 and moving GSI7, then blocks further changes", async () => {
    const { fake, repository } = setup();
    await repository.softDelete(SEED_EVENT_ID, "2030-01-15T12:00:00.000Z");
    const item = fake.get(`EVENT#${SEED_EVENT_ID}`, "META") ?? {};
    for (const removed of ["gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk", "gsi3pk", "gsi3sk"]) {
      expect(item[removed]).toBeUndefined();
    }
    expect(item).toMatchObject({ lifecycleStatus: "deleted", gsi7pk: "LIFECYCLE#deleted" });
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "REG#resident.one@example.com")).toBeDefined();
    await expect(
      repository.softDelete(SEED_EVENT_ID, "2030-01-15T12:00:00.000Z"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      repository.setBannerReference(SEED_EVENT_ID, "banners/x.png", "2030-01-15T12:00:00.000Z"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists organizer and lifecycle partitions and follows every public query page", async () => {
    const { fake, repository } = setup();
    fake.seed([
      eventItem({ eventId: "mine-2", startsAt: "2030-02-02T10:00:00.000Z" }),
      eventItem({ eventId: "theirs", organizerSubject: OTHER_ORGANIZER }),
      eventItem({ eventId: "mine-deleted", lifecycleStatus: "deleted" }),
    ]);
    fake.queryPageSize = 1;
    const mine = await repository.listByOrganizer(ORGANIZER);
    expect(mine.map((event) => event.eventId).sort()).toEqual([
      "mine-2",
      "seed-event-archive-candidate",
      SEED_EVENT_ID,
    ]);
    const others = await repository.listByLifecycle("active", OTHER_ORGANIZER);
    expect(others.map((event) => event.eventId)).toEqual(["theirs"]);
    const all = await repository.queryPublic({
      index: "GSI1",
      partitionKey: "EVENT#ACTIVE",
      fromSortKey: "START#",
      toSortKey: "START#~",
    });
    expect(all.map((event) => event.eventId)).toEqual([
      "seed-event-archive-candidate",
      SEED_EVENT_ID,
      "theirs",
      "mine-2",
    ]);
    expect(fake.commandsNamed("QueryCommand").length).toBeGreaterThan(5);
  });

  it("propagates unexpected SDK errors instead of mapping them", async () => {
    const { fake, repository } = setup();
    fake.failNext("UpdateCommand", awsError("ProvisionedThroughputExceededException", "slow down"));
    await expect(
      repository.update(SEED_EVENT_ID, ORGANIZER, UPDATE, "2030-01-15T12:00:00.000Z"),
    ).rejects.toMatchObject({ name: "ProvisionedThroughputExceededException" });
    fake.failNext("UpdateCommand", awsError("InternalServerError", "boom"));
    await expect(repository.softDelete(SEED_EVENT_ID, "x")).rejects.toMatchObject({
      name: "InternalServerError",
    });
    fake.failNext("UpdateCommand", awsError("InternalServerError", "boom"));
    await expect(repository.setBannerReference(SEED_EVENT_ID, "k", "x")).rejects.toMatchObject({
      name: "InternalServerError",
    });
  });
});
