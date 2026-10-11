// Synthetic C5 test data. The seed dataset comes straight from the shipped C1
// builder (src/seed/fixtures.ts), so the statistics and archival oracles run
// against exactly what the pipeline seeds. All addresses use example.com.
import { createHash } from "node:crypto";
import { activeEventKeys } from "../../../src/event-api/events/event-keys.js";
import {
  cancelTokenKeys,
  registrationPrimaryKey,
  registrationStatusKeys,
  type RegistrationStatus,
} from "../../../src/event-api/rsvp/registration-keys.js";
import { createSeedFixtures } from "../../../src/seed/fixtures.js";

export const ORGANIZER_SUBJECT = "11111111-2222-4333-8444-555555555555";
export const COMMUNITY_EVENT_ID = "seed-event-community-market";
export const ARCHIVE_CANDIDATE_ID = "seed-event-archive-candidate";
export const SEED_REGISTRATION_ID = "seed-registration-resident-one";

export type Item = Record<string, unknown>;

/** The C1 seed items for a deploy at `reference`. */
export function seedDataset(reference: Date): Item[] {
  return createSeedFixtures({ organizerSubject: ORGANIZER_SUBJECT, clock: () => reference });
}

export interface EventOverrides {
  category?: string;
  location?: string;
  capacity?: number;
  confirmedRsvpCount?: number;
  waitlistCount?: number;
  title?: string;
}

/** An active Event META item with the C-03 v1 keys. */
export function seedEvent(eventId: string, startsAt: string, overrides: EventOverrides = {}): Item {
  const category = overrides.category ?? "Community";
  const location = overrides.location ?? "Community Hall";
  const item: Item = {
    ...activeEventKeys({
      eventId,
      startsAt,
      organizerSubject: ORGANIZER_SUBJECT,
      category,
      location,
    }),
    eventId,
    title: overrides.title ?? `Synthetic event ${eventId}`,
    description: "Synthetic C5 test event.",
    startsAt,
    location,
    category,
    capacity: overrides.capacity ?? 10,
    confirmedRsvpCount: overrides.confirmedRsvpCount ?? 0,
    organizerSubject: ORGANIZER_SUBJECT,
    lifecycleStatus: "active",
    schemaVersion: 1,
  };
  if (overrides.waitlistCount !== undefined) {
    item.waitlistCount = overrides.waitlistCount;
  }
  return item;
}

/** Moves an Event META item out of the active set (cancelled, deleted, archived). */
export function withLifecycle(event: Item, status: "deleted" | "cancelled" | "archived"): Item {
  const next: Item = { ...event, lifecycleStatus: status, gsi7pk: `LIFECYCLE#${status}` };
  for (const name of ["gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk", "gsi3pk", "gsi3sk"]) {
    delete next[name];
  }
  return next;
}

/** A Registration item with the C-03 v1 keys, a digest, and synthetic PII. */
export function seedRegistration(
  eventId: string,
  registrationId: string,
  email: string,
  status: RegistrationStatus = "confirmed",
  waitlistedAt = "",
): Item {
  const digest = createHash("sha256").update(`${eventId}:${registrationId}`).digest("hex");
  const item: Item = {
    ...registrationPrimaryKey(eventId, email),
    ...cancelTokenKeys(digest, eventId, registrationId),
    entityType: "Registration",
    registrationId,
    eventId,
    displayName: `Synthetic ${registrationId}`,
    normalizedEmail: email,
    status,
    cancellationTokenDigest: digest,
    schemaVersion: 1,
  };
  if (status !== "cancelled") {
    Object.assign(item, registrationStatusKeys(eventId, registrationId, status, waitlistedAt));
  }
  if (waitlistedAt) {
    item.waitlistedAt = waitlistedAt;
  }
  return item;
}

/** An EventView item as C3 records it. */
export function seedView(viewId: string, viewType: "list" | "detail", viewedAt: string): Item {
  const eventId = viewType === "list" ? "LIST" : COMMUNITY_EVENT_ID;
  const sortKey = `AT#${viewedAt}#EVENT#${eventId}`;
  return {
    pk: `VIEW#${viewId}`,
    sk: "META",
    gsi4pk: `VIEW#${viewType}`,
    gsi4sk: sortKey,
    gsi7pk: `VIEW#${viewType}`,
    gsi7sk: sortKey,
    entityType: "EventView",
    viewId,
    viewType,
    eventId,
    viewedAt,
    schemaVersion: 1,
  };
}
