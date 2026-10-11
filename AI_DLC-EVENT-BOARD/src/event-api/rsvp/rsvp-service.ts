import { ApiError, notFound } from "../http/errors.js";
import { requireEventId } from "../http/fields.js";
import type { Logger } from "../http/logger.js";
import type { RegistrationStatus } from "./registration-keys.js";
import type { RegistrationRecord, RsvpRepository } from "./rsvp-repository.js";
import { digestToken, isWellFormedToken, type IssuedToken } from "./token.js";
import { validateCancelInput, validateRsvpInput } from "./validation.js";

export type RsvpStore = Pick<
  RsvpRepository,
  | "getEventCapacity"
  | "getRegistration"
  | "admitConfirmed"
  | "admitWaitlisted"
  | "findWaitlistHead"
  | "promoteHead"
  | "findByTokenDigest"
  | "cancelConfirmed"
  | "cancelWaitlisted"
>;

export interface RsvpServiceDependencies {
  repository: RsvpStore;
  clock: () => Date;
  newId: () => string;
  issueToken: () => IssuedToken;
  logger: Logger;
  /** Backoff between retried transactions; injectable for tests. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export type ActiveStatus = Exclude<RegistrationStatus, "cancelled">;

export type RsvpResult =
  | { statusCode: 201; body: { status: ActiveStatus; cancelToken: string } }
  | { statusCode: 200; body: { status: ActiveStatus } };

/** Attempts for one RSVP or cancellation before failing loudly with a 500. */
export const MAX_TRANSACTION_ATTEMPTS = 8;
/** D2: attempts to promote one waitlist head before deferring promotion. */
export const MAX_HEAD_ATTEMPTS = 3;
/** Upper bound on promotions in one drain, as a guard against runaway loops. */
const MAX_PROMOTIONS_PER_DRAIN = 1000;

const EVENT_NOT_FOUND = "Event not found.";
const TOKEN_NOT_FOUND = "Cancellation token not found.";

/**
 * RSVP, waitlist, and cancellation (FR5). Every count change is a DynamoDB
 * transaction conditioned on Event META and the registration's current status,
 * so confirmed RSVPs can never exceed capacity.
 */
export class RsvpService {
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly deps: RsvpServiceDependencies) {
    this.sleep =
      deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async submitRsvp(eventId: string | undefined, body: unknown): Promise<RsvpResult> {
    const id = requireEventId(eventId);
    const input = validateRsvpInput(body);
    const event = await this.deps.repository.getEventCapacity(id);
    if (!event || event.lifecycleStatus !== "active") {
      throw notFound(EVENT_NOT_FOUND, "id");
    }
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const existing = await this.deps.repository.getRegistration(id, input.normalizedEmail);
      if (existing && existing.status !== "cancelled") {
        return { statusCode: 200, body: { status: existing.status } };
      }
      await this.drain(id);
      const outcome = await this.admit(id, input.displayName, input.normalizedEmail);
      if (outcome) {
        return outcome;
      }
      await this.backoff(attempt);
    }
    throw new Error(`RSVP admission did not settle after ${MAX_TRANSACTION_ATTEMPTS} attempts.`);
  }

