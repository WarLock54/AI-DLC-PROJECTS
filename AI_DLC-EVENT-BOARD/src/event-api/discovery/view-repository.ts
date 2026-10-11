import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { eventViewItem, type EventViewInput } from "./view-keys.js";

/** Writes C-03 EventView items for statistics (C5). */
export class ViewRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** Create-only put: a view identifier is never reused or overwritten. */
  async putView(view: EventViewInput): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: eventViewItem(view),
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk" },
      }),
    );
  }
}
