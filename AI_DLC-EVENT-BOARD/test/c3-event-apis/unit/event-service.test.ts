import { describe, expect, it } from "vitest";
import { eventItem, fakeWithSeed, ADMIN, ORGANIZER, OTHER_ORGANIZER } from "../support/fixtures.js";
import {
  adminClaims,
  buildServices,
  captureApiError,
  organizerClaims,
  otherOrganizerClaims,
  residentClaims,
} from "../support/services.js";

const PAYLOAD = {
  title: "Park Cleanup",
  description: "Synthetic cleanup event.",
  startsAt: "2030-02-01T10:00:00.000Z",
  location: "Riverside Park",
  category: "Volunteering",
  capacity: 10,
};

function setup() {
  const fake = fakeWithSeed();
  return { fake, ...buildServices(fake) };
}

describe("EventService (FR3, US2.2, US3.1)", () => {
  it("creates an organizer-owned active event visible in the public list and detail", async () => {
    const { fake, events, discovery } = setup();
    const created = await events.create(organizerClaims, PAYLOAD);
    expect(created).toMatchObject({
      ...PAYLOAD,
      eventId: "event-0001",
      organizerSubject: ORGANIZER,
      lifecycleStatus: "active",
      confirmedRsvpCount: 0,
      bannerReference: null,
    });
    expect(fake.get("EVENT#event-0001", "META")).toMatchObject({
      gsi1pk: "EVENT#ACTIVE",
      gsi4pk: `ORGANIZER#${ORGANIZER}`,
      gsi7pk: "LIFECYCLE#active",
      waitlistCount: 0,
    });
    const list = await discovery.listEvents({});
    expect(list.events.map((event) => event.eventId)).toContain("event-0001");
    await expect(discovery.getEvent("event-0001")).resolves.toMatchObject(PAYLOAD);
  });

  it("records the admin as owner of an admin-created event", async () => {
    const { events } = setup();
    const created = await events.create(adminClaims, PAYLOAD);
    expect(created.organizerSubject).toBe(ADMIN);
  });

  it("updates owned events (and any event for admins), rewriting the public indexes", async () => {
    const { events, discovery } = setup();
    const created = await events.create(organizerClaims, PAYLOAD);
    const changed = { ...PAYLOAD, category: "Environment", location: "North Park", capacity: 12 };
    await expect(events.update(organizerClaims, created.eventId, changed)).resolves.toMatchObject(
      changed,
    );
    await expect(discovery.getEvent(created.eventId)).resolves.toMatchObject(changed);
    const byCategory = await discovery.listEvents({ category: "Environment" });
    expect(byCategory.events.map((event) => event.eventId)).toEqual([created.eventId]);
    expect((await discovery.listEvents({ category: "Volunteering" })).events).toEqual([]);
    const adminChange = { ...changed, title: "Admin Corrected Title" };
    await expect(events.update(adminClaims, created.eventId, adminChange)).resolves.toMatchObject({
      title: "Admin Corrected Title",
      organizerSubject: ORGANIZER,
    });
  });

  it("rejects reducing capacity below confirmed RSVPs with 409 CAPACITY_CONFLICT", async () => {
    const { fake, events } = setup();
    fake.seed([eventItem({ eventId: "busy", capacity: 5, confirmedRsvpCount: 3 })]);
    expect(
      await captureApiError(events.update(organizerClaims, "busy", { ...PAYLOAD, capacity: 2 })),
    ).toMatchObject({ code: "CAPACITY_CONFLICT", statusCode: 409, field: "capacity" });
  });

  it("returns 404 for edits or deletes of deleted or unknown events", async () => {
    const { fake, events } = setup();
    fake.seed([eventItem({ eventId: "gone", lifecycleStatus: "deleted" })]);
    for (const eventId of ["gone", "unknown"]) {
      expect(await captureApiError(events.update(organizerClaims, eventId, PAYLOAD))).toMatchObject(
        { code: "NOT_FOUND", statusCode: 404, field: "id" },
      );
      expect(await captureApiError(events.remove(adminClaims, eventId))).toMatchObject({
        code: "NOT_FOUND",
      });
    }
  });

  it("soft-deletes: hidden from public list and detail, listed for admins as deleted", async () => {
    const { events, discovery } = setup();
    const created = await events.create(organizerClaims, PAYLOAD);
    await events.remove(organizerClaims, created.eventId);
    const publicIds = (await discovery.listEvents({})).events.map((event) => event.eventId);
    expect(publicIds).not.toContain(created.eventId);
    expect(await captureApiError(discovery.getEvent(created.eventId))).toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    const deleted = await events.listAdminEvents(adminClaims, { status: "deleted" });
    expect(deleted.events.map((event) => event.eventId)).toEqual([created.eventId]);
    expect(deleted.events[0].lifecycleStatus).toBe("deleted");
    // An admin may delete any organizer's event (AC3.1.3).
    const organizerOwned = await events.create(otherOrganizerClaims, PAYLOAD);
    await events.remove(adminClaims, organizerOwned.eventId);
    expect(await captureApiError(discovery.getEvent(organizerOwned.eventId))).toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    const publicAfter = (await discovery.listEvents({})).events.map((event) => event.eventId);
    expect(publicAfter).not.toContain(organizerOwned.eventId);
  });

  it("scopes organizer lists to their own events and forbids managing others' events", async () => {
    const { events } = setup();
    const mine = await events.create(organizerClaims, PAYLOAD);
    const theirs = await events.create(otherOrganizerClaims, PAYLOAD);
    const listed = await events.listOrganizerEvents(organizerClaims);
    const ids = listed.events.map((event) => event.eventId);
    expect(ids).toContain(mine.eventId);
    expect(ids).not.toContain(theirs.eventId);
    expect(listed.events.every((event) => event.organizerSubject === ORGANIZER)).toBe(true);
    for (const attempt of [
      events.update(organizerClaims, theirs.eventId, PAYLOAD),
      events.remove(organizerClaims, theirs.eventId),
    ]) {
      expect(await captureApiError(attempt)).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    }
    const filtered = await events.listAdminEvents(adminClaims, {
      organizerSubject: OTHER_ORGANIZER,
    });
    expect(filtered.events.map((event) => event.eventId)).toEqual([theirs.eventId]);
  });

  it("enforces roles and validation on management endpoints", async () => {
    const { events } = setup();
    expect(await captureApiError(events.listAdminEvents(organizerClaims, {}))).toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
    expect(await captureApiError(events.create(residentClaims, PAYLOAD))).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await captureApiError(events.create(undefined, PAYLOAD))).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      statusCode: 401,
    });
    expect(
      await captureApiError(events.listAdminEvents(adminClaims, { status: "everything" })),
    ).toMatchObject({ code: "VALIDATION_ERROR", field: "status" });
    expect(
      await captureApiError(
        events.listAdminEvents(adminClaims, { organizerSubject: "x".repeat(129) }),
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR", field: "organizerSubject" });
    expect(
      await captureApiError(events.create(organizerClaims, { ...PAYLOAD, capacity: 0 })),
    ).toMatchObject({ code: "VALIDATION_ERROR", field: "capacity", statusCode: 400 });
    const active = await events.listAdminEvents(adminClaims, {});
    expect(active.events.length).toBeGreaterThanOrEqual(2);
  });
});
