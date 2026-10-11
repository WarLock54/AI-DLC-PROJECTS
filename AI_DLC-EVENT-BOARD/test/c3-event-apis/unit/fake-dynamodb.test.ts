import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { FakeDynamoDb } from "../support/fake-dynamodb.js";
import { TABLE_NAME } from "../support/fixtures.js";

// Self-tests: the fake must refuse anything it does not model, so repository
// tests cannot pass against unmodelled DynamoDB behavior.
describe("FakeDynamoDb self-test", () => {
  it("throws on unsupported operators, bare attribute names, and unknown commands", async () => {
    const fake = new FakeDynamoDb(TABLE_NAME);
    fake.seed([{ pk: "A", sk: "B", value: 1 }]);
    await expect(
      fake.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: "A", sk: "B" },
          UpdateExpression: "SET #value = :one",
          ConditionExpression: "#value <> :one",
          ExpressionAttributeNames: { "#value": "value" },
          ExpressionAttributeValues: { ":one": 1 },
        }),
      ),
    ).rejects.toThrow(/does not support the <> operator/);
    await expect(
      fake.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { pk: "C", sk: "D" },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      ),
    ).rejects.toThrow(/requires #name placeholders/);
    await expect(fake.send({ input: {} })).rejects.toThrow(/does not support/);
  });

  it("rejects unused placeholders, GSI consistent reads, and arithmetic on missing values", async () => {
    const fake = new FakeDynamoDb(TABLE_NAME);
    await expect(
      fake.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { pk: "C", sk: "D" },
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": "pk", "#unused": "x" },
        }),
      ),
    ).rejects.toMatchObject({ name: "ValidationException" });
    await expect(
      fake.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: "N", sk: "M" },
          UpdateExpression: "SET #count = #count + :one",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: { ":one": 1 },
        }),
      ),
    ).rejects.toMatchObject({ name: "ValidationException" });
    await expect(
      fake.send(new GetCommand({ TableName: "other-table", Key: { pk: "A", sk: "B" } })),
    ).rejects.toMatchObject({ name: "ResourceNotFoundException" });
  });
});
