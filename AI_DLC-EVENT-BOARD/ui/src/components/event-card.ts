// EventCard: one active event with title link, metadata, availability text,
// optional decorative banner, and a View event link to its stable URL.
import type { EventSummary } from "../api/types.js";
import { el, link } from "../dom.js";
import { capacityText, formatDateTime } from "../format.js";

export function detailPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

export function metadataList(event: EventSummary): HTMLDListElement {
  const rows: [string, string][] = [
    ["Date and time", formatDateTime(event.startsAt)],
    ["Location", event.location],
    ["Category", event.category],
    ["Availability", capacityText(event.capacity, event.confirmedRsvpCount)],
  ];
  return el(
    "dl",
    { className: "meta" },
    rows.flatMap(([term, value]) => [el("dt", { text: term }), el("dd", { text: value })]),
  );
}

export function bannerImage(
  bannerReference: string | null | undefined,
  testid: string,
): HTMLImageElement | null {
  if (!bannerReference) {
    return null;
  }
  // Decorative: the event title next to it carries the meaning.
  return el("img", {
    testid,
    className: "banner",
    attrs: { src: `/${bannerReference}`, alt: "", loading: "lazy" },
  });
}

export function createEventCard(event: EventSummary): HTMLLIElement {
  const href = detailPath(event.eventId);
  const view = link(href, "View event", "event-card-view-link", "button-link");
  view.setAttribute("aria-label", `View event: ${event.title}`);
  return el("li", {}, [
    el("article", { testid: "event-card", className: "card" }, [
      bannerImage(event.bannerReference, "event-card-banner"),
      el("h3", {}, [link(href, event.title, "event-card-title-link")]),
      metadataList(event),
      view,
    ]),
  ]);
}
