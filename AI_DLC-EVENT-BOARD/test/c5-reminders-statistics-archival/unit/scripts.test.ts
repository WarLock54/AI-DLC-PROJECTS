import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ArchivalRepository } from "../../../src/operations/archival/archival-repository.js";
import { ArchivalService } from "../../../src/operations/archival/archival-service.js";
import {
  ARCHIVE_CANDIDATE_ID,
  runArchiveInvoke,
  validateArchivalResponse,
  type ArchiveInvokePorts,
  type HttpResult,
} from "../../../scripts/c5/archive-evidence.js";
import { readFoundationOutputs, requireHttpsSiteUrl } from "../../../scripts/c5/outputs.js";
import {
  ADMIN_USERNAME,
  compareStats,
  parseExpectedStats,
  runStatsCheck,
  type StatsCheckPorts,
} from "../../../scripts/c5/stats-comparison.js";
import { FakeDynamoDb } from "../support/fake-dynamodb.js";
import { FakeArchiveStore, fixedClock, recordingLogger } from "../support/fakes.js";
import { seedDataset } from "../support/fixtures.js";

const SITE = "https://d111111abcdef8.cloudfront.net";
const expectedText = readFileSync(
  new URL("../../../docs/expected-stats.json", import.meta.url),
  "utf8",
);
const expected = parseExpectedStats(expectedText);

describe("archive-invoke (FR9.3, FR9.6)", () => {
  let store: FakeArchiveStore;
  let lines: string[];
  let responses: Record<string, HttpResult>;
  let invokeResult: () => Promise<unknown>;

  function ports(): ArchiveInvokePorts {
    return {
      invokeArchival: async (functionName, payload) => {
        expect(functionName).toBe("team32-ceb-archival");
        expect(payload).toEqual({ mode: "postDeploy" });
        return invokeResult();
      },
      readObject: async (bucket, key) => {
        expect(bucket).toBe("team32-ceb-archive-bucket");
        return store.objects.get(key);
      },
      getJson: async (url) => responses[url.pathname] ?? { status: 500, body: null },
      log: (line) => lines.push(line),
    };
  }

  const outputs = {
    ArchiveFunctionName: "team32-ceb-archival",
    ArchiveBucketName: "team32-ceb-archive-bucket",
    SiteUrl: SITE,
  };

  beforeEach(() => {
    store = new FakeArchiveStore();
    lines = [];
    // The real archival service against the seed dataset produces the object.
    const fake = new FakeDynamoDb("team32-ceb-events");
    fake.seed(seedDataset(new Date("2026-10-05T12:00:00.000Z")));
    const service = new ArchivalService({
      repository: new ArchivalRepository(fake.asClient(), "team32-ceb-events"),
      store,
      clock: fixedClock("2026-10-05T12:05:00.000Z"),
      logger: recordingLogger().logger,
    });
    invokeResult = () => service.run("postDeploy");
    responses = {
      "/api/events": {
        status: 200,
        body: { events: [{ eventId: "seed-event-community-market" }] },
      },
      [`/api/events/${ARCHIVE_CANDIDATE_ID}`]: {
        status: 404,
        body: { code: "NOT_FOUND", message: "Event not found.", field: "id" },
      },
    };
  });

  it("passes with a readable v1 object and the event absent from list and detail", async () => {
    expect(await runArchiveInvoke(outputs, ports())).toEqual({
      scanned: 1,
      archived: 1,
      skippedAlreadyArchived: 0,
      failures: 0,
    });
    expect(lines.join("\n")).toMatch(/archived=1/);
    expect(lines.join("\n")).not.toMatch(/example\.com|Synthetic|token/i);
  });

  it("fails when the run reports per-event failures", async () => {
    invokeResult = async () => ({
      scanned: 1,
      archived: 0,
      skippedAlreadyArchived: 0,
      failures: 1,
    });
    await expect(runArchiveInvoke(outputs, ports())).rejects.toThrow(/1 failed event/);
  });

  it("fails when the archive object is missing or invalid", async () => {
    invokeResult = async () => ({
      scanned: 0,
      archived: 0,
      skippedAlreadyArchived: 0,
      failures: 0,
    });
    await expect(runArchiveInvoke(outputs, ports())).rejects.toThrow(/does not exist/);
    store.objects.set(`archive/${ARCHIVE_CANDIDATE_ID}.json`, '{"schemaVersion":"v2"}');
    await expect(runArchiveInvoke(outputs, ports())).rejects.toThrow(/schemaVersion/);
  });

  it("fails when the archived event is still public", async () => {
    responses["/api/events"] = {
      status: 200,
      body: { events: [{ eventId: ARCHIVE_CANDIDATE_ID }] },
    };
    await expect(runArchiveInvoke(outputs, ports())).rejects.toThrow(/still listed/);
  });

  it("fails on a broken list response or a non-404 detail response", async () => {
    responses["/api/events"] = { status: 502, body: null };
    await expect(runArchiveInvoke(outputs, ports())).rejects.toThrow(/HTTP 502/);
    beforeEachReset();
    responses[`/api/events/${ARCHIVE_CANDIDATE_ID}`] = { status: 200, body: {} };
    await expect(runArchiveInvoke(outputs, ports())).rejects.toThrow(/not 404/);
  });

  it.each([
    ["a non-object", null],
    ["a missing field", { scanned: 0, archived: 0, failures: 0 }],
    ["an extra field", { scanned: 0, archived: 0, skippedAlreadyArchived: 0, failures: 0, x: 1 }],
    ["a negative count", { scanned: -1, archived: 0, skippedAlreadyArchived: 0, failures: 0 }],
  ])("rejects a C-06 response with %s", (_, value) => {
    expect(() => validateArchivalResponse(value)).toThrow(/C-06|non-negative/);
  });

  function beforeEachReset(): void {
    responses["/api/events"] = { status: 200, body: { events: [] } };
  }
});

