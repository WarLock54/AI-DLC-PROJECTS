import { describe, expect, it } from "vitest";
import { createJsonLogger } from "../../../src/event-api/http/logger.js";
import { awsError } from "../support/fake-dynamodb.js";
import { fakeWithSeed, SEED_EVENT_ID } from "../support/fixtures.js";
import { buildServices, captureApiError } from "../support/services.js";

function views(fake: ReturnType<typeof fakeWithSeed>) {
  return fake.all().filter((item) => item.entityType === "EventView");
}

describe("EventView recording (Q3, Q3a, D11)", () => {
  it("records a list view with eventId LIST after a successful list", async () => {
    const fake = fakeWithSeed();
    const { discovery } = buildServices(fake);
    await discovery.listEvents({ category: "Community" });
    expect(views(fake)).toEqual([
      expect.objectContaining({
        pk: "VIEW#view-0001",
        viewType: "list",
        eventId: "LIST",
        gsi7pk: "VIEW#list",
        gsi4pk: "VIEW#list",
      }),
    ]);
  });

  it("records a detail view for a served event and none for a 404", async () => {
    const fake = fakeWithSeed();
    const { discovery } = buildServices(fake);
    await discovery.getEvent(SEED_EVENT_ID);
    await captureApiError(discovery.getEvent("unknown-event"));
    const recorded = views(fake);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      viewType: "detail",
      eventId: SEED_EVENT_ID,
      gsi7sk: expect.stringMatching(
        new RegExp(`^AT#2030-01-15T12:00:00\\.\\d{3}Z#EVENT#${SEED_EVENT_ID}$`),
      ),
    });
  });

  it("still returns the page and logs exactly one EVENT_VIEW_RECORD_FAILED line on write failure", async () => {
    const fake = fakeWithSeed();
    const { discovery, logger } = buildServices(fake);
    fake.failNext("PutCommand", awsError("ProvisionedThroughputExceededException", "throttled"));
    const detail = await discovery.getEvent(SEED_EVENT_ID);
    expect(detail.eventId).toBe(SEED_EVENT_ID);
    expect(logger.entries).toEqual([
      {
        level: "error",
        event: "EVENT_VIEW_RECORD_FAILED",
        viewType: "detail",
        eventId: SEED_EVENT_ID,
        errorName: "ProvisionedThroughputExceededException",
      },
    ]);
    fake.failNext("PutCommand", new TypeError("socket closed"));
    await expect(discovery.listEvents({})).resolves.toHaveProperty("events");
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[1]).toMatchObject({
      viewType: "list",
      eventId: "LIST",
      errorName: "TypeError",
    });
    expect(JSON.stringify(logger.entries)).not.toMatch(/@|throttled|socket closed/);
  });

  it("writes one structured JSON line per log entry", () => {
    const lines: string[] = [];
    const logger = createJsonLogger((line) => lines.push(line));
    logger.error({ event: "EVENT_VIEW_RECORD_FAILED", viewType: "list", eventId: "LIST" });
    logger.warn({ event: "WAITLIST_PROMOTION_DEFERRED", eventId: "e-1" });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { level: "error", event: "EVENT_VIEW_RECORD_FAILED", viewType: "list", eventId: "LIST" },
      { level: "warn", event: "WAITLIST_PROMOTION_DEFERRED", eventId: "e-1" },
    ]);
  });
});
