// C5 time rules. Every stored timestamp uses the canonical fixed-width UTC form
// YYYY-MM-DDTHH:mm:ss.sssZ, so lexicographic key comparison matches time order.
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

/** FR7.1: a reminder is due 24 hours before the event starts. */
export const REMINDER_LEAD_MS = 24 * HOUR_MS;

/**
 * Q3 B: the selector picks events starting in [now+23h, now+25h). The wide
 * window lets the seeded event (start = foundation CreationTime + 24h) still be
 * selected when the deploy takes longer than 15 minutes before the schedule
 * exists. ReminderAttempt put-if-absent keeps it to one reminder per registration.
 */
export const REMINDER_WINDOW_START_MS = 23 * HOUR_MS;
export const REMINDER_WINDOW_END_MS = 25 * HOUR_MS;

export interface TimeWindow {
  /** Inclusive lower bound (canonical timestamp). */
  from: string;
  /** Exclusive upper bound (canonical timestamp). */
  to: string;
}

/** Fails fast on a clock that returns anything but a valid Date. */
export function requireValidDate(value: unknown, label = "clock"): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`The ${label} must return a valid Date.`);
  }
  return value;
}

export function toCanonicalTimestamp(value: Date): string {
  return requireValidDate(value, "timestamp").toISOString();
}

export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * C-03 archive eligibility cutoff: `now` minus one calendar year, keeping the
 * time of day. When the anniversary is February 29 and the target year is not
 * a leap year, the cutoff clamps to February 28. Events whose startsAt is
 * strictly earlier than the cutoff are eligible.
 */
export function archiveCutoff(now: Date): string {
  const reference = requireValidDate(now);
  const year = reference.getUTCFullYear() - 1;
  const month = reference.getUTCMonth();
  let day = reference.getUTCDate();
  if (month === 1 && day === 29 && !isLeapYear(year)) {
    day = 28;
  }
  const cutoff = new Date(reference.getTime());
  cutoff.setUTCFullYear(year, month, day);
  return cutoff.toISOString();
}

/** Q3 B reminder selection window relative to `now`. */
export function reminderWindow(now: Date): TimeWindow {
  const reference = requireValidDate(now).getTime();
  return {
    from: new Date(reference + REMINDER_WINDOW_START_MS).toISOString(),
    to: new Date(reference + REMINDER_WINDOW_END_MS).toISOString(),
  };
}

/** The moment a reminder for an event starting at `startsAt` is due. */
export function reminderScheduledFor(startsAt: string): string {
  if (!isCanonicalTimestamp(startsAt)) {
    throw new Error("Event startsAt must be a canonical millisecond UTC timestamp.");
  }
  return new Date(new Date(startsAt).getTime() - REMINDER_LEAD_MS).toISOString();
}
