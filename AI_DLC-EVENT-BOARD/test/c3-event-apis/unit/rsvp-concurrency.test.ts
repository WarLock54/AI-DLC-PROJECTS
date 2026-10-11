import { describe, expect, it } from "vitest";
import { eventItem, fakeWithSeed, ORGANIZER } from "../support/fixtures.js";
import { buildServices } from "../support/services.js";

// NFR26 / AC1.7.1 / AC1.7.2: the dedicated RSVP concurrency proof. Requests
// really interleave (the fake yields between calls) while each DynamoDB
// transaction stays atomic, as on the real service.
function trackConfirmedCount(fake: ReturnType<typeof fakeWithSeed>, eventId: string) {
  const observed: number[] = [];
  fake.onCommit((store) => {
    observed.push(Number(store.get(`EVENT#${eventId}`, "META")?.confirmedRsvpCount ?? 0));
  });
  return observed;
}

function registrations(fake: ReturnType<typeof fakeWithSeed>, eventId: string) {
  return fake.all().filter((item) => item.pk === `EVENT#${eventId}` && item.sk !== "META");
}

describe("RSVP concurrency (NFR26)", () => {
  it("never confirms more than capacity: 25 parallel RSVPs for 5 seats", async () => {
    const fake = fakeWithSeed();
    fake.seed([eventItem({ eventId: "popular", capacity: 5 })]);
    const { rsvp } = buildServices(fake);
    const observed = trackConfirmedCount(fake, "popular");

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        rsvp.submitRsvp("popular", {
          displayName: `Resident ${index}`,
          email: `resident.${index}@example.com`,
        }),
      ),
    );

    expect(results.every((result) => result.statusCode === 201)).toBe(true);
    const statuses = results.map((result) => result.body.status);
    expect(statuses.filter((status) => status === "confirmed")).toHaveLength(5);
    expect(statuses.filter((status) => status === "waitlisted")).toHaveLength(20);
    expect(Math.max(...observed)).toBeLessThanOrEqual(5);
    expect(observed.length).toBeGreaterThanOrEqual(25);
    expect(fake.get("EVENT#popular", "META")).toMatchObject({
      confirmedRsvpCount: 5,
      waitlistCount: 20,
    });
    const stored = registrations(fake, "popular");
    expect(stored).toHaveLength(25);
    expect(new Set(stored.map((item) => item.normalizedEmail)).size).toBe(25);
    expect(stored.filter((item) => item.status === "confirmed")).toHaveLength(5);
  });

  it("promotes existing waiters first and keeps newcomers waitlisted under contention", async () => {
    const fake = fakeWithSeed();
    fake.seed([eventItem({ eventId: "queue", capacity: 3 })]);
    const { rsvp, events } = buildServices(fake);
    for (let index = 0; index < 5; index += 1) {
      await rsvp.submitRsvp("queue", { displayName: "Early", email: `early.${index}@example.com` });
    }
    const meta = fake.get("EVENT#queue", "META") ?? {};
    await events.update({ sub: ORGANIZER, "cognito:groups": ["organizer"] }, "queue", {
      title: meta.title,
      description: meta.description,
      startsAt: meta.startsAt,
      location: meta.location,
      category: meta.category,
      capacity: 5,
    });
    const observed = trackConfirmedCount(fake, "queue");

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        rsvp.submitRsvp("queue", { displayName: "New", email: `new.${index}@example.com` }),
      ),
    );

    expect(results.map((result) => result.body.status)).toEqual(Array(10).fill("waitlisted"));
    expect(Math.max(...observed)).toBeLessThanOrEqual(5);
    expect(fake.get("EVENT#queue", "META")).toMatchObject({
      confirmedRsvpCount: 5,
      waitlistCount: 10,
    });
    for (const index of [3, 4]) {
      expect(fake.get("EVENT#queue", `REG#early.${index}@example.com`)?.status).toBe("confirmed");
    }
  });

  it("keeps one registration for parallel duplicate submissions of one email", async () => {
    const fake = fakeWithSeed();
    fake.seed([eventItem({ eventId: "dup", capacity: 5 })]);
    const { rsvp } = buildServices(fake);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        rsvp.submitRsvp("dup", {
          displayName: "Same Person",
          email: index % 2 === 0 ? "same@example.com" : "SAME@Example.com",
        }),
      ),
    );
    expect(results.filter((result) => result.statusCode === 201)).toHaveLength(1);
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(9);
    expect(registrations(fake, "dup")).toHaveLength(1);
    expect(fake.get("EVENT#dup", "META")?.confirmedRsvpCount).toBe(1);
  });
});
