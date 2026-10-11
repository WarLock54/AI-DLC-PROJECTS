import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  conditionFailureItem,
  isConditionalCheckFailed,
  readNumber,
  readString,
} from "../data/dynamo.js";
import { ApiError, notFound } from "../http/errors.js";
import {
  activeEventKeys,
  eventPrimaryKey,
  lifecyclePartition,
  organizerPartition,
  softDeleteKeyTransition,
  type LifecycleStatus,
} from "./event-keys.js";
import type { EventInput } from "./validation.js";

export interface EventRecord {
  eventId: string;
  title: string;
  description: string;
  startsAt: string;
  location: string;
  category: string;
  capacity: number;
  confirmedRsvpCount: number;
  waitlistCount: number;
  organizerSubject: string;
  lifecycleStatus: string;
  bannerReference?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PublicIndex = "GSI1" | "GSI2" | "GSI3";

export interface PublicQuery {
  index: PublicIndex;
  partitionKey: string;
  /** Inclusive lower bound on the START# sort key. */
  fromSortKey: string;
  /** Inclusive upper bound on the START# sort key. */
  toSortKey: string;
}

const PUBLIC_INDEX_ATTRIBUTES: Record<PublicIndex, [string, string]> = {
  GSI1: ["gsi1pk", "gsi1sk"],
  GSI2: ["gsi2pk", "gsi2sk"],
  GSI3: ["gsi3pk", "gsi3sk"],
};

const EVENT_NOT_FOUND = "Event not found.";

/** EventManagement-owned access to Event META items (C-03 v1). */
export class EventRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(record: EventRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...activeEventKeys(record), ...record, schemaVersion: 1 },
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk" },
      }),
    );
  }

  async get(eventId: string): Promise<EventRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: eventPrimaryKey(eventId),
        ConsistentRead: true,
      }),
    );
    return result.Item ? toEventRecord(result.Item) : undefined;
  }

  /**
   * Rewrites the editable fields and every START#-derived index key in one
   * conditional UpdateItem. Fails with NOT_FOUND when the event is missing or
   * not active, and CAPACITY_CONFLICT when capacity drops below confirmed RSVPs.
   */
  async update(
    eventId: string,
    organizerSubject: string,
    input: EventInput,
    now: string,
  ): Promise<EventRecord> {
    const keys = activeEventKeys({ ...input, eventId, organizerSubject });
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: eventPrimaryKey(eventId),
          UpdateExpression:
            "SET #title = :title, #description = :description, #startsAt = :startsAt, " +
            "#location = :location, #category = :category, #capacity = :capacity, " +
            "#updatedAt = :now, #gsi1sk = :sortKey, #gsi2pk = :gsi2pk, #gsi2sk = :sortKey, " +
            "#gsi3pk = :gsi3pk, #gsi3sk = :sortKey, #gsi4sk = :sortKey, #gsi7sk = :sortKey",
          ConditionExpression:
            "attribute_exists(#pk) AND #lifecycleStatus = :active AND #confirmedRsvpCount <= :capacity",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#title": "title",
            "#description": "description",
            "#startsAt": "startsAt",
            "#location": "location",
            "#category": "category",
            "#capacity": "capacity",
            "#updatedAt": "updatedAt",
            "#gsi1sk": "gsi1sk",
            "#gsi2pk": "gsi2pk",
            "#gsi2sk": "gsi2sk",
            "#gsi3pk": "gsi3pk",
            "#gsi3sk": "gsi3sk",
            "#gsi4sk": "gsi4sk",
            "#gsi7sk": "gsi7sk",
            "#lifecycleStatus": "lifecycleStatus",
            "#confirmedRsvpCount": "confirmedRsvpCount",
          },
          ExpressionAttributeValues: {
            ":title": input.title,
            ":description": input.description,
            ":startsAt": input.startsAt,
            ":location": input.location,
            ":category": input.category,
            ":capacity": input.capacity,
            ":now": now,
            ":sortKey": keys.gsi1sk,
            ":gsi2pk": keys.gsi2pk,
            ":gsi3pk": keys.gsi3pk,
            ":active": "active",
          },
          ReturnValues: "ALL_NEW",
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }),
      );
      return toEventRecord(result.Attributes ?? {});
    } catch (error) {
      throw mapUpdateConditionFailure(error);
    }
  }

  /** Q4 soft delete: keeps the item and registrations, leaves the public indexes. */
  async softDelete(eventId: string, now: string): Promise<void> {
    const transition = softDeleteKeyTransition();
    const removeNames = Object.fromEntries(transition.remove.map((name) => [`#${name}`, name]));
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: eventPrimaryKey(eventId),
          UpdateExpression:
            "SET #lifecycleStatus = :deleted, #gsi7pk = :gsi7pk, " +
            "#updatedAt = :now, #deletedAt = :now REMOVE " +
            transition.remove.map((name) => `#${name}`).join(", "),
          ConditionExpression: "attribute_exists(#pk) AND #lifecycleStatus = :active",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#lifecycleStatus": "lifecycleStatus",
            "#gsi7pk": "gsi7pk",
            "#updatedAt": "updatedAt",
            "#deletedAt": "deletedAt",
            ...removeNames,
          },
          ExpressionAttributeValues: {
            ":deleted": "deleted",
            ":active": "active",
            ":gsi7pk": transition.set.gsi7pk,
            ":now": now,
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw notFound(EVENT_NOT_FOUND, "id");
      }
      throw error;
    }
  }

  async setBannerReference(eventId: string, bannerReference: string, now: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: eventPrimaryKey(eventId),
          UpdateExpression: "SET #bannerReference = :bannerReference, #updatedAt = :now",
          ConditionExpression: "attribute_exists(#pk) AND #lifecycleStatus = :active",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#bannerReference": "bannerReference",
            "#updatedAt": "updatedAt",
            "#lifecycleStatus": "lifecycleStatus",
          },
          ExpressionAttributeValues: {
            ":bannerReference": bannerReference,
            ":now": now,
            ":active": "active",
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw notFound(EVENT_NOT_FOUND, "id");
      }
      throw error;
    }
  }

  /** Organizer management list (GSI4): the organizer's active events. */
  async listByOrganizer(organizerSubject: string): Promise<EventRecord[]> {
    const items = await this.queryAll({
      IndexName: "GSI4",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "gsi4pk" },
      ExpressionAttributeValues: { ":pk": organizerPartition(organizerSubject) },
    });
    return items.map(toEventRecord).filter((event) => event.lifecycleStatus === "active");
  }

  /** Admin management list (GSI7) for one lifecycle status. */
  async listByLifecycle(
    status: LifecycleStatus,
    organizerSubject?: string,
  ): Promise<EventRecord[]> {
    const items = await this.queryAll({
      IndexName: "GSI7",
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "gsi7pk", "#sk": "gsi7sk" },
      ExpressionAttributeValues: { ":pk": lifecyclePartition(status), ":prefix": "START#" },
    });
    return items
      .map(toEventRecord)
      .filter(
        (event) => organizerSubject === undefined || event.organizerSubject === organizerSubject,
      );
  }

  /** Public discovery query over GSI1-GSI3, following every page. */
  async queryPublic(query: PublicQuery): Promise<EventRecord[]> {
    const [partitionAttribute, sortAttribute] = PUBLIC_INDEX_ATTRIBUTES[query.index];
    const items = await this.queryAll({
      IndexName: query.index,
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
      ExpressionAttributeNames: { "#pk": partitionAttribute, "#sk": sortAttribute },
      ExpressionAttributeValues: {
        ":pk": query.partitionKey,
        ":from": query.fromSortKey,
        ":to": query.toSortKey,
      },
    });
    return items.map(toEventRecord);
  }

  private async queryAll(
    input: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName">,
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          ...input,
          TableName: this.tableName,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...(page.Items ?? []));
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }
}

