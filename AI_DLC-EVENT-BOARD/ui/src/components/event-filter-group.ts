// EventFilterGroup: date/category/location filters with explicit Apply and
// Clear filters actions. Nothing auto-submits on selection.
import type { EventFilters } from "../api/types.js";
import { el, replaceChildren } from "../dom.js";

export interface FilterGroup {
  form: HTMLFormElement;
  values(): EventFilters;
  setOptions(categories: readonly string[], locations: readonly string[]): void;
  reset(): void;
  setLoading(loading: boolean): void;
}

export interface FilterHandlers {
  onApply(filters: EventFilters): void;
  onClear(): void;
}

function labelled(id: string, text: string, control: HTMLElement): HTMLDivElement {
  return el("div", { className: "field" }, [el("label", { text, attrs: { for: id } }), control]);
}

function anyOption(text: string): HTMLOptionElement {
  return el("option", { text, attrs: { value: "" } });
}

export function createEventFilterGroup(handlers: FilterHandlers): FilterGroup {
  const date = el("input", {
    testid: "filter-date",
    attrs: { id: "filter-date", type: "date", name: "date" },
  });
  const category = el("select", { testid: "filter-category", attrs: { id: "filter-category" } }, [
    anyOption("All categories"),
  ]);
  const location = el("select", { testid: "filter-location", attrs: { id: "filter-location" } }, [
    anyOption("All locations"),
  ]);
  const apply = el("button", { text: "Apply", testid: "filter-apply", attrs: { type: "submit" } });
  const clearButton = el("button", {
    text: "Clear filters",
    testid: "filter-clear",
    className: "secondary",
    attrs: { type: "button" },
  });
  const form = el(
    "form",
    { testid: "event-filters", className: "filters", attrs: { "aria-label": "Event filters" } },
    [
      labelled("filter-date", "Date", date),
      labelled("filter-category", "Category", category),
      labelled("filter-location", "Location", location),
      el("div", { className: "actions" }, [apply, clearButton]),
    ],
  );

  const values = (): EventFilters => ({
    date: date.value || undefined,
    category: category.value || undefined,
    location: location.value || undefined,
  });
  const reset = (): void => {
    date.value = "";
    category.value = "";
    location.value = "";
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.onApply(values());
  });
  clearButton.addEventListener("click", () => {
    reset();
    handlers.onClear();
  });

  return {
    form,
    values,
    reset,
    setOptions: (categories, locations) => {
      replaceChildren(category, [
        anyOption("All categories"),
        ...categories.map((value) => el("option", { text: value, attrs: { value } })),
      ]);
      replaceChildren(location, [
        anyOption("All locations"),
        ...locations.map((value) => el("option", { text: value, attrs: { value } })),
      ]);
    },
    setLoading: (loading) => {
      apply.disabled = loading;
      form.setAttribute("aria-busy", String(loading));
    },
  };
}

/** Sorted, de-duplicated option values from a loaded list (D10). */
export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ""))].sort((a, b) => a.localeCompare(b));
}
