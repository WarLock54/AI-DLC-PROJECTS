import { describe, expect, it } from "vitest";
import { COPY } from "../../../ui/src/copy.js";
import { startApp } from "./support/app.js";
import { errorBody, FakeApi, flush } from "./support/fake-api.js";
import { adminSession, organizerSession } from "./support/jwt.js";

const STATS = {
  totalRsvps: 128,
  pageViews: 842,
  detailViews: 311,
  popularCategories: [
    { category: "Food", count: 58 },
    { category: "Community", count: 41 },
  ],
};

function withStats(response: Parameters<FakeApi["on"]>[2]): FakeApi {
  return new FakeApi().on("GET", /^\/api\/admin\/stats$/, response);
}

describe("admin statistics (D15, US3.2, FR8)", () => {
  it("renders the four statistics from AdminStats", async () => {
    const { byTestId } = await startApp("/admin/stats", {
      session: adminSession(),
      api: withStats(() => ({ status: 200, body: STATS })),
    });
    expect(byTestId("stat-total-rsvps").textContent).toContain("Total RSVPs");
    expect(byTestId("stat-total-rsvps").textContent).toContain("128");
    expect(byTestId("stat-page-views").textContent).toContain("842");
    expect(byTestId("stat-detail-views").textContent).toContain("311");
    const categories = [...byTestId("stats-categories-list").querySelectorAll("li")].map(
      (li) => li.textContent,
    );
    expect(categories).toEqual(["Food: 58 RSVPs", "Community: 41 RSVPs"]);
  });

  it("explains empty data", async () => {
    const { byTestId } = await startApp("/admin/stats", {
      session: adminSession(),
      api: withStats(() => ({
        status: 200,
        body: { totalRsvps: 0, pageViews: 0, detailViews: 0, popularCategories: [] },
      })),
    });
    expect(byTestId("stats-empty").textContent).toBe(COPY.statsEmpty);
  });

  it("shows unavailable with Retry and never zeros when the endpoint does not exist yet (404)", async () => {
    const api = new FakeApi(); // No stats route: the fake answers 404 like a pre-C5 deployment.
    const { byTestId } = await startApp("/admin/stats", { session: adminSession(), api });
    expect(byTestId("stats-unavailable").textContent).toBe(COPY.statsUnavailable);
    expect(document.querySelector("main h1")?.textContent).toBe("Event statistics");
    expect(document.querySelector('[data-testid="stats-cards"]')).toBeNull();
    expect(byTestId("stats-body").textContent).not.toMatch(/\b0\b/);
    api.on("GET", /^\/api\/admin\/stats$/, () => ({ status: 200, body: STATS }));
    byTestId("stats-retry").click();
    await flush();
    expect(byTestId("stat-total-rsvps").textContent).toContain("128");
  });

  it("shows unavailable on 403", async () => {
    const { byTestId } = await startApp("/admin/stats", {
      session: adminSession(),
      api: withStats(() => ({ status: 403, body: errorBody("FORBIDDEN") })),
    });
    expect(byTestId("stats-unavailable").textContent).toBe(COPY.statsUnavailable);
  });

  it("disables Refresh while a request is pending", async () => {
    let release: () => void = () => undefined;
    const api = withStats(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { status: 200, body: STATS };
    });
    const pending = startApp("/admin/stats", { session: adminSession(), api });
    await flush();
    const refresh = document.querySelector<HTMLButtonElement>('[data-testid="stats-refresh"]');
    expect(refresh?.disabled).toBe(true);
    release();
    await pending;
    expect(refresh?.disabled).toBe(false);
    refresh?.click();
    expect(refresh?.disabled).toBe(true);
    release();
    await flush();
    expect(api.requestsTo("GET", "/api/admin/stats")).toHaveLength(2);
  });

  it("redirects organizers away through the route guard", async () => {
    const { api } = await startApp("/admin/stats", { session: organizerSession() });
    expect(window.location.pathname).toBe("/organizer/events");
    expect(api.requestsTo("GET", "/api/admin/stats")).toHaveLength(0);
  });
});
