// In-memory ports shared by the C7 unit tests. The fake clock only advances when
// the test advances it, so a 600-second profile runs in milliseconds.
import type { ClockPort } from "../../../scripts/evidence/load-runner.js";

export class FakeClock implements ClockPort {
  now = 0;
  private timers: Array<{ at: number; resolve: () => void }> = [];

  nowMs(): number {
    return this.now;
  }

  sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push({ at: this.now + milliseconds, resolve });
    });
  }

  /** Drives virtual time forward until no timer remains. */
  async runUntilIdle(): Promise<void> {
    await flush();
    while (this.timers.length > 0) {
      const next = Math.min(...this.timers.map((timer) => timer.at));
      this.now = next;
      const due = this.timers.filter((timer) => timer.at === next);
      this.timers = this.timers.filter((timer) => timer.at !== next);
      due.forEach((timer) => timer.resolve());
      await flush();
    }
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
