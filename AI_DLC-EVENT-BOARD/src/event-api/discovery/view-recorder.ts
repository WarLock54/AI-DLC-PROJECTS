import { errorName, type Logger } from "../http/logger.js";
import type { ViewRepository } from "./view-repository.js";
import type { ViewType } from "./view-keys.js";

export interface ViewRecorderDependencies {
  repository: Pick<ViewRepository, "putView">;
  clock: () => Date;
  newId: () => string;
  logger: Logger;
}

/**
 * Records EventView items after a successful read (Q3). A failed write never
 * fails the page; it emits exactly one structured EVENT_VIEW_RECORD_FAILED line
 * with no personal data (Q3a). Metric filters and alarms belong to C6.
 */
export class ViewRecorder {
  constructor(private readonly deps: ViewRecorderDependencies) {}

  async record(viewType: ViewType, eventId: string): Promise<void> {
    try {
      await this.deps.repository.putView({
        viewId: this.deps.newId(),
        viewType,
        eventId,
        viewedAt: this.deps.clock().toISOString(),
      });
    } catch (error) {
      this.deps.logger.error({
        event: "EVENT_VIEW_RECORD_FAILED",
        viewType,
        eventId,
        errorName: errorName(error),
      });
    }
  }
}
