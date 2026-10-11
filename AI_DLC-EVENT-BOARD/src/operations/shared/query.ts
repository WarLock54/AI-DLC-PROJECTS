import type { DynamoDBDocumentClient, QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export type Item = Record<string, unknown>;
export type QueryInput = Omit<QueryCommandInput, "TableName" | "ExclusiveStartKey" | "Select">;

/** Follows LastEvaluatedKey until DynamoDB returns no continuation key. */
export async function queryAll(
  client: DynamoDBDocumentClient,
  tableName: string,
  input: QueryInput,
): Promise<Item[]> {
  const items: Item[] = [];
  let exclusiveStartKey: Item | undefined;
  do {
    const page = await client.send(
      new QueryCommand({ ...input, TableName: tableName, ExclusiveStartKey: exclusiveStartKey }),
    );
    items.push(...((page.Items ?? []) as Item[]));
    exclusiveStartKey = page.LastEvaluatedKey as Item | undefined;
  } while (exclusiveStartKey);
  return items;
}

/** Sums `Select: COUNT` pages; no item data is read into the Lambda. */
export async function countAll(
  client: DynamoDBDocumentClient,
  tableName: string,
  input: QueryInput,
): Promise<number> {
  let total = 0;
  let exclusiveStartKey: Item | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        ...input,
        TableName: tableName,
        Select: "COUNT",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    if (typeof page.Count !== "number") {
      throw new Error("DynamoDB returned a COUNT page without a Count.");
    }
    total += page.Count;
    exclusiveStartKey = page.LastEvaluatedKey as Item | undefined;
  } while (exclusiveStartKey);
  return total;
}
