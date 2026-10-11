import type { SQSEvent, SQSRecord } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../../../src/event-api/http/request.js";
import {
  buildAdminStatsDependencies,
  createAdminStatsRouter,
  handler as adminStatsHandler,
} from "../../../src/lambda/admin-stats/handler.js";
import {
  buildArchivalService,
  createArchivalHandler,
  handler as archivalHandler,
  InvalidArchivalRequestError,
  parseArchivalRequest,
} from "../../../src/lambda/archival/handler.js";
import { buildReminderSelector } from "../../../src/lambda/reminder-selector/handler.js";
import {
  buildReminderWorkerDependencies,
  createEmailSender,
  createReminderWorkerHandler,
  handler as reminderWorkerHandler,
} from "../../../src/lambda/reminder-worker/handler.js";
import { LogEmailSender, SesEmailSender } from "../../../src/operations/reminders/email-sender.js";
import type { ReminderQueueMessageV1 } from "../../../src/operations/reminders/message.js";
import { FakeDynamoDb } from "../support/fake-dynamodb.js";
import { FakeArchiveStore, recordingLogger } from "../support/fakes.js";
import { seedDataset, seedView } from "../support/fixtures.js";

const TABLE = "team32-ceb-events";

function statsRequest(
  claims?: Record<string, unknown>,
  routeKey = "GET /api/admin/stats",
): HttpRequest {
  return {
    routeKey,
    requestContext: {
      requestId: "req-1",
      ...(claims ? { authorizer: { jwt: { claims } } } : {}),
    },
  };
}

function sqsRecord(messageId: string, body: string): SQSRecord {
  return { messageId, body } as SQSRecord;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin-stats handler (C-02 GET /api/admin/stats)", () => {
  let fake: FakeDynamoDb;

  beforeEach(() => {
    fake = new FakeDynamoDb(TABLE);
    fake.seed([
      ...seedDataset(new Date("2026-10-05T12:00:00.000Z")),
      seedView("v1", "list", "2026-10-05T12:01:00.000Z"),
    ]);
  });

  it("returns 200 AdminStats for an admin", async () => {
    const route = createAdminStatsRouter(
      buildAdminStatsDependencies({ TABLE_NAME: TABLE }, fake.asClient()),
    );
    const response = await route(statsRequest({ sub: "a", "cognito:groups": ["admin"] }));
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(response.body)).toEqual({
      totalRsvps: 1,
      pageViews: 1,
      detailViews: 0,
      popularCategories: [{ category: "Community", count: 1 }],
    });
  });

  it.each([
    ["no JWT claims", undefined, 401, "AUTHENTICATION_REQUIRED"],
    ["an organizer", { sub: "o", "cognito:groups": ["organizer"] }, 403, "FORBIDDEN"],
  ])("returns the deterministic error body for %s", async (_, claims, status, code) => {
    const route = createAdminStatsRouter(
      buildAdminStatsDependencies({ TABLE_NAME: TABLE }, fake.asClient()),
    );
    const response = await route(statsRequest(claims));
    expect(response.statusCode).toBe(status);
    expect(JSON.parse(response.body)).toEqual({ code, message: expect.any(String), field: null });
  });

  it("returns 500 INTERNAL_ERROR without detail when the data read fails", async () => {
    fake.failNext("QueryCommand", new Error("secret internal detail"));
    const { logger, lines } = recordingLogger();
    const route = createAdminStatsRouter({
      statistics: buildAdminStatsDependencies({ TABLE_NAME: TABLE }, fake.asClient()).statistics,
      logger,
    });
    const response = await route(statsRequest({ sub: "a", "cognito:groups": ["admin"] }));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret internal detail");
    expect(lines[0]).toMatchObject({ event: "UNHANDLED_ERROR", routeKey: "GET /api/admin/stats" });
  });

  it("returns 404 for an unknown route and fails fast without TABLE_NAME", async () => {
    const route = createAdminStatsRouter(
      buildAdminStatsDependencies({ TABLE_NAME: TABLE }, fake.asClient()),
    );
    expect((await route(statsRequest(undefined, "GET /api/other"))).statusCode).toBe(404);
    expect(() => buildAdminStatsDependencies({}, fake.asClient())).toThrow(/TABLE_NAME/);
  });

  it("wires the Lambda entry point from the environment", async () => {
    vi.stubEnv("TABLE_NAME", TABLE);
    const response = await adminStatsHandler(statsRequest());
    expect(response.statusCode).toBe(401);
  });
});

