// FR9.3/FR9.6 post-deploy archival step: invoke the archival function once
// (C-06 mode postDeploy), fail on any per-event failure, then prove the seeded
// older-than-one-year event has a readable archive/ object and is absent from
// the public API. Prints counts and status only.
import { parseArchiveObject } from "../../src/operations/archival/archive-object.js";
import { archiveObjectKey } from "../../src/operations/shared/keys.js";
import { requireHttpsSiteUrl } from "./outputs.js";

export const ARCHIVE_CANDIDATE_ID = "seed-event-archive-candidate";

export interface ArchivalCounts {
  scanned: number;
  archived: number;
  skippedAlreadyArchived: number;
  failures: number;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

export interface ArchiveInvokePorts {
  /** Invokes the function synchronously; throws on a function error. */
  invokeArchival(functionName: string, payload: { mode: "postDeploy" }): Promise<unknown>;
  /** The object's text, or undefined when the key does not exist. */
  readObject(bucket: string, key: string): Promise<string | undefined>;
  getJson(url: URL): Promise<HttpResult>;
  log(line: string): void;
}

export interface ArchiveInvokeOutputs {
  ArchiveFunctionName: string;
  ArchiveBucketName: string;
  SiteUrl: string;
}

const COUNT_FIELDS = ["scanned", "archived", "skippedAlreadyArchived", "failures"] as const;

/** Requires exactly the C-06 response: four non-negative integers. */
export function validateArchivalResponse(value: unknown): ArchivalCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The archival function did not return a C-06 response object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...COUNT_FIELDS].sort().join(",")) {
    throw new Error("The archival response does not have exactly the C-06 fields.");
  }
  for (const field of COUNT_FIELDS) {
    const count = record[field];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`The archival response field ${field} is not a non-negative integer.`);
    }
  }
  return record as unknown as ArchivalCounts;
}

export async function runArchiveInvoke(
  outputs: ArchiveInvokeOutputs,
  ports: ArchiveInvokePorts,
): Promise<ArchivalCounts> {
  const siteUrl = requireHttpsSiteUrl(outputs.SiteUrl);
  const counts = validateArchivalResponse(
    await ports.invokeArchival(outputs.ArchiveFunctionName, { mode: "postDeploy" }),
  );
  ports.log(
    `Archival run: scanned=${counts.scanned} archived=${counts.archived} ` +
      `skippedAlreadyArchived=${counts.skippedAlreadyArchived} failures=${counts.failures}`,
  );
  if (counts.failures > 0) {
    throw new Error(`The archival run reported ${counts.failures} failed event(s).`);
  }

  const key = archiveObjectKey(ARCHIVE_CANDIDATE_ID);
  const text = await ports.readObject(outputs.ArchiveBucketName, key);
  if (text === undefined) {
    throw new Error(`The archive object ${key} does not exist.`);
  }
  const archive = parseArchiveObject(text, ARCHIVE_CANDIDATE_ID);
  ports.log(
    `Archive object ${key} is readable: schemaVersion=${archive.schemaVersion} ` +
      `registrations=${archive.registrations.length}`,
  );

  const list = await ports.getJson(new URL("/api/events", siteUrl));
  const events = (list.body as { events?: unknown } | null)?.events;
  if (list.status !== 200 || !Array.isArray(events)) {
    throw new Error(`GET /api/events returned HTTP ${list.status} without an events list.`);
  }
  if (events.some((event) => (event as { eventId?: unknown })?.eventId === ARCHIVE_CANDIDATE_ID)) {
    throw new Error("The archived event is still listed by GET /api/events.");
  }
  const detail = await ports.getJson(new URL(`/api/events/${ARCHIVE_CANDIDATE_ID}`, siteUrl));
  if (detail.status !== 404) {
    throw new Error(`GET /api/events/{archived id} returned HTTP ${detail.status}, not 404.`);
  }
  ports.log("The archived event is absent from the public event list and detail URL.");
  return counts;
}
