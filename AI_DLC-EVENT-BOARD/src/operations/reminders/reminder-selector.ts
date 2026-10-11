import { errorName, type OperationsLogger } from "../shared/logger.js";
import { reminderScheduledFor, reminderWindow, requireValidDate } from "../shared/time.js";
import type { ReminderQueue } from "./reminder-queue.js";
import type { ReminderRepository } from "./reminder-repository.js";

export interface ReminderSelectionResult {
  eventsScanned: number;
  attemptsCreated: number;
  duplicatesSkipped: number;
}

export interface ReminderSelectorDependencies {
  repository: Pick<
    ReminderRepository,
    | "findActiveEventsStartingIn"
    | "findConfirmedRegistrations"
    | "createAttempt"
    | "deleteQueuedAttempt"
  >;
  queue: ReminderQueue;
  clock: () => Date;
  logger: OperationsLogger;
}

/** Thrown when a message could not be enqueued; the attempt was rolled back. */
export class ReminderEnqueueError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly registrationId: string,
    options: { cause: unknown },
  ) {
    super("A reminder message could not be enqueued; the attempt was rolled back.", options);
    this.name = "ReminderEnqueueError";
  }
}

/**
 * FR7.1/FR7.4 reminder selection (Q3 B). Runs every 15 minutes: for each
 * active event starting in [now+23h, now+25h), it records one
 * ReminderAttempt per confirmed registration (put-if-absent, so the runs
 * that see each event never duplicate) and enqueues a C-05 message.
 */
export class ReminderSelector {
  constructor(private readonly deps: ReminderSelectorDependencies) {}

  async run(): Promise<ReminderSelectionResult> {
    const now = requireValidDate(this.deps.clock());
    const window = reminderWindow(now);
    const events = await this.deps.repository.findActiveEventsStartingIn(window);
    const result: ReminderSelectionResult = {
      eventsScanned: events.length,
      attemptsCreated: 0,
      duplicatesSkipped: 0,
    };
    for (const event of events) {
      const scheduledFor = reminderScheduledFor(event.startsAt);
      const registrations = await this.deps.repository.findConfirmedRegistrations(event.eventId);
      for (const registration of registrations) {
        const created = await this.deps.repository.createAttempt({
          eventId: event.eventId,
          registrationId: registration.registrationId,
          scheduledFor,
          createdAt: now.toISOString(),
        });
        if (!created) {
          result.duplicatesSkipped += 1;
          continue;
        }
        await this.enqueue(event.eventId, registration.registrationId, scheduledFor);
        result.attemptsCreated += 1;
      }
    }
    this.deps.logger.info({ event: "REMINDER_SELECTION_COMPLETED", ...result });
    return result;
  }

  /**
   * Sends the message; on failure deletes the queued attempt so the next run
   * (or the scheduler retry) can create it again, then rethrows.
   */
  private async enqueue(eventId: string, registrationId: string, scheduledFor: string) {
    try {
      await this.deps.queue.send({ eventId, registrationId, scheduledFor });
    } catch (error) {
      this.deps.logger.error({
        event: "REMINDER_ENQUEUE_FAILED",
        eventId,
        registrationId,
        errorName: errorName(error),
      });
      try {
        await this.deps.repository.deleteQueuedAttempt(eventId, registrationId);
      } catch (rollbackError) {
        this.deps.logger.error({
          event: "REMINDER_ROLLBACK_FAILED",
          eventId,
          registrationId,
          errorName: errorName(rollbackError),
        });
      }
      throw new ReminderEnqueueError(eventId, registrationId, { cause: error });
    }
  }
}
