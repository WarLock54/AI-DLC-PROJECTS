import {
  requireAuthenticated,
  requireGroup,
  requireOwnerOrAdmin,
  type Claims,
} from "../access/policy.js";
import { notFound, validationError } from "../http/errors.js";
import { requireEventId } from "../http/fields.js";
import type { LifecycleStatus } from "./event-keys.js";
import type { EventRecord, EventRepository } from "./event-repository.js";
import { byStartTime, toManagementEvent, type ManagementEvent } from "./event-views.js";
import { validateEventInput } from "./validation.js";

// EventManagement. Unit constraint: this module never imports RSVP code.
export type EventStore = Pick<
  EventRepository,
  "create" | "get" | "update" | "softDelete" | "listByOrganizer" | "listByLifecycle"
>;

export interface EventServiceDependencies {
  repository: EventStore;
  clock: () => Date;
  newId: () => string;
}

const LIFECYCLE_FILTERS: readonly LifecycleStatus[] = [
  "active",
  "archived",
  "deleted",
  "cancelled",
];
const MANAGERS = ["organizer", "admin"] as const;

export class EventService {
  constructor(private readonly deps: EventServiceDependencies) {}

  async create(claims: Claims, body: unknown): Promise<ManagementEvent> {
    const principal = requireAuthenticated(claims);
    requireGroup(principal, MANAGERS);
    const now = this.deps.clock();
    const input = validateEventInput(body, "create", now);
    const record: EventRecord = {
      ...input,
      eventId: this.deps.newId(),
      confirmedRsvpCount: 0,
      waitlistCount: 0,
      // An admin-created event records the admin as its owner (D9).
      organizerSubject: principal.subject,
      lifecycleStatus: "active",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.deps.repository.create(record);
    return toManagementEvent(record);
  }

  async update(
    claims: Claims,
    eventId: string | undefined,
    body: unknown,
  ): Promise<ManagementEvent> {
    const principal = requireAuthenticated(claims);
    requireGroup(principal, MANAGERS);
    const existing = await this.requireActiveEvent(eventId);
    requireOwnerOrAdmin(principal, existing.organizerSubject);
    const now = this.deps.clock();
    const input = validateEventInput(body, "update", now);
    const updated = await this.deps.repository.update(
      existing.eventId,
      existing.organizerSubject,
      input,
      now.toISOString(),
    );
    return toManagementEvent(updated);
  }

  async remove(claims: Claims, eventId: string | undefined): Promise<void> {
    const principal = requireAuthenticated(claims);
    requireGroup(principal, MANAGERS);
    const existing = await this.requireActiveEvent(eventId);
    requireOwnerOrAdmin(principal, existing.organizerSubject);
    await this.deps.repository.softDelete(existing.eventId, this.deps.clock().toISOString());
  }

  async listOrganizerEvents(claims: Claims): Promise<{ events: ManagementEvent[] }> {
    const principal = requireAuthenticated(claims);
    requireGroup(principal, MANAGERS);
    const events = await this.deps.repository.listByOrganizer(principal.subject);
    return { events: events.sort(byStartTime).map(toManagementEvent) };
  }

  async listAdminEvents(
    claims: Claims,
    query: Record<string, string | undefined>,
  ): Promise<{ events: ManagementEvent[] }> {
    const principal = requireAuthenticated(claims);
    requireGroup(principal, ["admin"]);
    const status = (query.status ?? "active") as LifecycleStatus;
    if (!LIFECYCLE_FILTERS.includes(status)) {
      throw validationError("status", `status must be one of: ${LIFECYCLE_FILTERS.join(", ")}.`);
    }
    const organizerSubject = query.organizerSubject?.trim() || undefined;
    if (organizerSubject !== undefined && organizerSubject.length > 128) {
      throw validationError("organizerSubject", "organizerSubject must be at most 128 characters.");
    }
    const events = await this.deps.repository.listByLifecycle(status, organizerSubject);
    return { events: events.sort(byStartTime).map(toManagementEvent) };
  }

  private async requireActiveEvent(eventId: string | undefined): Promise<EventRecord> {
    const id = requireEventId(eventId);
    const event = await this.deps.repository.get(id);
    if (!event || event.lifecycleStatus !== "active") {
      throw notFound("Event not found.", "id");
    }
    return event;
  }
}
