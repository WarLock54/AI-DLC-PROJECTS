import type { OperationsLogger } from "../shared/logger.js";
import { reminderScheduledFor, requireValidDate } from "../shared/time.js";
import type { EmailSender } from "./email-sender.js";
import type { ReminderQueueMessageV1 } from "./message.js";
import type { ReminderRepository } from "./reminder-repository.js";

export type SkipReason =
  | "attempt-missing"
  | "already-recorded"
  | "event-unavailable"
  | "event-rescheduled"
  | "registration-not-confirmed";

export type ReminderProcessResult =
  | { outcome: "sent" }
  | { outcome: "skipped"; reason: SkipReason };

export interface ReminderWorkerDependencies {
  repository: Pick<
    ReminderRepository,
    "getAttempt" | "getEvent" | "findConfirmedRegistration" | "recordOutcome"
  >;
  sender: EmailSender;
  clock: () => Date;
  logger: OperationsLogger;
}

/**
 * FR7.2/FR7.5 reminder delivery (Q3 A). Re-checks current state before
 * delivering: the event must still be active and unchanged, and the
 * registration still confirmed. Every skip is recorded on the attempt and
 * logged; any delivery or storage failure propagates so SQS retries the
 * message and, after the redrive limit, moves it to the DLQ.
 */
export class ReminderWorker {
  constructor(private readonly deps: ReminderWorkerDependencies) {}

  async process(message: ReminderQueueMessageV1): Promise<ReminderProcessResult> {
    const { eventId, registrationId, scheduledFor } = message;
    const attempt = await this.deps.repository.getAttempt(eventId, registrationId);
    if (!attempt) {
      // No attempt means the selector rolled it back; nothing to deliver or record.
      return this.skip(message, "attempt-missing", false);
    }
    if (attempt.outcome !== "queued") {
      // SQS delivers at least once; a recorded outcome is never delivered twice.
      return this.skip(message, "already-recorded", false);
    }
    const event = await this.deps.repository.getEvent(eventId);
    if (!event || event.lifecycleStatus !== "active") {
      return this.skip(message, "event-unavailable", true);
    }
    if (reminderScheduledFor(event.startsAt) !== scheduledFor) {
      return this.skip(message, "event-rescheduled", true);
    }
    const registration = await this.deps.repository.findConfirmedRegistration(
      eventId,
      registrationId,
    );
    if (!registration) {
      return this.skip(message, "registration-not-confirmed", true);
    }
    await this.deps.sender.deliver({
      eventId,
      registrationId,
      scheduledFor,
      startsAt: event.startsAt,
      eventTitle: event.title,
      recipientEmail: registration.normalizedEmail,
    });
    await this.deps.repository.recordOutcome(
      eventId,
      registrationId,
      "sent",
      this.now(),
      `delivered-${this.deps.sender.mode}`,
    );
    return { outcome: "sent" };
  }

  private async skip(
    message: ReminderQueueMessageV1,
    reason: SkipReason,
    record: boolean,
  ): Promise<ReminderProcessResult> {
    if (record) {
      await this.deps.repository.recordOutcome(
        message.eventId,
        message.registrationId,
        "skipped",
        this.now(),
        reason,
      );
    }
    this.deps.logger.warn({
      event: "REMINDER_SKIPPED",
      eventId: message.eventId,
      registrationId: message.registrationId,
      reason,
    });
    return { outcome: "skipped", reason };
  }

  private now(): string {
    return requireValidDate(this.deps.clock()).toISOString();
  }
}