describe("stats-check (FR8.5, Q4 A)", () => {
  const outputs = {
    SiteUrl: SITE,
    UserPoolId: "us-east-1_example",
    UserPoolClientId: "exampleclientid",
    DemoCredentialsSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:demo",
  };
  const matching = {
    totalRsvps: 1,
    pageViews: 4,
    detailViews: 0,
    popularCategories: [{ category: "Community", count: 1 }],
  };

  function ports(body: unknown, status = 200): { ports: StatsCheckPorts; lines: string[] } {
    const lines: string[] = [];
    return {
      lines,
      ports: {
        readAdminPassword: async () => "Synthetic-Admin-Password-1!",
        signIn: async (input) => {
          expect(input).toMatchObject({
            username: ADMIN_USERNAME,
            userPoolId: "us-east-1_example",
          });
          return "header.payload.signature";
        },
        getStats: async (url, idToken) => {
          expect(url.toString()).toBe(`${SITE}/api/admin/stats`);
          expect(idToken).toBe("header.payload.signature");
          return { status, body };
        },
        log: (line) => lines.push(line),
      },
    };
  }

  it("passes when RSVP fields match exactly and views meet the lower bound", async () => {
    const { ports: subject, lines } = ports(matching);
    await runStatsCheck(outputs, expected, subject);
    expect(lines.join("\n")).toMatch(/totalRsvps=1/);
    expect(lines.join("\n")).not.toMatch(/Password|signature/);
  });

  it("fails on a non-200 response", async () => {
    await expect(runStatsCheck(outputs, expected, ports({}, 403).ports)).rejects.toThrow(
      /HTTP 403/,
    );
  });

  it("reports every mismatch", () => {
    expect(
      compareStats(
        { totalRsvps: 2, pageViews: -1, detailViews: 1.5, popularCategories: [], extra: 1 },
        expected,
      ),
    ).toEqual([
      "The statistics response does not have exactly the C-02 AdminStats fields.",
      "totalRsvps is 2, expected 1.",
      "popularCategories does not match the expected values exactly.",
      "pageViews must be an integer of at least 0.",
      "detailViews must be an integer of at least 0.",
    ]);
    expect(compareStats([], expected)).toEqual(["The statistics response is not a JSON object."]);
    expect(compareStats(matching, expected)).toEqual([]);
  });

  it("fails the check with the mismatch list", async () => {
    await expect(
      runStatsCheck(outputs, expected, ports({ ...matching, totalRsvps: 3 }).ports),
    ).rejects.toThrow(/totalRsvps is 3/);
  });

  it("documents the seed oracle and rejects a malformed expected-values file", () => {
    expect(expected).toEqual({
      exact: { totalRsvps: 1, popularCategories: [{ category: "Community", count: 1 }] },
      lowerBound: { pageViews: 0, detailViews: 0 },
    });
    expect(() => parseExpectedStats('{"exact":{}}')).toThrow(/exact\/lowerBound/);
  });
});

describe("post-deploy script helpers", () => {
  it("reads the named foundation outputs and rejects missing ones", async () => {
    const file = JSON.stringify({
      "team32-ceb-foundation": { SiteUrl: SITE, ArchiveFunctionName: "team32-ceb-archival" },
    });
    expect(
      await readFoundationOutputs(["SiteUrl", "ArchiveFunctionName"] as const, async () => file),
    ).toEqual({ SiteUrl: SITE, ArchiveFunctionName: "team32-ceb-archival" });
    await expect(
      readFoundationOutputs(["SiteUrl", "ArchiveBucketName"] as const, async () => file),
    ).rejects.toThrow(/ArchiveBucketName/);
    await expect(readFoundationOutputs(["SiteUrl"] as const, async () => "{}")).rejects.toThrow(
      /missing/,
    );
  });

  it("requires the HTTPS CloudFront URL", () => {
    expect(requireHttpsSiteUrl(SITE).protocol).toBe("https:");
    expect(() => requireHttpsSiteUrl("http://example.com")).toThrow(/HTTPS/);
  });
});
