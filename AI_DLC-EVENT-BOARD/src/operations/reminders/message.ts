// C-05 ReminderQueueMessageV1: exactly {eventId, registrationId, scheduledFor}.
// No names, emails, or tokens ever travel on the queue.
import { isCanonicalTimestamp } from "../shared/time.js";

export interface ReminderQueueMessageV1 {
  eventId: string;
  registrationId: string;
  scheduledFor: string;
}

export const REMINDER_MESSAGE_FIELDS = ["eventId", "registrationId", "scheduledFor"] as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

/** A message that does not match C-05 v1; the worker reports it as a failure. */
export class InvalidReminderMessageError extends Error {
  constructor(reason: string) {
    super(`Invalid reminder queue message: ${reason}`);
    this.name = "InvalidReminderMessageError";
  }
}

/** Validates an already-parsed value against C-05 v1 (strict, no extra fields). */
export function validateReminderMessage(value: unknown): ReminderQueueMessageV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidReminderMessageError("the message must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...REMINDER_MESSAGE_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new InvalidReminderMessageError(
      `the message must contain exactly ${REMINDER_MESSAGE_FIELDS.join(", ")}.`,
    );
  }
  for (const field of ["eventId", "registrationId"] as const) {
    const candidate = record[field];
    if (typeof candidate !== "string" || !IDENTIFIER_PATTERN.test(candidate)) {
      throw new InvalidReminderMessageError(`${field} must be an identifier string.`);
    }
  }
  if (!isCanonicalTimestamp(record.scheduledFor)) {
    throw new InvalidReminderMessageError("scheduledFor must be a canonical UTC timestamp.");
  }
  return {
    eventId: record.eventId as string,
    registrationId: record.registrationId as string,
    scheduledFor: record.scheduledFor,
  };
}

/** Parses an SQS message body. Malformed JSON is an invalid message. */
export function parseReminderMessage(body: string): ReminderQueueMessageV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidReminderMessageError("the body is not valid JSON.");
  }
  return validateReminderMessage(parsed);
}

/** Serializes a message with a fixed field order after validating it. */
export function serializeReminderMessage(message: ReminderQueueMessageV1): string {
  const valid = validateReminderMessage(message);
  return JSON.stringify({
    eventId: valid.eventId,
    registrationId: valid.registrationId,
    scheduledFor: valid.scheduledFor,
  });
}
