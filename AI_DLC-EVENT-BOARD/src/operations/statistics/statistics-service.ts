import { requireAuthenticated, requireGroup, type Claims } from "../../event-api/access/policy.js";
import type { StatisticsRepository } from "./statistics-repository.js";

/** C-02 AdminStats response. */
export interface AdminStats {
  totalRsvps: number;
  pageViews: number;
  detailViews: number;
  popularCategories: { category: string; count: number }[];
}

export interface StatisticsDependencies {
  repository: Pick<StatisticsRepository, "listActiveEventCounters" | "countViews">;
}

/**
 * FR8 admin statistics (Q4 A, working Group C decision):
 * - totalRsvps: sum of confirmedRsvpCount + waitlistCount over active events;
 * - pageViews/detailViews: number of EventView items of each type;
 * - popularCategories: the same RSVP sum per category, counts above zero only,
 *   sorted by count descending, then category name ascending.
 * Only principals in the `admin` group may read them (FR8.3).
 */
export class StatisticsService {
  constructor(private readonly deps: StatisticsDependencies) {}

  async get(claims: Claims): Promise<AdminStats> {
    const principal = requireAuthenticated(claims);
    requireGroup(principal, ["admin"]);
    const [counters, pageViews, detailViews] = await Promise.all([
      this.deps.repository.listActiveEventCounters(),
      this.deps.repository.countViews("list"),
      this.deps.repository.countViews("detail"),
    ]);
    const byCategory = new Map<string, number>();
    let totalRsvps = 0;
    for (const counter of counters) {
      const rsvps = counter.confirmedRsvpCount + counter.waitlistCount;
      totalRsvps += rsvps;
      byCategory.set(counter.category, (byCategory.get(counter.category) ?? 0) + rsvps);
    }
    const popularCategories = [...byCategory]
      .filter(([, count]) => count > 0)
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || compare(left.category, right.category));
    return { totalRsvps, pageViews, detailViews, popularCategories };
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
