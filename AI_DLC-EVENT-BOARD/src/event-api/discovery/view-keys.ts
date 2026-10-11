// C-03 EventView item (D11). Statistics (C5) reads these through GSI7.
export type ViewType = "list" | "detail";

/** The list view is recorded with this synthetic event identifier. */
export const LIST_VIEW_EVENT_ID = "LIST";

export interface EventViewInput {
  viewId: string;
  viewType: ViewType;
  eventId: string;
  viewedAt: string;
}

export interface EventViewItem {
  pk: string;
  sk: string;
  gsi4pk: string;
  gsi4sk: string;
  gsi7pk: string;
  gsi7sk: string;
  entityType: "EventView";
  viewId: string;
  viewType: ViewType;
  eventId: string;
  viewedAt: string;
  schemaVersion: 1;
}

export function eventViewItem(input: EventViewInput): EventViewItem {
  const partition = `VIEW#${input.viewType}`;
  const sortKey = `AT#${input.viewedAt}#EVENT#${input.eventId}`;
  return {
    pk: `VIEW#${input.viewId}`,
    sk: "META",
    gsi4pk: partition,
    gsi4sk: sortKey,
    gsi7pk: partition,
    gsi7sk: sortKey,
    entityType: "EventView",
    viewId: input.viewId,
    viewType: input.viewType,
    eventId: input.eventId,
    viewedAt: input.viewedAt,
    schemaVersion: 1,
  };
}
