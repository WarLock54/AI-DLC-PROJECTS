import type { EventRecord } from "./event-repository.js";

// C-02 response shapes. Public shapes never include organizerSubject,
// registrations, or emails (D10).
export interface EventSummary {
  eventId: string;
  title: string;
  startsAt: string;
  location: string;
  category: string;
  capacity: number;
  confirmedRsvpCount: number;
  bannerReference: string | null;
}

export interface EventDetail extends EventSummary {
  description: string;
}

export interface ManagementEvent extends EventDetail {
  organizerSubject: string;
  lifecycleStatus: string;
}

export function toEventSummary(event: EventRecord): EventSummary {
  return {
    eventId: event.eventId,
    title: event.title,
    startsAt: event.startsAt,
    location: event.location,
    category: event.category,
    capacity: event.capacity,
    confirmedRsvpCount: event.confirmedRsvpCount,
    bannerReference: event.bannerReference ?? null,
  };
}

export function toEventDetail(event: EventRecord): EventDetail {
  return { ...toEventSummary(event), description: event.description };
}

export function toManagementEvent(event: EventRecord): ManagementEvent {
  return {
    ...toEventDetail(event),
    organizerSubject: event.organizerSubject,
    lifecycleStatus: event.lifecycleStatus,
  };
}

/** Deterministic ordering: start time, then event identifier (code-unit order). */
export function byStartTime(left: EventRecord, right: EventRecord): number {
  return compare(left.startsAt, right.startsAt) || compare(left.eventId, right.eventId);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
