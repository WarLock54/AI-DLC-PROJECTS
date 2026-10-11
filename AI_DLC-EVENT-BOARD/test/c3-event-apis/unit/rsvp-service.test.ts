import { describe, expect, it } from "vitest";
import { digestToken } from "../../../src/event-api/rsvp/token.js";
import { awsError } from "../support/fake-dynamodb.js";
import { eventItem, fakeWithSeed, ORGANIZER } from "../support/fixtures.js";
import { buildServices, captureApiError } from "../support/services.js";

function setup(events: Parameters<typeof eventItem>[0][] = []) {
  const fake = fakeWithSeed();
  fake.seed(events.map(eventItem));
  return { fake, ...buildServices(fake) };
}

function rsvp(email: string, displayName = "Synthetic Resident") {
  return { displayName, email };
}

describe("RsvpService submission (FR5.1-FR5.8, US1.3, US1.4)", () => {
  it("confirms while seats are free and returns the cancellation token once", async () => {
    const { fake, rsvp: service, tokens } = setup([{ eventId: "e", capacity: 2 }]);
    const result = await service.submitRsvp("e", rsvp("a@example.com"));
    expect(result).toEqual({
      statusCode: 201,
      body: { status: "confirmed", cancelToken: tokens.issued[0].token },
    });
    expect(tokens.issued[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.get("EVENT#e", "META")?.confirmedRsvpCount).toBe(1);
  });

  it("waitlists with a stored waitlistedAt when the event is full", async () => {
    const { fake, rsvp: service } = setup([{ eventId: "e", capacity: 1, confirmedRsvpCount: 1 }]);
    const result = await service.submitRsvp("e", rsvp("b@example.com"));
    expect(result).toMatchObject({ statusCode: 201, body: { status: "waitlisted" } });
    const stored = fake.get("EVENT#e", "REG#b@example.com");
    expect(stored).toMatchObject({
      status: "waitlisted",
      waitlistedAt: expect.stringMatching(/^2030-01-15T12:00:00\.\d{3}Z$/),
      gsi5pk: "REGISTRATION#EVENT#e#STATUS#waitlisted",
    });
    expect(stored?.gsi5sk).toBe(`WAITLIST#${String(stored?.waitlistedAt)}#REG#reg-0001`);
    expect(fake.get("EVENT#e", "META")).toMatchObject({ confirmedRsvpCount: 1, waitlistCount: 1 });
  });

  it("is idempotent: a duplicate returns 200 with the existing status and no token", async () => {
    const { fake, rsvp: service } = setup([{ eventId: "e", capacity: 1 }]);
    await service.submitRsvp("e", rsvp("a@example.com"));
    const again = await service.submitRsvp("e", rsvp("a@example.com", "Another Name"));
    expect(again).toEqual({ statusCode: 200, body: { status: "confirmed" } });
    expect(fake.get("EVENT#e", "META")?.confirmedRsvpCount).toBe(1);
    expect(fake.get("EVENT#e", "REG#a@example.com")?.displayName).toBe("Synthetic Resident");
  });

  it("treats email case-insensitively as the RSVP identity (eventId, lower-cased email)", async () => {
    const { fake, rsvp: service } = setup([{ eventId: "e", capacity: 5 }]);
    await service.submitRsvp("e", rsvp("Mixed.Case@Example.com"));
    const again = await service.submitRsvp("e", rsvp("mixed.case@EXAMPLE.COM"));
    expect(again.statusCode).toBe(200);
    const registrations = fake.all().filter((item) => String(item.sk).startsWith("REG#"));
    expect(registrations.filter((item) => item.eventId === "e")).toHaveLength(1);
    expect(fake.get("EVENT#e", "REG#mixed.case@example.com")).toBeDefined();
  });

  it("returns 404 for unknown or deleted events and 400 for invalid input", async () => {
    const { rsvp: service } = setup([{ eventId: "gone", lifecycleStatus: "deleted" }]);
    for (const eventId of ["unknown", "gone"]) {
      expect(await captureApiError(service.submitRsvp(eventId, rsvp("a@example.com")))).toEqual({
        code: "NOT_FOUND",
        statusCode: 404,
        field: "id",
        message: "Event not found.",
      });
    }
    expect(
      await captureApiError(
        service.submitRsvp("seed-event-community-market", { displayName: "A" }),
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400, field: "email" });
  });

  it("waitlists a newcomer while earlier waiters exist, even if a seat is free (D3)", async () => {
    const { fake, rsvp: service } = setup([
      { eventId: "e", capacity: 2, confirmedRsvpCount: 1, waitlistCount: 1 },
    ]);
    // The counted waiter is not visible on GSI5 yet, so it cannot be promoted now.
    const result = await service.submitRsvp("e", rsvp("new@example.com"));
    expect(result.body.status).toBe("waitlisted");
    expect(fake.get("EVENT#e", "META")).toMatchObject({ confirmedRsvpCount: 1, waitlistCount: 2 });
  });

  it("drains waiters after a capacity increase on the next RSVP (D4)", async () => {
    const { fake, rsvp: service, events } = setup([{ eventId: "e", capacity: 1 }]);
    await service.submitRsvp("e", rsvp("first@example.com"));
    await service.submitRsvp("e", rsvp("waiter@example.com"));
    const meta = fake.get("EVENT#e", "META") ?? {};
    await events.update({ sub: ORGANIZER, "cognito:groups": "[organizer]" }, "e", {
      title: meta.title,
      description: meta.description,
      startsAt: meta.startsAt,
      location: meta.location,
      category: meta.category,
      capacity: 2,
    });
    expect(fake.get("EVENT#e", "REG#waiter@example.com")?.status).toBe("waitlisted");
    const late = await service.submitRsvp("e", rsvp("late@example.com"));
    expect(fake.get("EVENT#e", "REG#waiter@example.com")?.status).toBe("confirmed");
    expect(late.body.status).toBe("waitlisted");
    expect(fake.get("EVENT#e", "META")).toMatchObject({ confirmedRsvpCount: 2, waitlistCount: 1 });
  });

  it("stores only the token digest and never logs or persists the raw token", async () => {
    const { fake, rsvp: service, logger, tokens } = setup([{ eventId: "e", capacity: 1 }]);
    await service.submitRsvp("e", rsvp("a@example.com"));
    await service.submitRsvp("e", rsvp("b@example.com"));
    const stored = JSON.stringify(fake.all());
    for (const { token, digest } of tokens.issued) {
      expect(stored).not.toContain(token);
      expect(stored).toContain(digest);
      expect(digest).toBe(digestToken(token));
    }
    expect(JSON.stringify(logger.entries)).not.toMatch(/@example\.com/);
  });

  it("retries TransactionConflict and fails loudly once attempts are exhausted", async () => {
    const { fake, rsvp: service } = setup([{ eventId: "e", capacity: 3 }]);
    const conflict = () =>
      Object.assign(awsError("TransactionCanceledException", "conflict"), {
        CancellationReasons: [{ Code: "TransactionConflict" }, { Code: "None" }],
      });
    fake.failNext("TransactWriteCommand", conflict());
    await expect(service.submitRsvp("e", rsvp("a@example.com"))).resolves.toMatchObject({
      statusCode: 201,
    });
    for (let index = 0; index < 8; index += 1) {
      fake.failNext("TransactWriteCommand", conflict());
    }
    await expect(service.submitRsvp("e", rsvp("b@example.com"))).rejects.toThrow(
      /did not settle after 8 attempts/,
    );
    expect(fake.get("EVENT#e", "META")?.confirmedRsvpCount).toBe(1);
  });
});
