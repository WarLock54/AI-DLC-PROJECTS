import { notFound, validationError } from "./errors.js";

export type JsonObject = Record<string, unknown>;

/** Requires a plain JSON object whose keys are all in the allowed set. */
export function requireObject(body: unknown, allowedFields: readonly string[]): JsonObject {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationError("body", "The request body must be a JSON object.");
  }
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw validationError(key, `Unknown field '${key}'.`);
    }
  }
  return body as JsonObject;
}

/** Requires a non-empty string after trimming, bounded by maxLength characters. */
export function requireTrimmedString(source: JsonObject, field: string, maxLength: number): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(field, `${field} is required and must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw validationError(field, `${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

const EVENT_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

/**
 * Validates an event identifier taken from the URL. Identifiers that cannot
 * exist (wrong characters or length) are reported as an unknown event, so the
 * key space is never reachable through crafted path segments.
 */
export function requireEventId(value: string | undefined): string {
  if (value === undefined || !EVENT_ID_PATTERN.test(value)) {
    throw notFound("Event not found.", "id");
  }
  return value;
}
