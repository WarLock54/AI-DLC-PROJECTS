import { describe, expect, it } from "vitest";
import { COPY } from "../../../ui/src/copy.js";
import { liveText, setValue, startApp, submit } from "./support/app.js";
import { FakeApi, flush } from "./support/fake-api.js";

describe("public event list (D10, US1.1)", () => {
  it("announces loading while the list request is pending", async () => {
    const api = new FakeApi();
    let release: () => void = () => undefined;
    api.on("GET", /^\/api\/events$/, async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { status: 200, body: { events: [] } };
    });
    const pending = startApp("/events", { api });
    await flush();
    expect(liveText()).toBe(COPY.loadingEvents);
    expect(document.querySelector('[data-testid="events-loading"]')).not.toBeNull();
    expect(
      (document.querySelector('[data-testid="filter-apply"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    release();
    await pending;
  });

  it("renders cards with capacity text and stable detail links", async () => {
    const { allByTestId } = await startApp("/events");
    const cards = allByTestId("event-card");
    expect(cards).toHaveLength(4);
    expect(liveText()).toBe("4 events found");
    const market = cards.find((card) => card.textContent?.includes("Community Market"));
    expect(market?.textContent).toContain("1 of 50 places taken");
    const cleanup = cards.find((card) => card.textContent?.includes("Riverside Cleanup"));
    expect(cleanup?.textContent).toContain("Full — waitlist open");
    const titleLink = market?.querySelector<HTMLAnchorElement>(
      '[data-testid="event-card-title-link"]',
    );
    expect(titleLink?.getAttribute("href")).toBe("/events/seed-event-community-market");
    expect(
      market?.querySelector('[data-testid="event-card-view-link"]')?.getAttribute("aria-label"),
    ).toBe("View event: Community Market");
  });

  it("derives sorted, de-duplicated category and location options from the list", async () => {
    const { byTestId } = await startApp("/events");
    const options = (id: string): string[] =>
      [...byTestId<HTMLSelectElement>(id).options].map((option) => option.value);
    expect(options("filter-category")).toEqual(["", "Community", "Food", "Volunteer"]);
    expect(options("filter-location")).toEqual([
      "",
      "Community Hall",
      "Riverside Park",
      "Town Square",
    ]);
  });

  it("sends the chosen filter combination only when Apply is used", async () => {
    const { api, byTestId, allByTestId } = await startApp("/events");
    setValue(byTestId<HTMLSelectElement>("filter-category"), "Food");
    setValue(byTestId<HTMLInputElement>("filter-date"), "2030-02-07");
    await flush();
    expect(api.requestsTo("GET", "/api/events")).toHaveLength(1);
    submit(byTestId<HTMLFormElement>("event-filters"));
    await flush();
    const last = api.requestsTo("GET", "/api/events").at(-1);
    expect(last?.url.searchParams.get("category")).toBe("Food");
    expect(last?.url.searchParams.get("date")).toBe("2030-02-07");
    expect(last?.url.searchParams.has("location")).toBe(false);
    expect(allByTestId("event-card")).toHaveLength(1);
  });

  it("restores the defaults and reloads on Clear filters", async () => {
    const { api, byTestId, allByTestId } = await startApp("/events");
    setValue(byTestId<HTMLSelectElement>("filter-location"), "Town Square");
    submit(byTestId<HTMLFormElement>("event-filters"));
    await flush();
    byTestId("filter-clear").click();
    await flush();
    expect(byTestId<HTMLSelectElement>("filter-location").value).toBe("");
    expect(api.requestsTo("GET", "/api/events").at(-1)?.url.search).toBe("");
    expect(allByTestId("event-card")).toHaveLength(4);
  });

  it("shows the zero-result message with a Clear filters action", async () => {
    const { byTestId, allByTestId } = await startApp("/events");
    setValue(byTestId<HTMLInputElement>("filter-date"), "2031-01-01");
    submit(byTestId<HTMLFormElement>("event-filters"));
    await flush();
    expect(byTestId("events-empty").textContent).toBe(COPY.noEventsMatch);
    expect(liveText()).toBe("0 events found");
    byTestId("events-empty-clear").click();
    await flush();
    expect(byTestId<HTMLInputElement>("filter-date").value).toBe("");
    expect(allByTestId("event-card")).toHaveLength(4);
  });

  it("keeps selections on a fetch failure and reloads them on Retry", async () => {
    const { api, byTestId, allByTestId } = await startApp("/events");
    api.on("GET", /^\/api\/events$/, () => "network-error");
    setValue(byTestId<HTMLSelectElement>("filter-category"), "Community");
    submit(byTestId<HTMLFormElement>("event-filters"));
    await flush();
    expect(byTestId("events-error").textContent).toBe(COPY.eventsLoadError);
    expect(byTestId<HTMLSelectElement>("filter-category").value).toBe("Community");
    api.on("GET", /^\/api\/events$/, () => ({ status: 200, body: { events: [] } }));
    byTestId("events-retry").click();
    await flush();
    expect(api.requestsTo("GET", "/api/events").at(-1)?.url.searchParams.get("category")).toBe(
      "Community",
    );
    expect(allByTestId("events-error")).toHaveLength(0);
  });

  it("shows a banner image only for events with a bannerReference", async () => {
    const { allByTestId } = await startApp("/events");
    const banners = allByTestId<HTMLImageElement>("event-card-banner");
    expect(banners).toHaveLength(1);
    expect(banners[0].getAttribute("src")).toBe(
      "/banners/synthetic-event-river-cleanup/banner-1.png",
    );
    expect(banners[0].getAttribute("alt")).toBe("");
  });
});
