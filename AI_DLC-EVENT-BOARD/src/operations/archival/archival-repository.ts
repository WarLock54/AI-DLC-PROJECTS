import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  conditionFailureItem,
  isConditionalCheckFailed,
  readString,
} from "../../event-api/data/dynamo.js";
import { eventPrimaryKey, PUBLIC_INDEX_ATTRIBUTES } from "../../event-api/events/event-keys.js";
import {
  ACTIVE_LIFECYCLE_PARTITION,
  ARCHIVED_LIFECYCLE_PARTITION,
  archiveEligibilityUpperBound,
  archivedEventKey,
  eventPartition,
  REGISTRATION_PREFIX,
  START_PREFIX,
} from "../shared/keys.js";
import { queryAll, type Item } from "../shared/query.js";

export interface ArchivalCandidate {
  eventId: string;
  startsAt: string;
}

export type FreezeResult = "frozen" | "already-archived" | "not-eligible";

export interface ArchiveMarker {
  eventId: string;
  archivedAt: string;
  archiveReference: string;
  registrationCount: number;
}

type TransactionItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** DynamoDB's TransactWriteItems limit is 100; v1 deletes in batches of 25. */
export const REGISTRATION_DELETE_BATCH = 25;

/**
 * Archival data access for C-06/C-07 v1. Every DynamoDB error other than an
 * expected conditional failure propagates to the service.
 */
export class ArchivalRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** Active events with startsAt strictly before `cutoff` (GSI7, all pages). */
  async findEligibleEvents(cutoff: string): Promise<ArchivalCandidate[]> {
    const items = await queryAll(this.client, this.tableName, {
      IndexName: "GSI7",
      KeyConditionExpression: "#pk = :pk AND #sk < :upper",
      ExpressionAttributeNames: { "#pk": "gsi7pk", "#sk": "gsi7sk" },
      ExpressionAttributeValues: {
        ":pk": ACTIVE_LIFECYCLE_PARTITION,
        ":upper": archiveEligibilityUpperBound(cutoff),
      },
    });
    return items.map(toCandidate);
  }

  /** Events frozen as archived whose finalization has not completed yet. */
  async findResumableEvents(): Promise<ArchivalCandidate[]> {
    const items = await queryAll(this.client, this.tableName, {
      IndexName: "GSI7",
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "gsi7pk", "#sk": "gsi7sk" },
      ExpressionAttributeValues: { ":pk": ARCHIVED_LIFECYCLE_PARTITION, ":prefix": START_PREFIX },
    });
    return items.map(toCandidate);
  }

  /**
   * Conditional active -> archived transition. It removes the public index
   * keys and moves GSI7 to LIFECYCLE#archived; C3 mutations require `active`,
   * so the event is frozen from here on. The start time is re-checked against
   * the cutoff because the GSI7 read is eventually consistent.
   */
  async freeze(eventId: string, cutoff: string, archivedAt: string): Promise<FreezeResult> {
    const removed = PUBLIC_INDEX_ATTRIBUTES.map((name) => `#${name}`);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: eventPrimaryKey(eventId),
          UpdateExpression:
            "SET #lifecycleStatus = :archived, #gsi7pk = :gsi7pk, #archivedAt = :archivedAt " +
            `REMOVE ${removed.join(", ")}`,
          ConditionExpression:
            "attribute_exists(#pk) AND #lifecycleStatus = :active AND #startsAt < :cutoff",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#lifecycleStatus": "lifecycleStatus",
            "#gsi7pk": "gsi7pk",
            "#archivedAt": "archivedAt",
            "#startsAt": "startsAt",
            ...Object.fromEntries(PUBLIC_INDEX_ATTRIBUTES.map((name) => [`#${name}`, name])),
          },
          ExpressionAttributeValues: {
            ":archived": "archived",
            ":active": "active",
            ":gsi7pk": ARCHIVED_LIFECYCLE_PARTITION,
            ":archivedAt": archivedAt,
            ":cutoff": cutoff,
          },
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }),
      );
      return "frozen";
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const previous = conditionFailureItem(error);
      return readString(previous, "lifecycleStatus") === "archived"
        ? "already-archived"
        : "not-eligible";
    }
  }

  /** Strongly consistent read of Event META. */
  async getEvent(eventId: string): Promise<Item | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: eventPrimaryKey(eventId),
        ConsistentRead: true,
      }),
    );
    return result.Item as Item | undefined;
  }

  /** Every REG# item of the event: base table, strongly consistent, all pages. */
  async readRegistrations(eventId: string): Promise<Item[]> {
    return queryAll(this.client, this.tableName, {
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: {
        ":pk": eventPartition(eventId),
        ":prefix": REGISTRATION_PREFIX,
      },
      ConsistentRead: true,
    });
  }

  /** Deletes registrations in all-or-nothing batches of up to 25. */
  async deleteRegistrations(registrations: readonly Item[]): Promise<number> {
    let deleted = 0;
    for (let start = 0; start < registrations.length; start += REGISTRATION_DELETE_BATCH) {
      const batch = registrations.slice(start, start + REGISTRATION_DELETE_BATCH);
      const items: TransactionItem[] = batch.map((registration) => ({
        Delete: {
          TableName: this.tableName,
          Key: { pk: String(registration.pk), sk: String(registration.sk) },
        },
      }));
      await this.client.send(new TransactWriteCommand({ TransactItems: items }));
      deleted += batch.length;
    }
    return deleted;
  }

  /**
   * One transaction: put the ARCHIVE marker and delete Event META, only while
   * META is still `archived`. Throws when META changed underneath.
   */
  async finalize(marker: ArchiveMarker): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...archivedEventKey(marker.eventId),
                entityType: "ArchivedEvent",
                eventId: marker.eventId,
                archivedAt: marker.archivedAt,
                archiveReference: marker.archiveReference,
                registrationCount: marker.registrationCount,
                schemaVersion: 1,
              },
            },
          },
          {
            Delete: {
              TableName: this.tableName,
              Key: eventPrimaryKey(marker.eventId),
              ConditionExpression: "#lifecycleStatus = :archived",
              ExpressionAttributeNames: { "#lifecycleStatus": "lifecycleStatus" },
              ExpressionAttributeValues: { ":archived": "archived" },
            },
          },
        ],
      }),
    );
  }
}

function toCandidate(item: Item): ArchivalCandidate {
  return { eventId: String(item.eventId), startsAt: String(item.startsAt) };
}
