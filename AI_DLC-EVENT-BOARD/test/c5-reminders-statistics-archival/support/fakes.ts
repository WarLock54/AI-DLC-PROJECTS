import type { ArchiveStore } from "../../../src/operations/archival/archive-store.js";
import type { OperationsLogger } from "../../../src/operations/shared/logger.js";
import { createOperationsLogger } from "../../../src/operations/shared/logger.js";

/** In-memory S3 archive store; `failNext` makes the next write throw. */
export class FakeArchiveStore implements ArchiveStore {
  public readonly objects = new Map<string, string>();
  public writes = 0;
  private failure: Error | undefined;

  failNext(error: Error): void {
    this.failure = error;
  }

  async putObject(key: string, body: string): Promise<void> {
    await Promise.resolve();
    if (this.failure) {
      const error = this.failure;
      this.failure = undefined;
      throw error;
    }
    this.writes += 1;
    this.objects.set(key, body);
  }
}

/** A logger that keeps every parsed JSON line for assertions. */
export function recordingLogger(): { logger: OperationsLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = createOperationsLogger((line) =>
    lines.push(JSON.parse(line) as Record<string, unknown>),
  );
  return { logger, lines };
}

export function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}
