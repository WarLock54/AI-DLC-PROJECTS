import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ViewType } from "../../event-api/discovery/view-keys.js";
import { ACTIVE_LIFECYCLE_PARTITION, START_PREFIX, viewPartition } from "../shared/keys.js";
import { countAll, queryAll } from "../shared/query.js";

export interface EventCounters {
  eventId: string;
  category: string;
  confirmedRsvpCount: number;
  waitlistCount: number;
}

/** Statistics reads (Q4 A). Read-only; every DynamoDB error propagates. */
export class StatisticsRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** RSVP counters of every active Event META item (GSI7, all pages). */
  async listActiveEventCounters(): Promise<EventCounters[]> {
    const items = await queryAll(this.client, this.tableName, {
      IndexName: "GSI7",
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "gsi7pk", "#sk": "gsi7sk" },
      ExpressionAttributeValues: { ":pk": ACTIVE_LIFECYCLE_PARTITION, ":prefix": START_PREFIX },
    });
    return items
      .filter((item) => item.lifecycleStatus === "active")
      .map((item) => ({
        eventId: String(item.eventId),
        category: String(item.category),
        confirmedRsvpCount: nonNegativeCount(item.confirmedRsvpCount),
        // Seed items have no waitlistCount; absent means zero.
        waitlistCount: nonNegativeCount(item.waitlistCount),
      }));
  }

  /** Number of EventView items of one type (Select COUNT, all pages). */
  async countViews(viewType: ViewType): Promise<number> {
    return countAll(this.client, this.tableName, {
      IndexName: "GSI7",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "gsi7pk" },
      ExpressionAttributeValues: { ":pk": viewPartition(viewType) },
    });
  }
}

function nonNegativeCount(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Event META carries an invalid RSVP counter.");
  }
  return count;
}
