import { GetCommand, PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { validateSeedFixtures, type SeedItem } from "./fixtures.js";

const MAX_RETRIES = 5;
const RETRYABLE_ERRORS = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "InternalServerError",
  "ServiceUnavailable",
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
  "NetworkingError",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

export interface SeedLoadOptions {
  tableName: string;
  items: readonly SeedItem[];
  client: DynamoDBDocumentClient;
  delay?: (milliseconds: number) => Promise<void>;
}

export async function loadSeedFixtures({
  tableName,
  items,
  client,
  delay = wait,
}: SeedLoadOptions): Promise<number> {
  if (!tableName.trim()) {
    throw new Error("DynamoDB table name is required.");
  }
  if (items.length === 0) {
    throw new Error("At least one seed fixture is required.");
  }

  validateSeedFixtures(items);
  for (const item of items) {
    await initializeItem(tableName, item, client, delay);
  }
  return items.length;
}

async function initializeItem(
  tableName: string,
  item: SeedItem,
  client: DynamoDBDocumentClient,
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  try {
    await withRetry(
      () =>
        client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": "pk" },
          }),
        ),
      delay,
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") {
      throw error;
    }
    const { Item: existing } = await withRetry(
      () =>
        client.send(
          new GetCommand({
            TableName: tableName,
            Key: { pk: item.pk, sk: item.sk },
            ConsistentRead: true,
          }),
        ),
      delay,
    );
    // Validate identity only: mutable application fields need not match seed defaults.
    const identityAttributes = ["pk", "sk", "eventId", "entityType", "registrationId"] as const;
    if (
      !existing ||
      identityAttributes.some(
        (attribute) => attribute in item && existing[attribute] !== item[attribute],
      )
    ) {
      throw new Error(
        "Existing seed record is missing or has conflicting identity; no repair allowed.",
      );
    }
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  delay: (milliseconds: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error)) {
        throw error;
      }
      if (attempt >= MAX_RETRIES) {
        throw new Error("DynamoDB seed operation exhausted its bounded retry budget.", {
          cause: error,
        });
      }
      await delay(25 * 2 ** attempt);
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "ConditionalCheckFailedException") {
    return false;
  }
  if (RETRYABLE_ERRORS.has(error.name)) {
    return true;
  }
  if ("code" in error && typeof error.code === "string" && RETRYABLE_ERRORS.has(error.code)) {
    return true;
  }
  if ("$metadata" in error && typeof error.$metadata === "object" && error.$metadata !== null) {
    const metadata = error.$metadata;
    return (
      "httpStatusCode" in metadata &&
      typeof metadata.httpStatusCode === "number" &&
      (metadata.httpStatusCode === 429 || metadata.httpStatusCode >= 500)
    );
  }
  return false;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
