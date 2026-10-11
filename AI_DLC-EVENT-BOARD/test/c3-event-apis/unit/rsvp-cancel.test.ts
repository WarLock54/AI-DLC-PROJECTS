import { describe, expect, it } from "vitest";
import { eventItem, fakeWithSeed } from "../support/fixtures.js";
import { buildServices, captureApiError } from "../support/services.js";

async function setupWithRsvps(capacity: number, emails: string[]) {
  const fake = fakeWithSeed();
  fake.seed([eventItem({ eventId: "e", capacity })]);
  const services = buildServices(fake);
  const cancelTokens: Record<string, string> = {};
  for (const email of emails) {
    const result = await services.rsvp.submitRsvp("e", { displayName: "Resident", email });
    if (result.statusCode !== 201) {
      throw new Error("Expected a new RSVP.");
    }
    cancelTokens[email] = result.body.cancelToken;
  }
  return { fake, ...services, tokens: cancelTokens };
}

function status(fake: ReturnType<typeof fakeWithSeed>, email: string) {
  return fake.get("EVENT#e", `REG#${email}`)?.status;
}

describe("RSVP cancellation (FR5.9-FR5.12, US1.5, US1.6)", () => {
  it("frees the seat when a confirmed RSVP is cancelled", async () => {
    const { fake, rsvp, tokens } = await setupWithRsvps(2, ["a@example.com"]);
    await expect(rsvp.cancel({ cancelToken: tokens["a@example.com"] })).resolves.toEqual({
      status: "cancelled",
    });
    expect(status(fake, "a@example.com")).toBe("cancelled");
    expect(fake.get("EVENT#e", "REG#a@example.com")?.gsi5pk).toBe(
      "REGISTRATION#EVENT#e#STATUS#cancelled",
    );
    expect(fake.get("EVENT#e", "META")?.confirmedRsvpCount).toBe(0);
  });

  it("promotes the earliest waitlisted RSVP when a confirmed RSVP is cancelled", async () => {
    const { fake, rsvp, tokens } = await setupWithRsvps(1, [
      "a@example.com",
      "first-waiter@example.com",
      "second-waiter@example.com",
    ]);
    await rsvp.cancel({ cancelToken: tokens["a@example.com"] });
    expect(status(fake, "first-waiter@example.com")).toBe("confirmed");
    expect(status(fake, "second-waiter@example.com")).toBe("waitlisted");
    expect(fake.get("EVENT#e", "META")).toMatchObject({ confirmedRsvpCount: 1, waitlistCount: 1 });
  });

  it("removes a waitlisted RSVP without promoting anyone or changing confirmed count", async () => {
    const { fake, rsvp, tokens } = await setupWithRsvps(1, [
      "a@example.com",
      "w1@example.com",
      "w2@example.com",
    ]);
    await rsvp.cancel({ cancelToken: tokens["w1@example.com"] });
    expect(status(fake, "w1@example.com")).toBe("cancelled");
    expect(status(fake, "w2@example.com")).toBe("waitlisted");
    expect(status(fake, "a@example.com")).toBe("confirmed");
    expect(fake.get("EVENT#e", "META")).toMatchObject({ confirmedRsvpCount: 1, waitlistCount: 1 });
  });

  it("returns 404 for unknown and malformed tokens without disclosing data", async () => {
    const { rsvp } = await setupWithRsvps(1, ["a@example.com"]);
    for (const cancelToken of ["A".repeat(43), "short", "x".repeat(44), "bad token with spaces"]) {
      const error = await captureApiError(rsvp.cancel({ cancelToken }));
      expect(error).toEqual({
        code: "NOT_FOUND",
        statusCode: 404,
        field: "cancelToken",
        message: "Cancellation token not found.",
      });
    }
  });

  it("returns 409 CANCEL_TOKEN_CONSUMED when a token is reused", async () => {
    const { rsvp, tokens } = await setupWithRsvps(1, ["a@example.com", "w@example.com"]);
    for (const email of ["a@example.com", "w@example.com"]) {
      await rsvp.cancel({ cancelToken: tokens[email] });
      const error = await captureApiError(rsvp.cancel({ cancelToken: tokens[email] }));
      expect(error).toEqual({
        code: "CANCEL_TOKEN_CONSUMED",
        statusCode: 409,
        field: "cancelToken",
        message: "This cancellation token has already been used.",
      });
    }
  });

  it("retries a stale waitlist head up to 3 times, then defers promotion (D2)", async () => {
    const { fake, rsvp, tokens, logger } = await setupWithRsvps(1, [
      "a@example.com",
      "w1@example.com",
      "w2@example.com",
    ]);
    // GSI5 still shows w1 as the head after w1 cancels: a stale index view.
    fake.freezeIndexes();
    await rsvp.cancel({ cancelToken: tokens["w1@example.com"] });
    await rsvp.cancel({ cancelToken: tokens["a@example.com"] });
    const promotions = fake
      .commandsNamed("TransactWriteCommand")
      .filter((command) => JSON.stringify(command.input).includes('"#at":"promotedAt"'));
    expect(promotions).toHaveLength(3);
    expect(logger.entries).toContainEqual({
      level: "warn",
      event: "WAITLIST_PROMOTION_DEFERRED",
      eventId: "e",
      reason: "stale-head",
    });
    expect(status(fake, "w2@example.com")).toBe("waitlisted");
    // Once the index catches up, the next RSVP drains the free seat to w2 first.
    fake.unfreezeIndexes();
    const late = await rsvp.submitRsvp("e", { displayName: "Late", email: "late@example.com" });
    expect(status(fake, "w2@example.com")).toBe("confirmed");
    expect(late.body.status).toBe("waitlisted");
  });

  it("reports a token not yet visible on GSI6 as 404, then accepts it once indexed (D2)", async () => {
    const fake = fakeWithSeed();
    fake.seed([eventItem({ eventId: "e", capacity: 2 })]);
    const { rsvp } = buildServices(fake);
    fake.freezeIndexes();
    const created = await rsvp.submitRsvp("e", { displayName: "R", email: "a@example.com" });
    const cancelToken = created.statusCode === 201 ? created.body.cancelToken : "";
    expect(await captureApiError(rsvp.cancel({ cancelToken }))).toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    fake.unfreezeIndexes();
    await expect(rsvp.cancel({ cancelToken })).resolves.toEqual({ status: "cancelled" });
  });

  it("settles a concurrent double cancel as one 200 and one 409", async () => {
    const { fake, rsvp, tokens } = await setupWithRsvps(2, ["a@example.com"]);
    const results = await Promise.allSettled([
      rsvp.cancel({ cancelToken: tokens["a@example.com"] }),
      rsvp.cancel({ cancelToken: tokens["a@example.com"] }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CANCEL_TOKEN_CONSUMED" });
    expect(fake.get("EVENT#e", "META")?.confirmedRsvpCount).toBe(0);
  });

  it("returns 404 when the event was deleted after the RSVP", async () => {
    const { fake, rsvp, tokens, events } = await setupWithRsvps(2, ["a@example.com"]);
    await events.remove(
      { sub: "11111111-1111-4111-8111-111111111111", "cognito:groups": ["organizer"] },
      "e",
    );
    expect(
      await captureApiError(rsvp.cancel({ cancelToken: tokens["a@example.com"] })),
    ).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(status(fake, "a@example.com")).toBe("confirmed");
    expect(await captureApiError(rsvp.cancel({ notAToken: true }))).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "notAToken",
    });
  });
});
