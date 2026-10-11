import { describe, expect, it } from "vitest";
import { eventViewItem, LIST_VIEW_EVENT_ID } from "../../../src/event-api/discovery/view-keys.js";
import {
  activeEventKeys,
  eventPrimaryKey,
  softDeleteKeyTransition,
} from "../../../src/event-api/events/event-keys.js";
import {
  cancelTokenKeys,
  registrationPrimaryKey,
  registrationStatusKeys,
} from "../../../src/event-api/rsvp/registration-keys.js";
import { createSeedFixtures } from "../../../src/seed/fixtures.js";

const ORGANIZER = "11111111-1111-4111-8111-111111111111";

function seed() {
  return createSeedFixtures({
    organizerSubject: ORGANIZER,
    clock: () => new Date("2030-01-15T12:00:00.000Z"),
  });
}

describe("C-03 v1 event keys", () => {
  it("builds exactly the Event META keys the C1 seed ships for the same input", () => {
    const [event] = seed();
    const keys = activeEventKeys({
      eventId: event.eventId as string,
      startsAt: event.startsAt as string,
      organizerSubject: event.organizerSubject as string,
      category: event.category as string,
      location: event.location as string,
    });
    for (const [attribute, value] of Object.entries(keys)) {
      expect({ attribute, value }).toEqual({ attribute, value: event[attribute] });
    }
    expect(eventPrimaryKey("abc")).toEqual({ pk: "EVENT#abc", sk: "META" });
  });

  it("removes GSI1-GSI3 and moves GSI7 to LIFECYCLE#deleted on soft delete", () => {
    const transition = softDeleteKeyTransition();
    expect([...transition.remove]).toEqual([
      "gsi1pk",
      "gsi1sk",
      "gsi2pk",
      "gsi2sk",
      "gsi3pk",
      "gsi3sk",
    ]);
    expect(transition.set).toEqual({ gsi7pk: "LIFECYCLE#deleted" });
  });
});

describe("C-03 v1 registration keys", () => {
  it("reproduces the seed's confirmed registration keys", () => {
    const registration = seed()[2];
    const eventId = registration.eventId as string;
    const registrationId = registration.registrationId as string;
    expect(registrationPrimaryKey(eventId, registration.normalizedEmail as string)).toEqual({
      pk: registration.pk,
      sk: registration.sk,
    });
    expect(registrationStatusKeys(eventId, registrationId, "confirmed")).toEqual({
      gsi5pk: registration.gsi5pk,
      gsi5sk: registration.gsi5sk,
    });
    expect(
      cancelTokenKeys(registration.cancellationTokenDigest as string, eventId, registrationId),
    ).toEqual({ gsi6pk: registration.gsi6pk, gsi6sk: registration.gsi6sk });
  });

  it("orders waitlisted registrations by waitlistedAt", () => {
    expect(registrationStatusKeys("e-1", "r-1", "waitlisted", "2030-01-15T12:00:00.000Z")).toEqual({
      gsi5pk: "REGISTRATION#EVENT#e-1#STATUS#waitlisted",
      gsi5sk: "WAITLIST#2030-01-15T12:00:00.000Z#REG#r-1",
    });
  });

  it("drops waitlistedAt from the key when a waiter is promoted to confirmed", () => {
    expect(registrationStatusKeys("e-1", "r-1", "confirmed", "2030-01-15T12:00:00.000Z")).toEqual({
      gsi5pk: "REGISTRATION#EVENT#e-1#STATUS#confirmed",
      gsi5sk: "WAITLIST##REG#r-1",
    });
  });

  it("moves cancelled registrations to the cancelled status partition", () => {
    expect(registrationStatusKeys("e-1", "r-2", "cancelled")).toEqual({
      gsi5pk: "REGISTRATION#EVENT#e-1#STATUS#cancelled",
      gsi5sk: "WAITLIST##REG#r-2",
    });
  });
});

describe("C-03 EventView keys", () => {
  it("builds list and detail view items on GSI4 and GSI7", () => {
    const list = eventViewItem({
      viewId: "v-1",
      viewType: "list",
      eventId: LIST_VIEW_EVENT_ID,
      viewedAt: "2030-01-15T12:00:00.000Z",
    });
    expect(list).toMatchObject({
      pk: "VIEW#v-1",
      sk: "META",
      gsi4pk: "VIEW#list",
      gsi4sk: "AT#2030-01-15T12:00:00.000Z#EVENT#LIST",
      gsi7pk: "VIEW#list",
      gsi7sk: "AT#2030-01-15T12:00:00.000Z#EVENT#LIST",
      eventId: "LIST",
      viewType: "list",
    });
    const detail = eventViewItem({
      viewId: "v-2",
      viewType: "detail",
      eventId: "e-9",
      viewedAt: "2030-01-15T12:00:01.000Z",
    });
    expect(detail.gsi7pk).toBe("VIEW#detail");
    expect(detail.gsi7sk).toBe("AT#2030-01-15T12:00:01.000Z#EVENT#e-9");
  });
});
