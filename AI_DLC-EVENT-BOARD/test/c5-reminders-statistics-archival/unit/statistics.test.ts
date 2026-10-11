import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../../src/event-api/http/errors.js";
import { StatisticsRepository } from "../../../src/operations/statistics/statistics-repository.js";
import { StatisticsService } from "../../../src/operations/statistics/statistics-service.js";
import { FakeDynamoDb, awsError } from "../support/fake-dynamodb.js";
import { seedDataset, seedEvent, seedView, withLifecycle } from "../support/fixtures.js";

const TABLE = "team32-ceb-events";
const ADMIN = { sub: "admin-subject", "cognito:groups": ["admin"] };

interface ExpectedStats {
  exact: { totalRsvps: number; popularCategories: { category: string; count: number }[] };
  lowerBound: { pageViews: number; detailViews: number };
}

// The documented FR8.4 oracle; the test and the pipeline check read the same file.
const expected = JSON.parse(
  readFileSync(new URL("../../../docs/expected-stats.json", import.meta.url), "utf8"),
) as ExpectedStats;

let fake: FakeDynamoDb;

function service(): StatisticsService {
  return new StatisticsService({ repository: new StatisticsRepository(fake.asClient(), TABLE) });
}

beforeEach(() => {
  fake = new FakeDynamoDb(TABLE);
});

describe("StatisticsService", () => {
  it("matches docs/expected-stats.json exactly for the seed dataset", async () => {
    fake.seed(seedDataset(new Date("2026-10-05T12:00:00.000Z")));
    const stats = await service().get(ADMIN);
    expect({ totalRsvps: stats.totalRsvps, popularCategories: stats.popularCategories }).toEqual(
      expected.exact,
    );
    expect(stats).toEqual({ ...expected.exact, pageViews: 0, detailViews: 0 });
  });

  it("keeps the RSVP oracle after the archive candidate has been archived", async () => {
    const seed = seedDataset(new Date("2026-10-05T12:00:00.000Z"));
    fake.seed(seed.filter((item) => item.eventId !== "seed-event-archive-candidate"));
    const stats = await service().get(ADMIN);
    expect(stats.totalRsvps).toBe(expected.exact.totalRsvps);
    expect(stats.popularCategories).toEqual(expected.exact.popularCategories);
  });

  it("counts waitlisted RSVPs, ranks by count then name, and drops zero categories", async () => {
    fake.seed([
      seedEvent("a", "2026-11-01T00:00:00.000Z", { category: "Sports", confirmedRsvpCount: 2 }),
      seedEvent("b", "2026-11-02T00:00:00.000Z", {
        category: "Arts",
        confirmedRsvpCount: 1,
        waitlistCount: 1,
      }),
      seedEvent("c", "2026-11-03T00:00:00.000Z", { category: "Music", confirmedRsvpCount: 3 }),
      seedEvent("d", "2026-11-04T00:00:00.000Z", { category: "Empty" }),
      withLifecycle(
        seedEvent("e", "2026-11-05T00:00:00.000Z", { category: "Gone", confirmedRsvpCount: 5 }),
        "deleted",
      ),
      seedView("v1", "list", "2026-10-05T00:00:00.000Z"),
      seedView("v2", "list", "2026-10-05T00:00:01.000Z"),
      seedView("v3", "detail", "2026-10-05T00:00:02.000Z"),
    ]);
    expect(await service().get(ADMIN)).toEqual({
      totalRsvps: 7,
      pageViews: 2,
      detailViews: 1,
      popularCategories: [
        { category: "Music", count: 3 },
        { category: "Arts", count: 2 },
        { category: "Sports", count: 2 },
      ],
    });
  });

  it.each([
    ["no claims", undefined, "AUTHENTICATION_REQUIRED", 401],
    ["claims without a subject", { "cognito:groups": ["admin"] }, "AUTHENTICATION_REQUIRED", 401],
    ["an organizer", { sub: "o", "cognito:groups": ["organizer"] }, "FORBIDDEN", 403],
    ["a user without groups", { sub: "u" }, "FORBIDDEN", 403],
  ])("rejects %s before reading any data", async (_, claims, code, status) => {
    const error = await service()
      .get(claims)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    expect((error as ApiError).statusCode).toBe(status);
    expect(fake.commands).toEqual([]);
  });

  it("accepts the bracketed string form of cognito:groups", async () => {
    expect(await service().get({ sub: "a", "cognito:groups": "[organizer admin]" })).toMatchObject({
      totalRsvps: 0,
    });
  });

  it("surfaces repository failures", async () => {
    fake.failNext("QueryCommand", awsError("InternalServerError", "boom"));
    await expect(service().get(ADMIN)).rejects.toThrow(/boom/);
  });
});
