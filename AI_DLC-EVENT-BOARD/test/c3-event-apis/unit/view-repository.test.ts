import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { ViewRepository } from "../../../src/event-api/discovery/view-repository.js";
import { awsError, FakeDynamoDb } from "../support/fake-dynamodb.js";
import { TABLE_NAME } from "../support/fixtures.js";

function setup() {
  const fake = new FakeDynamoDb(TABLE_NAME);
  return { fake, repository: new ViewRepository(fake.asClient(), TABLE_NAME) };
}

describe("ViewRepository", () => {
  it("writes list and detail EventView items readable through GSI7", async () => {
    const { fake, repository } = setup();
    await repository.putView({
      viewId: "v-1",
      viewType: "list",
      eventId: "LIST",
      viewedAt: "2030-01-15T12:00:00.000Z",
    });
    await repository.putView({
      viewId: "v-2",
      viewType: "detail",
      eventId: "e-1",
      viewedAt: "2030-01-15T12:00:01.000Z",
    });
    expect(fake.get("VIEW#v-1", "META")).toMatchObject({ gsi7pk: "VIEW#list", eventId: "LIST" });
    const detail = (await fake.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI7",
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "gsi7pk" },
        ExpressionAttributeValues: { ":pk": "VIEW#detail" },
      }),
    )) as { Items: { eventId: string }[] };
    expect(detail.Items.map((item) => item.eventId)).toEqual(["e-1"]);
  });

  it("never overwrites an existing view identifier", async () => {
    const { fake, repository } = setup();
    const view = {
      viewId: "v-1",
      viewType: "list" as const,
      eventId: "LIST",
      viewedAt: "2030-01-15T12:00:00.000Z",
    };
    await repository.putView(view);
    await expect(
      repository.putView({ ...view, viewedAt: "2030-01-15T12:00:05.000Z" }),
    ).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
    expect(fake.get("VIEW#v-1", "META")?.viewedAt).toBe("2030-01-15T12:00:00.000Z");
  });

  it("propagates write failures to the caller", async () => {
    const { fake, repository } = setup();
    fake.failNext("PutCommand", awsError("ProvisionedThroughputExceededException", "throttled"));
    await expect(
      repository.putView({
        viewId: "v-3",
        viewType: "detail",
        eventId: "e-1",
        viewedAt: "2030-01-15T12:00:00.000Z",
      }),
    ).rejects.toThrow("throttled");
  });
});
