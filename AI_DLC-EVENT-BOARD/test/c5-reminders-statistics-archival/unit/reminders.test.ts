import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LogEmailSender,
  SesEmailSender,
  type EmailSender,
  type ReminderDelivery,
} from "../../../src/operations/reminders/email-sender.js";
import type { ReminderQueueMessageV1 } from "../../../src/operations/reminders/message.js";
import {
  SqsReminderQueue,
  type ReminderQueue,
} from "../../../src/operations/reminders/reminder-queue.js";
import { ReminderRepository } from "../../../src/operations/reminders/reminder-repository.js";
import {
  ReminderEnqueueError,
  ReminderSelector,
} from "../../../src/operations/reminders/reminder-selector.js";
import { ReminderWorker } from "../../../src/operations/reminders/reminder-worker.js";
import { awsError, FakeDynamoDb } from "../support/fake-dynamodb.js";
import { fixedClock, recordingLogger } from "../support/fakes.js";
import {
  COMMUNITY_EVENT_ID,
  SEED_REGISTRATION_ID,
  seedDataset,
  seedEvent,
  seedRegistration,
  withLifecycle,
} from "../support/fixtures.js";

const TABLE = "team32-ceb-events";
// The pipeline seeds at deploy time T; the community event starts at T+24h.
const DEPLOYED_AT = "2026-10-05T12:00:00.000Z";
const EVENT_START = "2026-10-06T12:00:00.000Z";
const SCHEDULED_FOR = "2026-10-05T12:00:00.000Z";

class FakeQueue implements ReminderQueue {
  public readonly sent: ReminderQueueMessageV1[] = [];
  public failures = 0;

  async send(message: ReminderQueueMessageV1): Promise<void> {
    await Promise.resolve();
    if (this.failures > 0) {
      this.failures -= 1;
      throw awsError("ServiceUnavailable", "queue down");
    }
    this.sent.push(message);
  }
}

class FakeSender implements EmailSender {
  readonly mode = "log" as const;
  public readonly delivered: ReminderDelivery[] = [];
  public failNext = false;

  async deliver(reminder: ReminderDelivery): Promise<void> {
    await Promise.resolve();
    if (this.failNext) {
      this.failNext = false;
      throw new Error("delivery failed");
    }
    this.delivered.push(reminder);
  }
}

let fake: FakeDynamoDb;
let queue: FakeQueue;

function selector(now: string) {
  const { logger, lines } = recordingLogger();
  return {
    lines,
    selector: new ReminderSelector({
      repository: new ReminderRepository(fake.asClient(), TABLE),
      queue,
      clock: fixedClock(now),
      logger,
    }),
  };
}

beforeEach(() => {
  fake = new FakeDynamoDb(TABLE);
  queue = new FakeQueue();
});

