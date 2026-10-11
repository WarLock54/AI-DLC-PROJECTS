import { activeEventKeys } from "../../../src/event-api/events/event-keys.js";
import { createSeedFixtures } from "../../../src/seed/fixtures.js";
import { FakeDynamoDb, type Item } from "./fake-dynamodb.js";

export const TABLE_NAME = "team32-ceb-events";
export const NOW = new Date("2030-01-15T12:00:00.000Z");
export const ORGANIZER = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORGANIZER = "22222222-2222-4222-8222-222222222222";
export const ADMIN = "33333333-3333-4333-8333-333333333333";
export const SEED_EVENT_ID = "seed-event-community-market";

export function seedItems(): Item[] {
  return createSeedFixtures({ organizerSubject: ORGANIZER, clock: () => NOW });
}

export function fakeWithSeed(): FakeDynamoDb {
  const fake = new FakeDynamoDb(TABLE_NAME);
  fake.seed(seedItems());
  return fake;
}

export interface EventItemOptions {
  eventId: string;
  startsAt?: string;
  capacity?: number;
  confirmedRsvpCount?: number;
  waitlistCount?: number;
  organizerSubject?: string;
  category?: string;
  location?: string;
  lifecycleStatus?: string;
}

/** An active Event META item in the C-03 v1 shape. */
export function eventItem(options: EventItemOptions): Item {
  const record = {
    eventId: options.eventId,
    title: `Event ${options.eventId}`,
    description: "Synthetic event.",
    startsAt: options.startsAt ?? "2030-02-01T10:00:00.000Z",
    location: options.location ?? "Community Hall",
    category: options.category ?? "Community",
    capacity: options.capacity ?? 5,
    confirmedRsvpCount: options.confirmedRsvpCount ?? 0,
    organizerSubject: options.organizerSubject ?? ORGANIZER,
    lifecycleStatus: options.lifecycleStatus ?? "active",
    schemaVersion: 1,
  };
  const item: Item = { ...activeEventKeys(record), ...record };
  if (record.lifecycleStatus !== "active") {
    // Non-active events leave the public indexes (Q4) and move their GSI7 partition.
    for (const attribute of ["gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk", "gsi3pk", "gsi3sk"]) {
      delete item[attribute];
    }
    item.gsi7pk = `LIFECYCLE#${record.lifecycleStatus}`;
  }
  if (options.waitlistCount !== undefined) {
    item.waitlistCount = options.waitlistCount;
  }
  return item;
}

/** Sequential deterministic identifiers: `${prefix}-0001`, `${prefix}-0002`, ... */
export function sequentialIds(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}-${String(++counter).padStart(4, "0")}`;
}

/** A clock that advances one millisecond per call from NOW. */
export function steppingClock(start = NOW): () => Date {
  let offset = 0;
  return () => new Date(start.getTime() + offset++);
}
