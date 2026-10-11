import { describe, expect, it } from "vitest";
import {
  RsvpRepository,
  type RegistrationRecord,
} from "../../../src/event-api/rsvp/rsvp-repository.js";
import { awsError } from "../support/fake-dynamodb.js";
import { eventItem, fakeWithSeed, SEED_EVENT_ID, TABLE_NAME } from "../support/fixtures.js";

const AT = "2030-01-15T12:00:00.000Z";

function registration(overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    eventId: SEED_EVENT_ID,
    registrationId: "reg-0001",
    normalizedEmail: "resident.two@example.com",
    displayName: "Synthetic Resident Two",
    status: "confirmed",
    cancellationTokenDigest: "a".repeat(64),
    ...overrides,
  };
}

function setup() {
  const fake = fakeWithSeed();
  return { fake, repository: new RsvpRepository(fake.asClient(), TABLE_NAME) };
}

function transactItems(fake: ReturnType<typeof fakeWithSeed>, index = -1) {
  const commands = fake.commandsNamed("TransactWriteCommand");
  return commands.at(index)?.input.TransactItems as Record<string, Record<string, unknown>>[];
}

describe("RsvpRepository admission transactions", () => {
  it("admits a confirmed RSVP on the C1 seed event under the D3 conditions", async () => {
    const { fake, repository } = setup();
    await expect(repository.admitConfirmed(registration(), AT)).resolves.toEqual({ ok: true });
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "META")?.confirmedRsvpCount).toBe(2);
    const [meta, put] = transactItems(fake);
    expect(meta.Update.ConditionExpression).toBe(
      "#lifecycleStatus = :active AND #confirmed < #capacity AND " +
        "(attribute_not_exists(#waitlistCount) OR #waitlistCount = :zero)",
    );
    expect(put.Put.ConditionExpression).toBe("attribute_not_exists(#pk) OR #status = :cancelled");
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "REG#resident.two@example.com")).toMatchObject({
      status: "confirmed",
      gsi5pk: `REGISTRATION#EVENT#${SEED_EVENT_ID}#STATUS#confirmed`,
      gsi5sk: "WAITLIST##REG#reg-0001",
      gsi6pk: `CANCEL#${"a".repeat(64)}`,
      createdAt: AT,
    });
  });

  it("reports capacity when the event is full or already has waiters, from the META reason", async () => {
    const { fake, repository } = setup();
    fake.seed([
      eventItem({ eventId: "full", capacity: 1, confirmedRsvpCount: 1 }),
      eventItem({ eventId: "waiters", capacity: 5, confirmedRsvpCount: 1, waitlistCount: 1 }),
    ]);
    for (const eventId of ["full", "waiters"]) {
      await expect(repository.admitConfirmed(registration({ eventId }), AT)).resolves.toEqual({
        ok: false,
        reason: "capacity",
      });
    }
    expect(fake.get("EVENT#full", "META")?.confirmedRsvpCount).toBe(1);
    expect(fake.get("EVENT#full", "REG#resident.two@example.com")).toBeUndefined();
  });

  it("reports event-unavailable for a missing or deleted event", async () => {
    const { fake, repository } = setup();
    fake.seed([eventItem({ eventId: "deleted", lifecycleStatus: "deleted" })]);
    for (const eventId of ["missing", "deleted"]) {
      await expect(repository.admitConfirmed(registration({ eventId }), AT)).resolves.toEqual({
        ok: false,
        reason: "event-unavailable",
      });
      await expect(repository.admitWaitlisted(registration({ eventId }), AT)).resolves.toEqual({
        ok: false,
        reason: "event-unavailable",
      });
    }
  });

  it("refuses a duplicate active email but replaces a cancelled registration", async () => {
    const { fake, repository } = setup();
    const duplicate = registration({ normalizedEmail: "resident.one@example.com" });
    await expect(repository.admitConfirmed(duplicate, AT)).resolves.toEqual({
      ok: false,
      reason: "duplicate",
    });
    const seeded = await repository.getRegistration(SEED_EVENT_ID, "resident.one@example.com");
    expect(seeded?.status).toBe("confirmed");
    await expect(repository.cancelConfirmed(seeded as RegistrationRecord, AT)).resolves.toEqual({
      ok: true,
    });
    await expect(repository.admitConfirmed(duplicate, AT)).resolves.toEqual({ ok: true });
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "REG#resident.one@example.com")).toMatchObject({
      registrationId: "reg-0001",
      status: "confirmed",
    });
  });

  it("admits waiters with if_not_exists on waitlistCount and finds the earliest head", async () => {
    const { fake, repository } = setup();
    fake.seed([eventItem({ eventId: "full", capacity: 1, confirmedRsvpCount: 1 })]);
    const later = registration({
      eventId: "full",
      registrationId: "reg-b",
      normalizedEmail: "b@example.com",
      status: "waitlisted",
      waitlistedAt: "2030-01-15T12:00:00.002Z",
    });
    const earlier = { ...later, registrationId: "reg-a", normalizedEmail: "a@example.com" };
    earlier.waitlistedAt = "2030-01-15T12:00:00.001Z";
    await repository.admitWaitlisted(later, AT);
    await repository.admitWaitlisted(earlier, AT);
    expect(fake.get("EVENT#full", "META")?.waitlistCount).toBe(2);
    const head = await repository.findWaitlistHead("full");
    expect(head?.registrationId).toBe("reg-a");
    const query = fake.commandsNamed("QueryCommand")[0].input;
    expect(query).toMatchObject({ IndexName: "GSI5", ScanIndexForward: true, Limit: 1 });
  });
});