describe("archival handler (C-06)", () => {
  it.each([
    [{ mode: "postDeploy" }, "postDeploy"],
    [{ mode: "scheduled" }, "scheduled"],
  ])("accepts %j", (event, mode) => {
    expect(parseArchivalRequest(event)).toEqual({ mode });
  });

  it.each([
    ["null", null],
    ["an array", [{ mode: "postDeploy" }]],
    ["an unknown mode", { mode: "manual" }],
    ["an extra field", { mode: "postDeploy", force: true }],
    ["an empty object", {}],
  ])("rejects %s", (_, event) => {
    expect(() => parseArchivalRequest(event)).toThrow(InvalidArchivalRequestError);
  });

  it("returns exactly the C-06 response shape", async () => {
    const fake = new FakeDynamoDb(TABLE);
    fake.seed(seedDataset(new Date("2026-10-05T12:00:00.000Z")));
    const store = new FakeArchiveStore();
    const archive = createArchivalHandler(
      buildArchivalService({ TABLE_NAME: TABLE }, fake.asClient(), store),
    );
    const result = await archive({ mode: "postDeploy" });
    expect(Object.keys(result).sort()).toEqual([
      "archived",
      "failures",
      "scanned",
      "skippedAlreadyArchived",
    ]);
    expect(result).toEqual({ scanned: 1, archived: 1, skippedAlreadyArchived: 0, failures: 0 });
    expect([...store.objects.keys()]).toEqual(["archive/seed-event-archive-candidate.json"]);
  });

  it("does not run the service for an invalid request and fails fast on missing settings", async () => {
    const run = vi.fn();
    await expect(createArchivalHandler({ run })({ mode: "x" })).rejects.toThrow(/mode/);
    expect(run).not.toHaveBeenCalled();
    expect(() => buildArchivalService({ TABLE_NAME: TABLE })).toThrow(/ARCHIVE_BUCKET_NAME/);
    expect(() =>
      buildArchivalService({ ARCHIVE_BUCKET_NAME: "b" }, new FakeDynamoDb().asClient()),
    ).toThrow(/TABLE_NAME/);
  });

  it("wires the Lambda entry point and rejects an invalid request before any AWS call", async () => {
    vi.stubEnv("TABLE_NAME", TABLE);
    vi.stubEnv("ARCHIVE_BUCKET_NAME", "team32-ceb-archive-test");
    await expect(archivalHandler({ mode: "everything" })).rejects.toBeInstanceOf(
      InvalidArchivalRequestError,
    );
  });
});

describe("reminder-worker handler (SQS partial batch)", () => {
  const valid: ReminderQueueMessageV1 = {
    eventId: "e1",
    registrationId: "r1",
    scheduledFor: "2026-10-05T12:00:00.000Z",
  };

  it("reports only failed records, including invalid C-05 messages", async () => {
    const processed: ReminderQueueMessageV1[] = [];
    const { logger, lines } = recordingLogger();
    const handle = createReminderWorkerHandler({
      worker: {
        process: async (message) => {
          processed.push(message);
          if (message.registrationId === "boom") {
            throw new Error("delivery failed");
          }
          return { outcome: "sent" };
        },
      },
      logger,
    });
    const event: SQSEvent = {
      Records: [
        sqsRecord("m1", JSON.stringify(valid)),
        sqsRecord("m2", JSON.stringify({ ...valid, email: "x@example.com" })),
        sqsRecord("m3", JSON.stringify({ ...valid, registrationId: "boom" })),
        sqsRecord("m4", "not json"),
      ],
    };
    expect(await handle(event)).toEqual({
      batchItemFailures: [
        { itemIdentifier: "m2" },
        { itemIdentifier: "m3" },
        { itemIdentifier: "m4" },
      ],
    });
    expect(processed.map((message) => message.registrationId)).toEqual(["r1", "boom"]);
    expect(lines.map((line) => line.errorName)).toEqual([
      "InvalidReminderMessageError",
      "Error",
      "InvalidReminderMessageError",
    ]);
    expect(JSON.stringify(lines)).not.toContain("x@example.com");
  });

  it("selects the email sender from EMAIL_MODE", () => {
    expect(createEmailSender({})).toBeInstanceOf(LogEmailSender);
    expect(createEmailSender({ EMAIL_MODE: "log" })).toBeInstanceOf(LogEmailSender);
    const ses = createEmailSender(
      { EMAIL_MODE: "ses", REMINDER_SENDER_EMAIL: "sender@example.com" },
      () => ({ send: vi.fn() }) as never,
    );
    expect(ses).toBeInstanceOf(SesEmailSender);
    expect(() => createEmailSender({ EMAIL_MODE: "ses" }, () => ({}) as never)).toThrow(
      /REMINDER_SENDER_EMAIL/,
    );
    expect(() => createEmailSender({ EMAIL_MODE: "smtp" })).toThrow(/EMAIL_MODE/);
  });

  it("fails fast without TABLE_NAME and wires the entry point", async () => {
    expect(() => buildReminderWorkerDependencies({}, new FakeDynamoDb().asClient())).toThrow(
      /TABLE_NAME/,
    );
    vi.stubEnv("TABLE_NAME", TABLE);
    vi.stubEnv("EMAIL_MODE", "log");
    expect(await reminderWorkerHandler({ Records: [sqsRecord("m1", "{}")] })).toEqual({
      batchItemFailures: [{ itemIdentifier: "m1" }],
    });
  });
});

describe("reminder-selector handler wiring", () => {
  it("builds a selector that queues through the injected queue", async () => {
    const fake = new FakeDynamoDb(TABLE);
    // Seeded "now": the community event starts 24 hours later, inside the window.
    fake.seed(seedDataset(new Date()));
    const sent: ReminderQueueMessageV1[] = [];
    const selector = buildReminderSelector({ TABLE_NAME: TABLE }, fake.asClient(), {
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(await selector.run()).toMatchObject({ eventsScanned: 1, attemptsCreated: 1 });
    expect(Object.keys(sent[0]).sort()).toEqual(["eventId", "registrationId", "scheduledFor"]);
  });

  it("fails fast when a required setting is missing", () => {
    expect(() => buildReminderSelector({ TABLE_NAME: TABLE })).toThrow(/REMINDER_QUEUE_URL/);
    expect(() =>
      buildReminderSelector({}, new FakeDynamoDb().asClient(), { send: async () => undefined }),
    ).toThrow(/TABLE_NAME/);
  });
});