  async cancel(body: unknown): Promise<{ status: "cancelled" }> {
    const token = validateCancelInput(body);
    if (!isWellFormedToken(token)) {
      throw notFound(TOKEN_NOT_FOUND, "cancelToken");
    }
    const digest = digestToken(token);
    // D2: GSI6 is eventually consistent; a token used within about a second
    // of its RSVP may not be visible yet and is reported as not found.
    const located = await this.deps.repository.findByTokenDigest(digest);
    if (!located) {
      throw notFound(TOKEN_NOT_FOUND, "cancelToken");
    }
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const registration = await this.deps.repository.getRegistration(
        located.eventId,
        located.normalizedEmail,
      );
      if (
        !registration ||
        registration.registrationId !== located.registrationId ||
        registration.cancellationTokenDigest !== digest
      ) {
        throw notFound(TOKEN_NOT_FOUND, "cancelToken");
      }
      if (registration.status === "cancelled") {
        throw new ApiError(
          "CANCEL_TOKEN_CONSUMED",
          "This cancellation token has already been used.",
          "cancelToken",
        );
      }
      if (await this.cancelRegistration(registration)) {
        return { status: "cancelled" };
      }
      await this.backoff(attempt);
    }
    throw new Error(`RSVP cancellation did not settle after ${MAX_TRANSACTION_ATTEMPTS} attempts.`);
  }

  /** Returns the outcome, or undefined when the attempt must be retried. */
  private async admit(
    eventId: string,
    displayName: string,
    normalizedEmail: string,
  ): Promise<RsvpResult | undefined> {
    const issued = this.deps.issueToken();
    const registration: RegistrationRecord = {
      eventId,
      registrationId: this.deps.newId(),
      normalizedEmail,
      displayName,
      status: "confirmed",
      cancellationTokenDigest: issued.digest,
    };
    const confirmed = await this.deps.repository.admitConfirmed(registration, this.now());
    if (confirmed.ok) {
      return { statusCode: 201, body: { status: "confirmed", cancelToken: issued.token } };
    }
    if (confirmed.reason === "event-unavailable") {
      throw notFound(EVENT_NOT_FOUND, "id");
    }
    if (confirmed.reason !== "capacity") {
      return undefined;
    }
    const waitlistedAt = this.now();
    const waitlisted = await this.deps.repository.admitWaitlisted(
      { ...registration, status: "waitlisted", waitlistedAt },
      waitlistedAt,
    );
    if (waitlisted.ok) {
      return { statusCode: 201, body: { status: "waitlisted", cancelToken: issued.token } };
    }
    if (waitlisted.reason === "event-unavailable") {
      throw notFound(EVENT_NOT_FOUND, "id");
    }
    return undefined;
  }

  /** True when cancelled; false when the status changed and the caller must re-read. */
  private async cancelRegistration(registration: RegistrationRecord): Promise<boolean> {
    const result =
      registration.status === "confirmed"
        ? await this.deps.repository.cancelConfirmed(registration, this.now())
        : await this.deps.repository.cancelWaitlisted(registration, this.now());
    if (result.ok) {
      if (registration.status === "confirmed") {
        await this.drain(registration.eventId);
      }
      return true;
    }
    if (result.reason === "event-unavailable") {
      throw notFound(TOKEN_NOT_FOUND, "cancelToken");
    }
    if (result.reason === "capacity") {
      throw new Error("Event META counters are inconsistent with the registration status.");
    }
    return false;
  }

  /**
   * D4: promote waitlist heads while seats are free. GSI5 is eventually
   * consistent (D2), so a stale head fails its transaction condition; the head
   * is re-read up to MAX_HEAD_ATTEMPTS times before promotion is deferred to
   * the next RSVP or cancellation on this event.
   */
  private async drain(eventId: string): Promise<void> {
    let headAttempts = 0;
    for (let promotions = 0; promotions < MAX_PROMOTIONS_PER_DRAIN; ) {
      const event = await this.deps.repository.getEventCapacity(eventId);
      if (
        !event ||
        event.lifecycleStatus !== "active" ||
        event.confirmedRsvpCount >= event.capacity ||
        event.waitlistCount <= 0
      ) {
        return;
      }
      const head = await this.deps.repository.findWaitlistHead(eventId);
      if (!head) {
        this.deps.logger.warn({
          event: "WAITLIST_PROMOTION_DEFERRED",
          eventId,
          reason: "head-not-visible",
        });
        return;
      }
      const result = await this.deps.repository.promoteHead(head, this.now());
      if (result.ok) {
        promotions += 1;
        headAttempts = 0;
        continue;
      }
      if (result.reason !== "status-changed" && result.reason !== "conflict") {
        return;
      }
      headAttempts += 1;
      if (headAttempts >= MAX_HEAD_ATTEMPTS) {
        this.deps.logger.warn({
          event: "WAITLIST_PROMOTION_DEFERRED",
          eventId,
          reason: "stale-head",
        });
        return;
      }
    }
  }

  private async backoff(attempt: number): Promise<void> {
    // Jittered exponential backoff for TransactionConflict and lost races.
    const ceiling = Math.min(200, 10 * 2 ** attempt);
    await this.sleep(Math.floor(Math.random() * ceiling));
  }

  private now(): string {
    return this.deps.clock().toISOString();
  }
}
