// D15: admin statistics against the C-02 AdminStats contract. Until C5 adds
// GET /api/admin/stats, the page shows the retryable unavailable state and
// never substitutes zeros for an error.
import type { AdminStats } from "../api/types.js";
import { createAdminStatCard, statValue } from "../components/admin-stat-card.js";
import { COPY } from "../copy.js";
import { el, replaceChildren } from "../dom.js";
import type { PageContext } from "./context.js";

export async function renderAdminStats(ctx: PageContext): Promise<void> {
  ctx.setTitle("Event statistics");
  const updated = el("p", { testid: "stats-updated" });
  const body = el("div", { testid: "stats-body", attrs: { "aria-live": "polite" } });
  const refresh = el("button", {
    text: "Refresh statistics",
    testid: "stats-refresh",
    attrs: { type: "button" },
  });

  const load = async (): Promise<void> => {
    refresh.disabled = true;
    body.setAttribute("aria-busy", "true");
    ctx.announce(COPY.statsLoading);
    replaceChildren(body, [el("p", { text: COPY.statsLoading, testid: "stats-loading" })]);
    try {
      const stats = await ctx.api.getAdminStats();
      showStats(stats);
      updated.textContent = `Data updated ${new Date().toLocaleString()}`;
      ctx.announce("Statistics updated");
    } catch {
      replaceChildren(body, [
        el("p", {
          text: COPY.statsUnavailable,
          testid: "stats-unavailable",
          attrs: { role: "alert" },
        }),
        el("button", {
          text: COPY.retry,
          testid: "stats-retry",
          className: "secondary",
          attrs: { type: "button" },
          on: { click: () => void load() },
        }),
      ]);
      ctx.announce(COPY.statsUnavailable);
    } finally {
      refresh.disabled = false;
      body.removeAttribute("aria-busy");
    }
  };

  const showStats = (stats: AdminStats): void => {
    if (isEmpty(stats)) {
      replaceChildren(body, [el("p", { text: COPY.statsEmpty, testid: "stats-empty" })]);
      return;
    }
    const categories =
      stats.popularCategories.length === 0
        ? el("p", { text: COPY.statsEmpty })
        : el(
            "ol",
            { testid: "stats-categories-list" },
            stats.popularCategories.map(({ category, count }) =>
              el("li", { text: `${category}: ${count.toLocaleString()} RSVPs` }),
            ),
          );
    replaceChildren(body, [
      el("div", { className: "card-grid", testid: "stats-cards" }, [
        createAdminStatCard("Total RSVPs", "stat-total-rsvps", statValue(stats.totalRsvps)),
        createAdminStatCard("Page views", "stat-page-views", statValue(stats.pageViews)),
        createAdminStatCard("Detail views", "stat-detail-views", statValue(stats.detailViews)),
        createAdminStatCard("Popular categories", "stat-popular-categories", categories),
      ]),
    ]);
  };

  refresh.addEventListener("click", () => void load());
  replaceChildren(ctx.main, [el("h1", { text: "Event statistics" }), updated, body, refresh]);
  await load();
}

function isEmpty(stats: AdminStats): boolean {
  return (
    stats.totalRsvps === 0 &&
    stats.pageViews === 0 &&
    stats.detailViews === 0 &&
    stats.popularCategories.length === 0
  );
}