describe("ReminderSelector", () => {
  it("queues one C-05 message for the seeded confirmed registration (FR7.3 evidence)", async () => {
    fake.seed(seedDataset(new Date(DEPLOYED_AT)));
    const { selector: subject, lines } = selector("2026-10-05T12:10:00.000Z");
    expect(await subject.run()).toEqual({
      eventsScanned: 1,
      attemptsCreated: 1,
      duplicatesSkipped: 0,
    });
    expect(queue.sent).toEqual([
      {
        eventId: COMMUNITY_EVENT_ID,
        registrationId: SEED_REGISTRATION_ID,
        scheduledFor: SCHEDULED_FOR,
      },
    ]);
    expect(lines.at(-1)).toMatchObject({
      event: "REMINDER_SELECTION_COMPLETED",
      attemptsCreated: 1,
    });
  });

  it("still selects the seeded event when the first run comes 45 minutes after seeding (slow deploy)", async () => {
    fake.seed(seedDataset(new Date(DEPLOYED_AT)));
    const { selector: subject } = selector("2026-10-05T12:45:00.000Z");
    expect(await subject.run()).toEqual({
      eventsScanned: 1,
      attemptsCreated: 1,
      duplicatesSkipped: 0,
    });
    expect(queue.sent).toEqual([
      {
        eventId: COMMUNITY_EVENT_ID,
        registrationId: SEED_REGISTRATION_ID,
        scheduledFor: SCHEDULED_FOR,
      },
    ]);
  });

  it("never duplicates across the many 15-minute runs that see the same event", async () => {
    fake.seed(seedDataset(new Date(DEPLOYED_AT)));
    await selector("2026-10-05T12:00:00.000Z").selector.run();
    const second = await selector("2026-10-05T12:15:00.000Z").selector.run();
    const last = await selector("2026-10-05T12:59:59.999Z").selector.run();
    expect(second).toEqual({ eventsScanned: 1, attemptsCreated: 0, duplicatesSkipped: 1 });
    expect(last).toEqual({ eventsScanned: 1, attemptsCreated: 0, duplicatesSkipped: 1 });
    expect(queue.sent).toHaveLength(1);
  });

  it("includes the window start and excludes the window end and outside events", async () => {
    const now = "2026-10-05T00:00:00.000Z";
    fake.seed([
      seedEvent("starts-at-from", "2026-10-05T23:00:00.000Z"),
      seedEvent("starts-at-to", "2026-10-06T01:00:00.000Z"),
      seedEvent("too-early", "2026-10-05T22:59:59.999Z"),
      seedEvent("too-late", "2026-10-06T01:00:00.001Z"),
      ...["starts-at-from", "starts-at-to", "too-early", "too-late"].map((id) =>
        seedRegistration(id, `reg-${id}`, `${id}@example.com`),
      ),
    ]);
    await selector(now).selector.run();
    expect(queue.sent.map((message) => message.eventId)).toEqual(["starts-at-from"]);
  });

  it("excludes cancelled, deleted, archived, and rescheduled events and non-confirmed registrations", async () => {
    const now = "2026-10-05T12:00:00.000Z";
    fake.seed([
      withLifecycle(seedEvent("cancelled", EVENT_START), "cancelled"),
      withLifecycle(seedEvent("deleted", EVENT_START), "deleted"),
      withLifecycle(seedEvent("archived", EVENT_START), "archived"),
      // Edited to start a week later: its GSI7 key moved out of the window.
      seedEvent("rescheduled", "2026-10-13T12:00:00.000Z"),
      seedEvent("active", EVENT_START),
      seedRegistration("active", "waiter", "w@example.com", "waitlisted", now),
      seedRegistration("active", "gone", "g@example.com", "cancelled"),
      ...["cancelled", "deleted", "archived", "rescheduled"].map((id) =>
        seedRegistration(id, `reg-${id}`, `${id}@example.com`),
      ),
    ]);
    expect(await selector(now).selector.run()).toEqual({
      eventsScanned: 1,
      attemptsCreated: 0,
      duplicatesSkipped: 0,
    });
    expect(queue.sent).toEqual([]);
  });

  it("rolls the attempt back when the enqueue fails, so a retry can create it again", async () => {
    fake.seed(seedDataset(new Date(DEPLOYED_AT)));
    queue.failures = 1;
    const { selector: subject, lines } = selector(DEPLOYED_AT);
    await expect(subject.run()).rejects.toBeInstanceOf(ReminderEnqueueError);
    expect(
      fake.get(`REMINDER#${COMMUNITY_EVENT_ID}`, `REG#${SEED_REGISTRATION_ID}`),
    ).toBeUndefined();
    expect(lines.some((line) => line.event === "REMINDER_ENQUEUE_FAILED")).toBe(true);
    expect(await selector(DEPLOYED_AT).selector.run()).toMatchObject({ attemptsCreated: 1 });
    expect(queue.sent).toHaveLength(1);
  });

  it("still throws, and logs, when the rollback itself fails", async () => {
    fake.seed(seedDataset(new Date(DEPLOYED_AT)));
    queue.failures = 1;
    fake.failNext("DeleteCommand", awsError("InternalServerError", "rollback failed"));
    const { selector: subject, lines } = selector(DEPLOYED_AT);
    await expect(subject.run()).rejects.toThrow(/rolled back/);
    expect(lines.map((line) => line.event)).toContain("REMINDER_ROLLBACK_FAILED");
  });

  it("propagates repository failures instead of reporting success", async () => {
    fake.failNext("QueryCommand", awsError("InternalServerError", "boom"));
    await expect(selector(DEPLOYED_AT).selector.run()).rejects.toThrow(/boom/);
  });
});

