// D10: public event list with filters, loading, empty, and error/retry states.
import type { EventFilters, EventSummary } from "../api/types.js";
import { createEventCard } from "../components/event-card.js";
import { createEventFilterGroup, uniqueSorted } from "../components/event-filter-group.js";
import { COPY } from "../copy.js";
import { el, replaceChildren } from "../dom.js";
import type { PageContext } from "./context.js";

const PLACEHOLDER_COUNT = 3;

export async function renderEventsList(ctx: PageContext): Promise<void> {
  ctx.setTitle("Browse community events");
  let optionsLoaded = false;
  let lastFilters: EventFilters = {};

  const resultHeading = el("h2", { text: "Events", testid: "events-result-heading" });
  const resultBody = el("div", { testid: "events-results" });
  const filters = createEventFilterGroup({
    onApply: (selected) => void load(selected),
    onClear: () => void load({}),
  });

  const load = async (selected: EventFilters): Promise<void> => {
    lastFilters = selected;
    filters.setLoading(true);
    ctx.announce(COPY.loadingEvents);
    replaceChildren(resultBody, [placeholders()]);
    try {
      const events = await ctx.api.listEvents(selected);
      if (!optionsLoaded) {
        filters.setOptions(
          uniqueSorted(events.map((event) => event.category)),
          uniqueSorted(events.map((event) => event.location)),
        );
        optionsLoaded = true;
      }
      showEvents(events);
    } catch {
      showError();
    } finally {
      filters.setLoading(false);
    }
  };

  const showEvents = (events: EventSummary[]): void => {
    const count = `${events.length} ${events.length === 1 ? "event" : "events"} found`;
    resultHeading.textContent = count;
    ctx.announce(count);
    if (events.length === 0) {
      const clearButton = el("button", {
        text: "Clear filters",
        testid: "events-empty-clear",
        className: "secondary",
        attrs: { type: "button" },
        on: {
          click: () => {
            filters.reset();
            void load({});
          },
        },
      });
      replaceChildren(resultBody, [
        el("p", { text: COPY.noEventsMatch, testid: "events-empty" }),
        clearButton,
      ]);
      return;
    }
    replaceChildren(resultBody, [
      el("ul", { className: "card-grid", testid: "events-list" }, events.map(createEventCard)),
    ]);
  };

  // Every list failure (network or API) keeps the selections and offers Retry.
  const showError = (): void => {
    resultHeading.textContent = "Events";
    ctx.announce(COPY.eventsLoadError);
    replaceChildren(resultBody, [
      el("p", { text: COPY.eventsLoadError, testid: "events-error", attrs: { role: "alert" } }),
      el("button", {
        text: COPY.retry,
        testid: "events-retry",
        attrs: { type: "button" },
        on: { click: () => void load(lastFilters) },
      }),
    ]);
  };

  replaceChildren(ctx.main, [
    el("h1", { text: "Browse community events" }),
    el("section", { attrs: { "aria-labelledby": "find-heading" } }, [
      el("h2", { text: "Find an event", attrs: { id: "find-heading" } }),
      filters.form,
    ]),
    el("section", { className: "results" }, [resultHeading, resultBody]),
  ]);
  await load({});
}

function placeholders(): HTMLUListElement {
  const items = Array.from({ length: PLACEHOLDER_COUNT }, () =>
    el("li", { className: "card placeholder", attrs: { "aria-hidden": "true" } }),
  );
  return el("ul", { className: "card-grid", testid: "events-loading" }, items);
}
