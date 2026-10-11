import { describe, expect, it } from "vitest";
import { eventItem, fakeWithSeed, SEED_EVENT_ID } from "../support/fixtures.js";
import { buildServices, captureApiError } from "../support/services.js";

function setup() {
  const fake = fakeWithSeed();
  fake.seed([
    eventItem({
      eventId: "music-hall",
      startsAt: "2030-02-01T18:00:00.000Z",
      category: "Music",
      location: "Town Hall",
    }),
    eventItem({
      eventId: "music-park",
      startsAt: "2030-02-02T18:00:00.000Z",
      category: "Music",
      location: "Riverside Park",
    }),
    eventItem({
      eventId: "sport-park",
      startsAt: "2030-02-01T09:00:00.000Z",
      category: "Sport",
      location: "Riverside Park",
    }),
    eventItem({ eventId: "deleted-one", lifecycleStatus: "deleted" }),
  ]);
  return { fake, ...buildServices(fake) };
}

async function ids(promise: Promise<{ events: { eventId: string }[] }>): Promise<string[]> {
  return (await promise).events.map((event) => event.eventId);
}

describe("DiscoveryService (FR1, FR2, US1.1, US1.2)", () => {
  it("lists only active upcoming events ordered by start time", async () => {
    const { discovery } = setup();
    expect(await ids(discovery.listEvents({}))).toEqual([
      SEED_EVENT_ID,
      "sport-park",
      "music-hall",
      "music-park",
    ]);
  });

  it("filters by category, location, and both together", async () => {
    const { discovery } = setup();
    expect(await ids(discovery.listEvents({ category: "Music" }))).toEqual([
      "music-hall",
      "music-park",
    ]);
    expect(await ids(discovery.listEvents({ location: "Riverside Park" }))).toEqual([
      "sport-park",
      "music-park",
    ]);
    expect(
      await ids(discovery.listEvents({ category: "Music", location: " Riverside Park " })),
    ).toEqual(["music-park"]);
    expect(await ids(discovery.listEvents({ category: "", location: "" }))).toHaveLength(4);
  });

  it("filters by UTC calendar day and follows every query page", async () => {
    const { fake, discovery } = setup();
    fake.queryPageSize = 1;
    expect(await ids(discovery.listEvents({ date: "2030-02-01" }))).toEqual([
      "sport-park",
      "music-hall",
    ]);
    expect(await ids(discovery.listEvents({ date: "2030-02-01", category: "Sport" }))).toEqual([
      "sport-park",
    ]);
    expect(await ids(discovery.listEvents({ date: "2031-01-01" }))).toEqual([]);
  });

  it("rejects invalid dates and over-length filters with 400 naming the field", async () => {
    const { discovery } = setup();
    for (const date of ["2030-02-30", "01/02/2030", "2030-2-1", "tomorrow"]) {
      expect(await captureApiError(discovery.listEvents({ date }))).toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        field: "date",
      });
    }
    expect(
      await captureApiError(discovery.listEvents({ location: "x".repeat(101) })),
    ).toMatchObject({ field: "location" });
  });

  it("serves any active event by its stable URL, including past ones, else 404", async () => {
    const { discovery } = setup();
    await expect(discovery.getEvent("seed-event-archive-candidate")).resolves.toMatchObject({
      eventId: "seed-event-archive-candidate",
      title: "Historical Community Meetup",
    });
    for (const eventId of ["unknown-event", "deleted-one", "../etc"]) {
      expect(await captureApiError(discovery.getEvent(eventId))).toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
        field: "id",
      });
    }
  });

  it("returns the detail fields residents need for the event page", async () => {
    const { discovery } = setup();
    expect(await discovery.getEvent(SEED_EVENT_ID)).toEqual({
      eventId: SEED_EVENT_ID,
      title: "Community Market",
      description: "Synthetic event fixture for foundation verification.",
      startsAt: "2030-01-16T12:00:00.000Z",
      location: "Community Hall",
      category: "Community",
      capacity: 50,
      confirmedRsvpCount: 1,
      bannerReference: null,
    });
  });

  it("never exposes owner, registration, or email data publicly", async () => {
    const { discovery } = setup();
    const payload = JSON.stringify([
      await discovery.listEvents({}),
      await discovery.getEvent(SEED_EVENT_ID),
    ]);
    for (const forbidden of ["organizerSubject", "11111111-1111", "@example.com", "REG#", "gsi"]) {
      expect(payload).not.toContain(forbidden);
    }
  });
});