describe("RsvpRepository transitions", () => {
  it("promotes a head while a seat is free and refuses a stale head", async () => {
    const { fake, repository } = setup();
    fake.seed([eventItem({ eventId: "e", capacity: 2, confirmedRsvpCount: 1, waitlistCount: 0 })]);
    const waiter = registration({
      eventId: "e",
      status: "waitlisted",
      waitlistedAt: "2030-01-15T12:00:00.001Z",
    });
    await repository.admitWaitlisted(waiter, AT);
    await expect(repository.promoteHead(waiter, AT)).resolves.toEqual({ ok: true });
    expect(fake.get("EVENT#e", "META")).toMatchObject({ confirmedRsvpCount: 2, waitlistCount: 0 });
    expect(fake.get("EVENT#e", "REG#resident.two@example.com")).toMatchObject({
      status: "confirmed",
      gsi5pk: "REGISTRATION#EVENT#e#STATUS#confirmed",
      gsi5sk: "WAITLIST##REG#reg-0001",
      waitlistedAt: "2030-01-15T12:00:00.001Z",
      promotedAt: AT,
    });
    await expect(repository.promoteHead(waiter, AT)).resolves.toEqual({
      ok: false,
      reason: "status-changed",
    });
    const [, registrationUpdate] = transactItems(fake);
    expect(registrationUpdate.Update.ConditionExpression).toBe(
      "#status = :expected AND #registrationId = :registrationId",
    );
  });

  it("cancels confirmed and waitlisted registrations and locates them by token digest", async () => {
    const { fake, repository } = setup();
    const seeded = await repository.getRegistration(SEED_EVENT_ID, "resident.one@example.com");
    const located = await repository.findByTokenDigest(seeded?.cancellationTokenDigest as string);
    expect(located?.registrationId).toBe("seed-registration-resident-one");
    await repository.cancelConfirmed(seeded as RegistrationRecord, AT);
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "META")?.confirmedRsvpCount).toBe(0);
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "REG#resident.one@example.com")).toMatchObject({
      status: "cancelled",
      gsi5pk: `REGISTRATION#EVENT#${SEED_EVENT_ID}#STATUS#cancelled`,
      gsi6pk: located && `CANCEL#${located.cancellationTokenDigest}`,
      cancelledAt: AT,
    });
    await expect(
      repository.cancelConfirmed(seeded as RegistrationRecord, AT),
    ).resolves.toMatchObject({ ok: false, reason: "status-changed" });

    fake.seed([eventItem({ eventId: "w", capacity: 1, confirmedRsvpCount: 1 })]);
    const waiter = registration({ eventId: "w", status: "waitlisted", waitlistedAt: AT });
    await repository.admitWaitlisted(waiter, AT);
    await expect(repository.cancelWaitlisted(waiter, AT)).resolves.toEqual({ ok: true });
    expect(fake.get("EVENT#w", "META")).toMatchObject({ confirmedRsvpCount: 1, waitlistCount: 0 });
    await expect(repository.findByTokenDigest("f".repeat(64))).resolves.toBeUndefined();
  });

  it("maps TransactionConflict to a retryable result and propagates other SDK errors", async () => {
    const { fake, repository } = setup();
    fake.failNext(
      "TransactWriteCommand",
      Object.assign(awsError("TransactionCanceledException", "conflict"), {
        CancellationReasons: [{ Code: "TransactionConflict" }, { Code: "None" }],
      }),
    );
    await expect(repository.admitConfirmed(registration(), AT)).resolves.toEqual({
      ok: false,
      reason: "conflict",
    });
    fake.failNext(
      "TransactWriteCommand",
      Object.assign(awsError("TransactionCanceledException", "throttled"), {
        CancellationReasons: [{ Code: "ThrottlingError" }, { Code: "None" }],
      }),
    );
    await expect(repository.admitConfirmed(registration(), AT)).rejects.toThrow("throttled");
    fake.failNext("TransactWriteCommand", awsError("InternalServerError", "boom"));
    await expect(repository.cancelConfirmed(registration(), AT)).rejects.toThrow("boom");
    fake.failNext("GetCommand", awsError("InternalServerError", "read failed"));
    await expect(repository.getEventCapacity(SEED_EVENT_ID)).rejects.toThrow("read failed");
  });
});
