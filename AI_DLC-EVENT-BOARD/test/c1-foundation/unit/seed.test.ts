import { describe, expect, it } from "vitest";
import { resolveSeedReferenceTime } from "../../../src/seed/cli.js";
import { createSeedFixtures, validateSeedFixtures } from "../../../src/seed/fixtures.js";

const REFERENCE = "2030-01-15T12:00:00.000Z";
const ORGANIZER_SUBJECT = "11111111-1111-4111-8111-111111111111";

function fixtures() {
  const fixedClock = new Date(REFERENCE);
  return createSeedFixtures({ organizerSubject: ORGANIZER_SUBJECT, clock: () => fixedClock });
}

describe("deterministic foundation seed fixtures", () => {
  it("generates the same stable fixture set for the same reference time", () => {
    expect(fixtures()).toEqual(fixtures());
  });

  it("uses stable event and registration identifiers", () => {
    const items = fixtures();
    expect(items.map(({ pk, sk }) => `${pk}/${sk}`)).toEqual([
      "EVENT#seed-event-community-market/META",
      "EVENT#seed-event-archive-candidate/META",
      "EVENT#seed-event-community-market/REG#resident.one@example.com",
    ]);
  });

  it("creates the reminder fixture approximately 24 hours after the reference", () => {
    const [event] = fixtures();
    expect(event.startsAt).toBe("2030-01-16T12:00:00.000Z");
  });

  it("creates a lifecycle-indexed archive candidate older than one year", () => {
    const archiveCandidate = fixtures()[1];
    expect(archiveCandidate.gsi7pk).toBe("LIFECYCLE#active");
    expect(archiveCandidate.startsAt).toBe("2028-12-11T12:00:00.000Z");
    expect(Date.parse(REFERENCE) - Date.parse(String(archiveCandidate.startsAt))).toBeGreaterThan(
      365 * 24 * 60 * 60 * 1000,
    );
  });

  it("maps event keys and registration lookup attributes to C-03", () => {
    const items = fixtures();
    expect(items[0]).toMatchObject({
      pk: "EVENT#seed-event-community-market",
      sk: "META",
      eventId: "seed-event-community-market",
      title: "Community Market",
      description: expect.any(String),
      startsAt: "2030-01-16T12:00:00.000Z",
      location: "Community Hall",
      category: "Community",
      capacity: 50,
      confirmedRsvpCount: 1,
      organizerSubject: ORGANIZER_SUBJECT,
      lifecycleStatus: "active",
      gsi1pk: "EVENT#ACTIVE",
      gsi1sk: "START#2030-01-16T12:00:00.000Z#EVENT#seed-event-community-market",
      gsi2pk: "CATEGORY#Community#ACTIVE",
      gsi2sk: "START#2030-01-16T12:00:00.000Z#EVENT#seed-event-community-market",
      gsi3pk: "LOCATION#Community Hall#ACTIVE",
      gsi3sk: "START#2030-01-16T12:00:00.000Z#EVENT#seed-event-community-market",
      gsi4pk: `ORGANIZER#${ORGANIZER_SUBJECT}`,
      gsi4sk: "START#2030-01-16T12:00:00.000Z#EVENT#seed-event-community-market",
      gsi7pk: "LIFECYCLE#active",
      gsi7sk: "START#2030-01-16T12:00:00.000Z#EVENT#seed-event-community-market",
    });
    expect(items[2]).toMatchObject({
      sk: "REG#resident.one@example.com",
      status: "confirmed",
      gsi5pk: "REGISTRATION#EVENT#seed-event-community-market#STATUS#confirmed",
      gsi5sk: "WAITLIST##REG#seed-registration-resident-one",
      gsi6pk: expect.stringMatching(/^CANCEL#[a-f0-9]{64}$/),
    });
    expect(items[2]).not.toHaveProperty("waitlistedAt");
  });

  it("produces identical fixtures for the same stack CreationTime", () => {
    const stackCreationTime = new Date(REFERENCE);
    const first = resolveSeedReferenceTime(undefined, stackCreationTime);
    const second = resolveSeedReferenceTime(undefined, stackCreationTime);
    expect(first.toISOString()).toBe(stackCreationTime.toISOString());
    expect(createSeedFixtures({ organizerSubject: ORGANIZER_SUBJECT, clock: () => first })).toEqual(
      createSeedFixtures({ organizerSubject: ORGANIZER_SUBJECT, clock: () => second }),
    );
  });

  it("uses a valid SEED_REFERENCE_TIME override", () => {
    const override = "2031-02-20T10:30:00.000Z";
    expect(resolveSeedReferenceTime(override, new Date(REFERENCE)).toISOString()).toBe(override);
  });

  it("rejects invalid or non-canonical SEED_REFERENCE_TIME overrides", () => {
    expect(() => resolveSeedReferenceTime("2026-10-04", new Date(REFERENCE))).toThrow(
      /canonical millisecond UTC timestamp/,
    );
    expect(() => resolveSeedReferenceTime("not-a-date", new Date(REFERENCE))).toThrow(
      /canonical millisecond UTC timestamp/,
    );
  });

  it("throws when the seed anchor is missing", () => {
    expect(() => resolveSeedReferenceTime(undefined, undefined)).toThrow(
      /Seed reference time is missing/,
    );
  });

  it("validates synthetic identities and capacity constraints", () => {
    expect(() => validateSeedFixtures(fixtures())).not.toThrow();
    expect(() =>
      validateSeedFixtures([{ pk: "EVENT#x", sk: "META", capacity: 1, confirmedRsvpCount: 2 }]),
    ).toThrow(/must not exceed capacity/);
  });

  it("rejects duplicate or incomplete keys", () => {
    const [event] = fixtures();
    expect(() => validateSeedFixtures([event, event])).toThrow(/Duplicate deterministic seed key/);
    expect(() => validateSeedFixtures([{ pk: "", sk: "META" }])).toThrow(/pk and sk/);
  });

  it("rejects accidental credential fields", () => {
    expect(() =>
      validateSeedFixtures([{ pk: "USER#x", sk: "META", password: "not-allowed" }]),
    ).toThrow(/must not contain credentials/);
  });

  it("rejects malformed organizer subjects and clocks", () => {
    expect(() =>
      createSeedFixtures({ organizerSubject: "seed-organizer", clock: () => new Date(REFERENCE) }),
    ).toThrow(/valid Cognito organizer subject/);
    expect(() =>
      createSeedFixtures({ organizerSubject: ORGANIZER_SUBJECT, clock: () => new Date(NaN) }),
    ).toThrow(/valid Date/);
  });

  it("rejects incomplete Event attributes and mismatched GSI identity", () => {
    const [event, ...others] = fixtures();
    const { title: _title, ...missingTitle } = event;
    expect(_title).toBe(event.title);
    expect(() => validateSeedFixtures([missingTitle, ...others])).toThrow(/title/);
    expect(() =>
      validateSeedFixtures([{ ...event, gsi4pk: "ORGANIZER#other" }, ...others]),
    ).toThrow(/gsi4pk/);
  });
});