function mapUpdateConditionFailure(error: unknown): unknown {
  if (!isConditionalCheckFailed(error)) {
    return error;
  }
  const previous = conditionFailureItem(error);
  if (!previous || readString(previous, "lifecycleStatus") !== "active") {
    return notFound(EVENT_NOT_FOUND, "id");
  }
  const confirmed = readNumber(previous, "confirmedRsvpCount") ?? 0;
  return new ApiError(
    "CAPACITY_CONFLICT",
    `capacity cannot be lower than the ${confirmed} confirmed RSVPs.`,
    "capacity",
  );
}

export function toEventRecord(item: Record<string, unknown>): EventRecord {
  const record: EventRecord = {
    eventId: String(item.eventId),
    title: String(item.title),
    description: String(item.description),
    startsAt: String(item.startsAt),
    location: String(item.location),
    category: String(item.category),
    capacity: Number(item.capacity),
    confirmedRsvpCount: Number(item.confirmedRsvpCount ?? 0),
    waitlistCount: Number(item.waitlistCount ?? 0),
    organizerSubject: String(item.organizerSubject),
    lifecycleStatus: String(item.lifecycleStatus),
  };
  if (typeof item.bannerReference === "string") {
    record.bannerReference = item.bannerReference;
  }
  if (typeof item.createdAt === "string") {
    record.createdAt = item.createdAt;
  }
  if (typeof item.updatedAt === "string") {
    record.updatedAt = item.updatedAt;
  }
  return record;
}
