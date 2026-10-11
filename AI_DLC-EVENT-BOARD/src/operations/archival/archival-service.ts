import { archiveObjectKey } from "../shared/keys.js";
import { errorName, type OperationsLogger } from "../shared/logger.js";
import { archiveCutoff, isCanonicalTimestamp, requireValidDate } from "../shared/time.js";
import type { ArchivalRepository } from "./archival-repository.js";
import { buildArchiveObject, serializeArchiveObject } from "./archive-object.js";
import type { ArchiveStore } from "./archive-store.js";

export type ArchivalMode = "postDeploy" | "scheduled";

/** C-06 v1 response. */
export interface ArchivalResult {
  scanned: number;
  archived: number;
  skippedAlreadyArchived: number;
  failures: number;
}

export interface ArchivalDependencies {
  repository: Pick<
    ArchivalRepository,
    | "findEligibleEvents"
    | "findResumableEvents"
    | "freeze"
    | "getEvent"
    | "readRegistrations"
    | "deleteRegistrations"
    | "finalize"
  >;
  store: ArchiveStore;
  clock: () => Date;
  logger: OperationsLogger;
}

/** An event whose archival could not be completed in this run. */
export class ArchivalStepError extends Error {
  constructor(
    public readonly code: "NOT_FROZEN",
    message: string,
  ) {
    super(message);
    this.name = "ArchivalStepError";
  }
}

type CompletionResult = "archived" | "already-complete";

/**
 * FR9 archival, C-06/C-07 v1 exactly (Q2 A). For each event:
 * 1. freeze active -> archived (removes public index keys);
 * 2. strongly consistent registration read, then write archive/{eventId}.json;
 * 3. delete the registrations in batches of up to 25;
 * 4. one transaction: put the ARCHIVE marker and delete Event META.
 * Events left frozen by an earlier run are resumed first. Nothing is deleted
 * before the S3 write succeeds, and every per-event failure is counted.
 */
export class ArchivalService {
  constructor(private readonly deps: ArchivalDependencies) {}

  async run(mode: ArchivalMode): Promise<ArchivalResult> {
    const now = requireValidDate(this.deps.clock());
    const archivedAt = now.toISOString();
    const cutoff = archiveCutoff(now);
    const result: ArchivalResult = {
      scanned: 0,
      archived: 0,
      skippedAlreadyArchived: 0,
      failures: 0,
    };

    const resumable = await this.deps.repository.findResumableEvents();
    const resumed = new Set<string>();
    for (const candidate of resumable) {
      resumed.add(candidate.eventId);
      result.scanned += 1;
      await this.attempt(result, candidate.eventId, archivedAt, mode, "resume");
    }

    const eligible = await this.deps.repository.findEligibleEvents(cutoff);
    for (const candidate of eligible) {
      if (resumed.has(candidate.eventId)) {
        continue;
      }
      result.scanned += 1;
      await this.attempt(result, candidate.eventId, archivedAt, mode, "new", cutoff);
    }

    const level = result.failures > 0 ? "error" : "info";
    this.deps.logger[level]({ event: "ARCHIVAL_COMPLETED", mode, cutoff, ...result });
    return result;
  }

  private async attempt(
    result: ArchivalResult,
    eventId: string,
    archivedAt: string,
    mode: ArchivalMode,
    phase: "resume" | "new",
    cutoff?: string,
  ): Promise<void> {
    try {
      if (phase === "new" && cutoff !== undefined) {
        const frozen = await this.deps.repository.freeze(eventId, cutoff, archivedAt);
        if (frozen === "already-archived") {
          result.skippedAlreadyArchived += 1;
          return;
        }
        if (frozen === "not-eligible") {
          this.deps.logger.info({ event: "ARCHIVAL_NOT_ELIGIBLE", eventId, mode });
          return;
        }
      }
      const completion = await this.complete(eventId, archivedAt);
      if (completion === "already-complete") {
        result.skippedAlreadyArchived += 1;
      } else {
        result.archived += 1;
      }
    } catch (error) {
      result.failures += 1;
      this.deps.logger.error({
        event: "ARCHIVAL_EVENT_FAILED",
        eventId,
        mode,
        phase,
        errorName: errorName(error),
        code: error instanceof ArchivalStepError ? error.code : null,
      });
    }
  }

  /** Steps 2-4 for an event that is frozen as `archived`. */
  private async complete(eventId: string, fallbackArchivedAt: string): Promise<CompletionResult> {
    const meta = await this.deps.repository.getEvent(eventId);
    if (!meta) {
      // The GSI7 read is eventually consistent: finalization already removed META.
      return "already-complete";
    }
    if (meta.lifecycleStatus !== "archived") {
      throw new ArchivalStepError("NOT_FROZEN", "Event META is not frozen as archived.");
    }
    // The freeze time is reused on resume, so a rerun writes the same archivedAt.
    const archivedAt = isCanonicalTimestamp(meta.archivedAt) ? meta.archivedAt : fallbackArchivedAt;
    const registrations = await this.deps.repository.readRegistrations(eventId);
    const archive = buildArchiveObject({ archivedAt, event: meta, registrations });
    const key = archiveObjectKey(eventId);
    // No deletion happens unless this write succeeds.
    await this.deps.store.putObject(key, serializeArchiveObject(archive));
    await this.deps.repository.deleteRegistrations(registrations);
    await this.deps.repository.finalize({
      eventId,
      archivedAt,
      archiveReference: key,
      registrationCount: registrations.length,
    });
    this.deps.logger.info({
      event: "EVENT_ARCHIVED",
      eventId,
      archiveReference: key,
      registrationCount: registrations.length,
    });
    return "archived";
  }
}
