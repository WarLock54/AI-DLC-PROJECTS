import {
  ACTIVE_EVENTS_PARTITION,
  categoryPartition,
  locationPartition,
} from "../events/event-keys.js";
import type { EventRecord, EventRepository, PublicQuery } from "../events/event-repository.js";
import {
  byStartTime,
  toEventDetail,
  toEventSummary,
  type EventDetail,
  type EventSummary,
} from "../events/event-views.js";
import { notFound, validationError } from "../http/errors.js";
import { requireEventId } from "../http/fields.js";
import type { ViewRecorder } from "./view-recorder.js";
import { LIST_VIEW_EVENT_ID } from "./view-keys.js";

export interface DiscoveryDependencies {
  events: Pick<EventRepository, "get" | "queryPublic">;
  views: Pick<ViewRecorder, "record">;
  clock: () => Date;
}

export type ListQuery = Record<string, string | undefined>;

const FILTER_MAX_LENGTH = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// "~" sorts after every character used in START#{ISO timestamp}#EVENT#{id}.
const OPEN_UPPER_BOUND = "START#~";

/** D10 public discovery: active, upcoming events only; no owner or RSVP data. */
export class DiscoveryService {
  constructor(private readonly deps: DiscoveryDependencies) {}

  async listEvents(query: ListQuery): Promise<{ events: EventSummary[] }> {
    const category = optionalFilter(query, "category");
    const location = optionalFilter(query, "location");
    const day = parseDay(query.date);
    const now = this.deps.clock().toISOString();
    const records = await this.deps.events.queryPublic(publicQuery(category, location, day));
    const events = records
      .filter((event) => event.lifecycleStatus === "active" && event.startsAt > now)
      .filter((event) => location === undefined || event.location === location)
      .sort(byStartTime)
      .map(toEventSummary);
    await this.deps.views.record("list", LIST_VIEW_EVENT_ID);
    return { events };
  }

  /** Any active event, past or upcoming, is readable at its stable URL. */
  async getEvent(eventId: string | undefined): Promise<EventDetail> {
    const id = requireEventId(eventId);
    const event: EventRecord | undefined = await this.deps.events.get(id);
    if (!event || event.lifecycleStatus !== "active") {
      throw notFound("Event not found.", "id");
    }
    await this.deps.views.record("detail", id);
    return toEventDetail(event);
  }
}

function publicQuery(
  category: string | undefined,
  location: string | undefined,
  day: { from: string; to: string } | undefined,
): PublicQuery {
  const bounds = {
    fromSortKey: day ? `START#${day.from}` : "START#",
    toSortKey: day ? `START#${day.to}` : OPEN_UPPER_BOUND,
  };
  if (category !== undefined) {
    // Category and location together: GSI2, then filter on location.
    return { index: "GSI2", partitionKey: categoryPartition(category), ...bounds };
  }
  if (location !== undefined) {
    return { index: "GSI3", partitionKey: locationPartition(location), ...bounds };
  }
  return { index: "GSI1", partitionKey: ACTIVE_EVENTS_PARTITION, ...bounds };
}

function optionalFilter(query: ListQuery, field: "category" | "location"): string | undefined {
  const value = query[field]?.trim();
  if (!value) {
    return undefined;
  }
  if (value.length > FILTER_MAX_LENGTH) {
    throw validationError(field, `${field} must be at most ${FILTER_MAX_LENGTH} characters.`);
  }
  return value;
}

/** A UTC calendar day `YYYY-MM-DD` as [day start, next day start) bounds. */
function parseDay(value: string | undefined): { from: string; to: string } | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const trimmed = value.trim();
  const start = new Date(`${trimmed}T00:00:00.000Z`);
  if (
    !DATE_PATTERN.test(trimmed) ||
    !Number.isFinite(start.getTime()) ||
    start.toISOString().slice(0, 10) !== trimmed
  ) {
    throw validationError("date", "date must be a calendar date in YYYY-MM-DD format.");
  }
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  // The exclusive next-day bound works with BETWEEN because every stored key
  // continues with "#EVENT#...", which sorts after the bare timestamp.
  return { from: start.toISOString(), to: next.toISOString() };
}