describe("ReminderWorker", () => {
  const message: ReminderQueueMessageV1 = {
    eventId: COMMUNITY_EVENT_ID,
    registrationId: SEED_REGISTRATION_ID,
    scheduledFor: SCHEDULED_FOR,
  };
  let sender: FakeSender;

  async function prepare(): Promise<void> {
    fake.seed(seedDataset(new Date(DEPLOYED_AT)));
    await selector(DEPLOYED_AT).selector.run();
  }

  function worker(emailSender: EmailSender = sender) {
    const { logger, lines } = recordingLogger();
    return {
      lines,
      worker: new ReminderWorker({
        repository: new ReminderRepository(fake.asClient(), TABLE),
        sender: emailSender,
        clock: fixedClock("2026-10-05T12:00:05.000Z"),
        logger,
      }),
    };
  }

  beforeEach(() => {
    sender = new FakeSender();
  });

  it("delivers and records `sent`, writing a log line with no PII in log mode", async () => {
    await prepare();
    const written: string[] = [];
    const { worker: subject } = worker(new LogEmailSender((line) => written.push(line)));
    expect(await subject.process(message)).toEqual({ outcome: "sent" });
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0])).toEqual({
      type: "reminder",
      eventId: COMMUNITY_EVENT_ID,
      registrationId: SEED_REGISTRATION_ID,
      scheduledFor: SCHEDULED_FOR,
      startsAt: EVENT_START,
      mode: "log",
    });
    expect(written[0]).not.toMatch(/displayName|email|normalizedEmail|token|Synthetic Resident/i);
    expect(fake.get(`REMINDER#${COMMUNITY_EVENT_ID}`, `REG#${SEED_REGISTRATION_ID}`)).toMatchObject(
      {
        outcome: "sent",
        deliveredAt: "2026-10-05T12:00:05.000Z",
        outcomeReason: "delivered-log",
      },
    );
  });

  it("never delivers the same attempt twice", async () => {
    await prepare();
    const { worker: subject } = worker();
    await subject.process(message);
    expect(await subject.process(message)).toEqual({
      outcome: "skipped",
      reason: "already-recorded",
    });
    expect(sender.delivered).toHaveLength(1);
  });

  it("skips and records a skip when the event is no longer active", async () => {
    await prepare();
    const meta = fake.get(`EVENT#${COMMUNITY_EVENT_ID}`, "META");
    fake.seed([withLifecycle(meta ?? {}, "cancelled")]);
    const { worker: subject, lines } = worker();
    expect(await subject.process(message)).toEqual({
      outcome: "skipped",
      reason: "event-unavailable",
    });
    expect(sender.delivered).toEqual([]);
    expect(fake.get(`REMINDER#${COMMUNITY_EVENT_ID}`, `REG#${SEED_REGISTRATION_ID}`)).toMatchObject(
      {
        outcome: "skipped",
        outcomeReason: "event-unavailable",
      },
    );
    expect(lines.at(-1)).toMatchObject({ event: "REMINDER_SKIPPED", reason: "event-unavailable" });
  });

  it("skips a rescheduled event and a registration that is no longer confirmed", async () => {
    await prepare();
    const meta = fake.get(`EVENT#${COMMUNITY_EVENT_ID}`, "META") ?? {};
    fake.seed([{ ...meta, startsAt: "2026-10-07T12:00:00.000Z" }]);
    expect(await worker().worker.process(message)).toEqual({
      outcome: "skipped",
      reason: "event-rescheduled",
    });

    fake = new FakeDynamoDb(TABLE);
    await prepare();
    const registration = fake.all().find((item) => item.registrationId === SEED_REGISTRATION_ID);
    fake.seed([{ ...registration, status: "cancelled", gsi5pk: "x", gsi5sk: "y" }]);
    expect(await worker().worker.process(message)).toEqual({
      outcome: "skipped",
      reason: "registration-not-confirmed",
    });
    expect(sender.delivered).toEqual([]);
  });

  it("skips without recording when the selector rolled the attempt back", async () => {
    fake.seed(seedDataset(new Date(DEPLOYED_AT)));
    expect(await worker().worker.process(message)).toEqual({
      outcome: "skipped",
      reason: "attempt-missing",
    });
  });

  it("propagates a delivery failure and leaves the attempt queued for the SQS retry", async () => {
    await prepare();
    sender.failNext = true;
    await expect(worker().worker.process(message)).rejects.toThrow(/delivery failed/);
    expect(fake.get(`REMINDER#${COMMUNITY_EVENT_ID}`, `REG#${SEED_REGISTRATION_ID}`)).toMatchObject(
      {
        outcome: "queued",
      },
    );
    expect(await worker().worker.process(message)).toEqual({ outcome: "sent" });
  });
});

