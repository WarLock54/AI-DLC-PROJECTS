import { ApiError, validationError } from "../http/errors.js";
import { requireObject, requireTrimmedString } from "../http/fields.js";

// D8 limits. Length caps bound item size; they are not requirement-derived.
export const EVENT_FIELD_LIMITS = {
  title: 200,
  description: 5000,
  location: 100,
  category: 100,
} as const;

export const EVENT_WRITE_FIELDS = [
  "title",
  "description",
  "startsAt",
  "location",
  "category",
  "capacity",
] as const;

export interface EventInput {
  title: string;
  description: string;
  /** Canonical UTC `toISOString()` form. */
  startsAt: string;
  location: string;
  category: string;
  capacity: number;
}

export type EventValidationMode = "create" | "update";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * FR4 validation for the C-02 EventWrite body. The future-start rule applies to
 * creation only (FR3.4); updates validate the format.
 */
export function validateEventInput(
  body: unknown,
  mode: EventValidationMode,
  now: Date,
): EventInput {
  const source = requireObject(body, EVENT_WRITE_FIELDS);
  const title = requireTrimmedString(source, "title", EVENT_FIELD_LIMITS.title);
  const description = requireTrimmedString(source, "description", EVENT_FIELD_LIMITS.description);
  const startsAt = parseStartsAt(source.startsAt);
  const location = requireTrimmedString(source, "location", EVENT_FIELD_LIMITS.location);
  const category = requireTrimmedString(source, "category", EVENT_FIELD_LIMITS.category);
  const capacity = parseCapacity(source.capacity);
  if (mode === "create" && new Date(startsAt).getTime() <= now.getTime()) {
    throw new ApiError(
      "EVENT_START_TIME_INVALID",
      "startsAt must be in the future when an event is created.",
      "startsAt",
    );
  }
  return { title, description, startsAt, location, category, capacity };
}

function parseStartsAt(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE_TIME.test(value.trim())) {
    throw validationError("startsAt", "startsAt must be an ISO-8601 date-time with a time zone.");
  }
  const parsed = new Date(value.trim());
  if (!Number.isFinite(parsed.getTime())) {
    throw validationError("startsAt", "startsAt must be a valid date-time.");
  }
  return parsed.toISOString();
}

function parseCapacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw validationError("capacity", "capacity must be an integer greater than zero.");
  }
  return value;
}
