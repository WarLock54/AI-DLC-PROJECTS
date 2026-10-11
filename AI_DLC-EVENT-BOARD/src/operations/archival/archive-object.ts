// C-07 v1 archive object: {schemaVersion:"v1", archivedAt, event, registrations[]}.
// Raw cancel tokens, token digests, and the index keys that embed them are
// never written; the same key is overwritten on reruns (v1, Q2 A).
import { isCanonicalTimestamp } from "../shared/time.js";

export type ArchiveRecord = Record<string, unknown>;

export interface ArchiveObjectV1 {
  schemaVersion: "v1";
  archivedAt: string;
  event: ArchiveRecord;
  registrations: ArchiveRecord[];
}

export interface ArchiveObjectInput {
  archivedAt: string;
  event: ArchiveRecord;
  registrations: readonly ArchiveRecord[];
}

/**
 * Storage keys and token material. GSI6 on a registration is CANCEL#{digest},
 * so every physical key attribute is dropped, not only the named digest.
 */
const KEY_ATTRIBUTE = /^(pk|sk|gsi\d+(pk|sk))$/;
const TOKEN_ATTRIBUTE = /token|digest|secret|password/i;

export function sanitizeRecord(record: ArchiveRecord): ArchiveRecord {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([name, value]) =>
        !KEY_ATTRIBUTE.test(name) && !TOKEN_ATTRIBUTE.test(name) && value !== undefined,
    ),
  );
}

export function buildArchiveObject(input: ArchiveObjectInput): ArchiveObjectV1 {
  if (!isCanonicalTimestamp(input.archivedAt)) {
    throw new Error("archivedAt must be a canonical millisecond UTC timestamp.");
  }
  const eventId = input.event.eventId;
  if (typeof eventId !== "string" || eventId === "") {
    throw new Error("The archived event has no eventId.");
  }
  for (const registration of input.registrations) {
    if (registration.eventId !== eventId) {
      throw new Error("Every archived registration must belong to the archived event.");
    }
  }
  const registrations = input.registrations
    .map(sanitizeRecord)
    .sort((left, right) => compare(String(left.registrationId), String(right.registrationId)));
  return {
    schemaVersion: "v1",
    archivedAt: input.archivedAt,
    event: sanitizeRecord(input.event),
    registrations,
  };
}

export function serializeArchiveObject(archive: ArchiveObjectV1): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

/**
 * Parses and checks a stored object against C-07 v1 for the expected event.
 * Used by the post-deploy evidence check; throws a descriptive error otherwise.
 */
export function parseArchiveObject(text: string, expectedEventId: string): ArchiveObjectV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The archive object is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The archive object must be a JSON object.");
  }
  const archive = parsed as Partial<ArchiveObjectV1>;
  if (archive.schemaVersion !== "v1") {
    throw new Error("The archive object schemaVersion must be v1.");
  }
  if (!isCanonicalTimestamp(archive.archivedAt)) {
    throw new Error("The archive object archivedAt must be a canonical UTC timestamp.");
  }
  if (typeof archive.event !== "object" || archive.event === null) {
    throw new Error("The archive object has no event.");
  }
  if (archive.event.eventId !== expectedEventId) {
    throw new Error("The archive object belongs to a different event.");
  }
  if (!Array.isArray(archive.registrations)) {
    throw new Error("The archive object registrations must be an array.");
  }
  if (TOKEN_ATTRIBUTE.test(JSON.stringify(Object.keys(archive.event)))) {
    throw new Error("The archive object event contains token material.");
  }
  for (const registration of archive.registrations as ArchiveRecord[]) {
    if (Object.keys(registration).some((name) => TOKEN_ATTRIBUTE.test(name))) {
      throw new Error("The archive object registrations contain token material.");
    }
  }
  return archive as ArchiveObjectV1;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
