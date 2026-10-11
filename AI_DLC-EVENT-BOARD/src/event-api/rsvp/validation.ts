import { validationError } from "../http/errors.js";
import { requireObject, requireTrimmedString } from "../http/fields.js";

export const DISPLAY_NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RsvpInput {
  displayName: string;
  /** Lower-cased, trimmed email: the RSVP identity together with eventId (FR5.2). */
  normalizedEmail: string;
}

export function validateRsvpInput(body: unknown): RsvpInput {
  const source = requireObject(body, ["displayName", "email"]);
  const displayName = requireTrimmedString(source, "displayName", DISPLAY_NAME_MAX_LENGTH);
  const email = requireTrimmedString(source, "email", EMAIL_MAX_LENGTH);
  if (!EMAIL_PATTERN.test(email)) {
    throw validationError("email", "email must be a valid email address.");
  }
  return { displayName, normalizedEmail: email.toLowerCase() };
}

/**
 * Requires the cancelToken field. A present but malformed token is not a
 * validation error: the service reports it as an unknown token (404).
 */
export function validateCancelInput(body: unknown): string {
  const source = requireObject(body, ["cancelToken"]);
  const token = source.cancelToken;
  if (typeof token !== "string" || token.length === 0) {
    throw validationError("cancelToken", "cancelToken is required.");
  }
  return token;
}
