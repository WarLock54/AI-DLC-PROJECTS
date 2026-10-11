import { createHash } from "node:crypto";

export interface SeedItem {
  pk: string;
  sk: string;
  [attribute: string]: string | number | boolean;
}

export interface SeedFixtureOptions {
  organizerSubject: string;
  clock: () => Date;
}

export function createSeedFixtures({ organizerSubject, clock }: SeedFixtureOptions): SeedItem[] {
  if (!isValidCognitoSubject(organizerSubject)) {
    throw new Error("Seed fixtures require a valid Cognito organizer subject.");
  }
  const reference = clock();
  if (!(reference instanceof Date) || !Number.isFinite(reference.getTime())) {
    throw new Error("Seed fixture clock must return a valid Date.");
  }
  const reminderStart = new Date(reference.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const olderStart = new Date(reference.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const eventId = "seed-event-community-market";
  const email = "resident.one@example.com";
  const registrationId = "seed-registration-resident-one";
  const cancellationTokenDigest = createHash("sha256")
    .update(`seed-registration:${eventId}:${email}`)
    .digest("hex");

  const currentEvent: SeedItem = {
    ...eventKeys(eventId, reminderStart, organizerSubject, "Community", "Community Hall"),
    eventId,
    title: "Community Market",
    description: "Synthetic event fixture for foundation verification.",
    startsAt: reminderStart,
    location: "Community Hall",
    category: "Community",
    capacity: 50,
    confirmedRsvpCount: 1,
    organizerSubject,
    lifecycleStatus: "active",
    schemaVersion: 1,
  };

  const archiveCandidateId = "seed-event-archive-candidate";
  const archiveCandidate: SeedItem = {
    ...eventKeys(archiveCandidateId, olderStart, organizerSubject, "Community", "Community Hall"),
    eventId: archiveCandidateId,
    title: "Historical Community Meetup",
    description: "Synthetic older-than-one-year archive eligibility fixture.",
    startsAt: olderStart,
    location: "Community Hall",
    category: "Community",
    capacity: 20,
    confirmedRsvpCount: 0,
    organizerSubject,
    lifecycleStatus: "active",
    schemaVersion: 1,
  };

  const registration: SeedItem = {
    pk: `EVENT#${eventId}`,
    sk: `REG#${email}`,
    gsi5pk: `REGISTRATION#EVENT#${eventId}#STATUS#confirmed`,
    gsi5sk: `WAITLIST##REG#${registrationId}`,
    gsi6pk: `CANCEL#${cancellationTokenDigest}`,
    gsi6sk: `EVENT#${eventId}#REG#${registrationId}`,
    registrationId,
    eventId,
    displayName: "Synthetic Resident One",
    normalizedEmail: email,
    status: "confirmed",
    cancellationTokenDigest,
    schemaVersion: 1,
  };

  return [currentEvent, archiveCandidate, registration];
}

export function validateSeedFixtures(items: readonly SeedItem[]): void {
  if (items.length === 0) {
    throw new Error("Seed fixture set must not be empty.");
  }

  const keys = new Set<string>();
  for (const item of items) {
    if (!item.pk || !item.sk) {
      throw new Error("Every seed fixture must include non-empty pk and sk values.");
    }
    const key = `${item.pk}\u0000${item.sk}`;
    if (keys.has(key)) {
      throw new Error(`Duplicate deterministic seed key: ${item.pk}/${item.sk}.`);
    }
    keys.add(key);
    if (
      typeof item.normalizedEmail === "string" &&
      !item.normalizedEmail.endsWith("@example.com")
    ) {
      throw new Error("Seed identity email addresses must use the synthetic example.com domain.");
    }
    if ("password" in item || "token" in item || "secret" in item) {
      throw new Error("Seed fixtures must not contain credentials, tokens, or secret values.");
    }
    if (
      typeof item.capacity === "number" &&
      typeof item.confirmedRsvpCount === "number" &&
      item.confirmedRsvpCount > item.capacity
    ) {
      throw new Error("Seed event confirmedRsvpCount must not exceed capacity.");
    }
    if (item.entityType === "Event" || (item.pk.startsWith("EVENT#") && item.sk === "META")) {
      validateEventFixture(item);
    }
  }
}

function validateEventFixture(item: SeedItem): void {
  if (item.entityType !== "Event") {
    throw new Error("Seed Event entityType must be Event.");
  }
  const requiredStrings = [
    "eventId",
    "title",
    "description",
    "startsAt",
    "location",
    "category",
    "organizerSubject",
    "lifecycleStatus",
  ] as const;
  for (const attribute of requiredStrings) {
    if (typeof item[attribute] !== "string" || item[attribute].length === 0) {
      throw new Error(`Seed Event ${attribute} must be a non-empty string.`);
    }
  }
  if (
    typeof item.capacity !== "number" ||
    !Number.isSafeInteger(item.capacity) ||
    item.capacity < 1
  ) {
    throw new Error("Seed Event capacity must be a positive safe integer.");
  }
  if (
    typeof item.confirmedRsvpCount !== "number" ||
    !Number.isSafeInteger(item.confirmedRsvpCount) ||
    item.confirmedRsvpCount < 0
  ) {
    throw new Error("Seed Event confirmedRsvpCount must be a non-negative safe integer.");
  }

  const eventId = item.eventId as string;
  const startsAt = item.startsAt as string;
  const category = item.category as string;
  const location = item.location as string;
  const lifecycleStatus = item.lifecycleStatus as string;
  const organizerSubject = item.organizerSubject as string;
  const startKey = `START#${startsAt}#EVENT#${eventId}`;
  if (!isCanonicalTimestamp(startsAt)) {
    throw new Error("Seed Event startsAt must use canonical millisecond UTC format.");
  }
  if (!isValidCognitoSubject(organizerSubject)) {
    throw new Error("Seed Event organizerSubject must be a valid Cognito subject.");
  }
  if (lifecycleStatus !== "active") {
    throw new Error("Seed Event lifecycleStatus must be active during initialization.");
  }
  const expectedKeys = {
    pk: `EVENT#${eventId}`,
    sk: "META",
    gsi1pk: "EVENT#ACTIVE",
    gsi1sk: startKey,
    gsi2pk: `CATEGORY#${category}#ACTIVE`,
    gsi2sk: startKey,
    gsi3pk: `LOCATION#${location}#ACTIVE`,
    gsi3sk: startKey,
    gsi4pk: `ORGANIZER#${organizerSubject}`,
    gsi4sk: startKey,
    gsi7pk: `LIFECYCLE#${lifecycleStatus}`,
    gsi7sk: startKey,
  };
  for (const [attribute, expected] of Object.entries(expectedKeys)) {
    if (item[attribute] !== expected) {
      throw new Error(`Seed Event ${attribute} must match its C-03 v1 value.`);
    }
  }
}

function eventKeys(
  eventId: string,
  startsAt: string,
  organizerSubject: string,
  category: string,
  location: string,
): SeedItem {
  const startKey = `START#${startsAt}#EVENT#${eventId}`;
  return {
    pk: `EVENT#${eventId}`,
    sk: "META",
    gsi1pk: "EVENT#ACTIVE",
    gsi1sk: startKey,
    gsi2pk: `CATEGORY#${category}#ACTIVE`,
    gsi2sk: startKey,
    gsi3pk: `LOCATION#${location}#ACTIVE`,
    gsi3sk: startKey,
    gsi4pk: `ORGANIZER#${organizerSubject}`,
    gsi4sk: startKey,
    gsi7pk: "LIFECYCLE#active",
    gsi7sk: startKey,
    entityType: "Event",
  };
}

function isValidCognitoSubject(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
