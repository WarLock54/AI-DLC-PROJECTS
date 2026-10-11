// C-03 v1 Event META keys, identical to the shipped C1 seed shapes in
// src/seed/fixtures.ts. EventManagement owns these keys; RSVP only reads META.
export type LifecycleStatus = "active" | "archived" | "deleted" | "cancelled";

export interface EventKeyInput {
  eventId: string;
  startsAt: string;
  organizerSubject: string;
  category: string;
  location: string;
}

export interface EventPrimaryKey {
  pk: string;
  sk: string;
}

export interface ActiveEventKeys extends EventPrimaryKey {
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  gsi3pk: string;
  gsi3sk: string;
  gsi4pk: string;
  gsi4sk: string;
  gsi7pk: string;
  gsi7sk: string;
  entityType: "Event";
}

/** Public-index attributes removed when an event leaves the active set (Q4). */
export const PUBLIC_INDEX_ATTRIBUTES = [
  "gsi1pk",
  "gsi1sk",
  "gsi2pk",
  "gsi2sk",
  "gsi3pk",
  "gsi3sk",
] as const;

export const ACTIVE_EVENTS_PARTITION = "EVENT#ACTIVE";

export function startKey(startsAt: string, eventId: string): string {
  return `START#${startsAt}#EVENT#${eventId}`;
}

export function eventPrimaryKey(eventId: string): EventPrimaryKey {
  return { pk: `EVENT#${eventId}`, sk: "META" };
}

export function categoryPartition(category: string): string {
  return `CATEGORY#${category}#ACTIVE`;
}

export function locationPartition(location: string): string {
  return `LOCATION#${location}#ACTIVE`;
}

export function organizerPartition(organizerSubject: string): string {
  return `ORGANIZER#${organizerSubject}`;
}

export function lifecyclePartition(status: LifecycleStatus): string {
  return `LIFECYCLE#${status}`;
}

export function activeEventKeys(input: EventKeyInput): ActiveEventKeys {
  const sortKey = startKey(input.startsAt, input.eventId);
  return {
    ...eventPrimaryKey(input.eventId),
    gsi1pk: ACTIVE_EVENTS_PARTITION,
    gsi1sk: sortKey,
    gsi2pk: categoryPartition(input.category),
    gsi2sk: sortKey,
    gsi3pk: locationPartition(input.location),
    gsi3sk: sortKey,
    gsi4pk: organizerPartition(input.organizerSubject),
    gsi4sk: sortKey,
    gsi7pk: lifecyclePartition("active"),
    gsi7sk: sortKey,
    entityType: "Event",
  };
}

export interface SoftDeleteKeyTransition {
  remove: readonly (typeof PUBLIC_INDEX_ATTRIBUTES)[number][];
  set: { gsi7pk: string };
}

/**
 * Q4 soft delete: drop GSI1-GSI3 and move GSI7 to LIFECYCLE#deleted. The GSI7
 * sort key (START#{startsAt}#EVENT#{eventId}) is left as the last update wrote it.
 */
export function softDeleteKeyTransition(): SoftDeleteKeyTransition {
  return {
    remove: PUBLIC_INDEX_ATTRIBUTES,
    set: { gsi7pk: lifecyclePartition("deleted") },
  };
}