describe("AWS adapters", () => {
  const delivery: ReminderDelivery = {
    eventId: "e1",
    registrationId: "r1",
    scheduledFor: SCHEDULED_FOR,
    startsAt: EVENT_START,
    eventTitle: "Community Market",
    recipientEmail: "resident.one@example.com",
  };

  it("sends a validated C-05 body to SQS and fails without a MessageId", async () => {
    const commands: SendMessageCommand[] = [];
    let messageId: string | undefined = "m-1";
    const client = {
      send: (async (command: SendMessageCommand) => {
        commands.push(command);
        return { MessageId: messageId };
      }) as never,
    };
    const sqs = new SqsReminderQueue(client, "https://sqs.example.com/queue");
    await sqs.send({ eventId: "e1", registrationId: "r1", scheduledFor: SCHEDULED_FOR });
    expect(commands[0].input).toEqual({
      QueueUrl: "https://sqs.example.com/queue",
      MessageBody: `{"eventId":"e1","registrationId":"r1","scheduledFor":"${SCHEDULED_FOR}"}`,
    });
    messageId = undefined;
    await expect(
      sqs.send({ eventId: "e1", registrationId: "r1", scheduledFor: SCHEDULED_FOR }),
    ).rejects.toThrow(/did not acknowledge/);
    await expect(
      sqs.send({ eventId: "e1", registrationId: "r1", scheduledFor: "soon" }),
    ).rejects.toThrow(/Invalid reminder/);
  });

  it("sends SES email to the confirmed recipient and validates addresses", async () => {
    const commands: SendEmailCommand[] = [];
    let messageId: string | undefined = "ses-1";
    const client = {
      send: (async (command: SendEmailCommand) => {
        commands.push(command);
        return { MessageId: messageId };
      }) as never,
    };
    const ses = new SesEmailSender(client, "sender@example.com");
    await ses.deliver(delivery);
    expect(commands[0].input).toMatchObject({
      FromEmailAddress: "sender@example.com",
      Destination: { ToAddresses: ["resident.one@example.com"] },
    });
    messageId = undefined;
    await expect(ses.deliver(delivery)).rejects.toThrow(/did not accept/);
    await expect(ses.deliver({ ...delivery, recipientEmail: "" })).rejects.toThrow(/deliverable/);
    expect(() => new SesEmailSender(client, "not-an-address")).toThrow(/REMINDER_SENDER_EMAIL/);
  });
});
