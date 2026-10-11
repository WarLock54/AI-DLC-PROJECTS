// C-03 v1 key shapes owned or read by C5. Event and Registration shapes are
// reused from the C3 key modules so the two units cannot drift apart.
import { lifecyclePartition, startKey } from "../../event-api/events/event-keys.js";
import { registrationStatusKeys } from "../../event-api/rsvp/registration-keys.js";
import type { ViewType } from "../../event-api/discovery/view-keys.js";

export interface PrimaryKey {
  pk: string;
  sk: string;
}

export const ACTIVE_LIFECYCLE_PARTITION = lifecyclePartition("active");
export const ARCHIVED_LIFECYCLE_PARTITION = lifecyclePartition("archived");

/** GSI7 sort-key prefix shared by every Event META item. */
export const START_PREFIX = "START#";

/** Registration sort-key prefix under EVENT#{eventId}. */
export const REGISTRATION_PREFIX = "REG#";

export const ARCHIVE_PREFIX = "archive/";

/** ReminderAttempt primary key: one attempt per (eventId, registrationId). */
export function reminderAttemptKey(eventId: string, registrationId: string): PrimaryKey {
  return { pk: `REMINDER#${eventId}`, sk: `REG#${registrationId}` };
}

/** ReminderAttempt GSI6 keys (C-03): lookup by attempt identity and due time. */
export function reminderAttemptIndexKeys(
  eventId: string,
  registrationId: string,
  scheduledFor: string,
): { gsi6pk: string; gsi6sk: string } {
  return {
    gsi6pk: `REMINDER#${eventId}#${registrationId}`,
    gsi6sk: `SCHEDULED#${scheduledFor}`,
  };
}

/** ArchivedEvent marker kept after Event META is removed (C-03 v1). */
export function archivedEventKey(eventId: string): PrimaryKey {
  return { pk: `EVENT#${eventId}`, sk: "ARCHIVE" };
}

export function eventPartition(eventId: string): string {
  return `EVENT#${eventId}`;
}

/** GSI7 sort-key lower bound (inclusive) for events starting at `timestamp`. */
export function startBound(timestamp: string): string {
  return `${START_PREFIX}${timestamp}`;
}

/**
 * Exclusive GSI7 upper bound for archive eligibility: every key
 * START#{startsAt}#EVENT#{id} with startsAt strictly before `cutoff` sorts
 * below START#{cutoff}#, and an event starting exactly at the cutoff does not.
 */
export function archiveEligibilityUpperBound(cutoff: string): string {
  return `${START_PREFIX}${cutoff}#`;
}

/** GSI7 partition holding EventView items of one type. */
export function viewPartition(viewType: ViewType): string {
  return `VIEW#${viewType}`;
}

/** GSI5 key of a confirmed registration (C-03 v1, empty waitlistedAt). */
export function confirmedRegistrationIndexKeys(
  eventId: string,
  registrationId: string,
): { gsi5pk: string; gsi5sk: string } {
  return registrationStatusKeys(eventId, registrationId, "confirmed");
}

/** C-07 v1 archive object key. */
export function archiveObjectKey(eventId: string): string {
  return `${ARCHIVE_PREFIX}${eventId}.json`;
}

export { startKey };
