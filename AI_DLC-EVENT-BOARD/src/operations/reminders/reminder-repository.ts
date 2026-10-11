import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { isConditionalCheckFailed } from "../../event-api/data/dynamo.js";
import { eventPrimaryKey } from "../../event-api/events/event-keys.js";
import { registrationStatusPartition } from "../../event-api/rsvp/registration-keys.js";
import {
  ACTIVE_LIFECYCLE_PARTITION,
  confirmedRegistrationIndexKeys,
  reminderAttemptIndexKeys,
  reminderAttemptKey,
  startBound,
} from "../shared/keys.js";
import { queryAll, type Item } from "../shared/query.js";
import type { TimeWindow } from "../shared/time.js";

export type ReminderOutcome = "queued" | "sent" | "skipped";

export interface ReminderEvent {
  eventId: string;
  title: string;
  startsAt: string;
  lifecycleStatus: string;
}

export interface ConfirmedRegistration {
  eventId: string;
  registrationId: string;
  /** Read only for SES delivery; never logged or queued. */
  normalizedEmail: string;
}

export interface ReminderAttempt {
  eventId: string;
  registrationId: string;
  scheduledFor: string;
  outcome: ReminderOutcome;
}

export interface NewReminderAttempt {
  eventId: string;
  registrationId: string;
  scheduledFor: string;
  createdAt: string;
}

/**
 * Reminder data access (C-03 v1). Event and Registration items are read only;
 * C5 writes nothing but ReminderAttempt items under REMINDER#{eventId}.
 * Every DynamoDB error other than an expected conditional failure propagates.
 */
export class ReminderRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** Active events starting in [window.from, window.to), through GSI7. */
  async findActiveEventsStartingIn(window: TimeWindow): Promise<ReminderEvent[]> {
    const items = await queryAll(this.client, this.tableName, {
      IndexName: "GSI7",
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
      ExpressionAttributeNames: { "#pk": "gsi7pk", "#sk": "gsi7sk" },
      ExpressionAttributeValues: {
        ":pk": ACTIVE_LIFECYCLE_PARTITION,
        // START#{to} sorts below START#{to}#EVENT#..., so an event starting
        // exactly at `to` is excluded and the window stays half-open.
        ":from": startBound(window.from),
        ":to": startBound(window.to),
      },
    });
    return items
      .map(toReminderEvent)
      .filter((event) => event.lifecycleStatus === "active" && event.startsAt < window.to);
  }

  /** Every confirmed registration of an event, through GSI5 (all pages). */
  async findConfirmedRegistrations(eventId: string): Promise<ConfirmedRegistration[]> {
    const items = await queryAll(this.client, this.tableName, {
      IndexName: "GSI5",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "gsi5pk" },
      ExpressionAttributeValues: { ":pk": registrationStatusPartition(eventId, "confirmed") },
    });
    return items.map(toConfirmedRegistration);
  }

  /** The registration if it is still confirmed, else undefined (GSI5 exact key). */
  async findConfirmedRegistration(
    eventId: string,
    registrationId: string,
  ): Promise<ConfirmedRegistration | undefined> {
    const keys = confirmedRegistrationIndexKeys(eventId, registrationId);
    const items = await queryAll(this.client, this.tableName, {
      IndexName: "GSI5",
      KeyConditionExpression: "#pk = :pk AND #sk = :sk",
      ExpressionAttributeNames: { "#pk": "gsi5pk", "#sk": "gsi5sk" },
      ExpressionAttributeValues: { ":pk": keys.gsi5pk, ":sk": keys.gsi5sk },
    });
    const match = items.map(toConfirmedRegistration).find((item) => item.eventId === eventId);
    return match;
  }

  /** Strongly consistent read of Event META. */
  async getEvent(eventId: string): Promise<ReminderEvent | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: eventPrimaryKey(eventId),
        ConsistentRead: true,
      }),
    );
    return result.Item ? toReminderEvent(result.Item) : undefined;
  }

  /**
   * Put-if-absent of the one ReminderAttempt for (eventId, registrationId).
   * Returns false when the attempt already exists (a duplicate).
   */
  async createAttempt(attempt: NewReminderAttempt): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...reminderAttemptKey(attempt.eventId, attempt.registrationId),
            ...reminderAttemptIndexKeys(
              attempt.eventId,
              attempt.registrationId,
              attempt.scheduledFor,
            ),
            entityType: "ReminderAttempt",
            reminderAttemptId: `${attempt.eventId}#${attempt.registrationId}`,
            eventId: attempt.eventId,
            registrationId: attempt.registrationId,
            scheduledFor: attempt.scheduledFor,
            outcome: "queued",
            createdAt: attempt.createdAt,
            schemaVersion: 1,
          },
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": "pk" },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  /** Rollback of a queued attempt whose message could not be sent. */
  async deleteQueuedAttempt(eventId: string, registrationId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: reminderAttemptKey(eventId, registrationId),
        ConditionExpression: "#outcome = :queued",
        ExpressionAttributeNames: { "#outcome": "outcome" },
        ExpressionAttributeValues: { ":queued": "queued" },
      }),
    );
  }

  async getAttempt(eventId: string, registrationId: string): Promise<ReminderAttempt | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: reminderAttemptKey(eventId, registrationId),
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (!item) {
      return undefined;
    }
    return {
      eventId: String(item.eventId),
      registrationId: String(item.registrationId),
      scheduledFor: String(item.scheduledFor),
      outcome: String(item.outcome) as ReminderOutcome,
    };
  }

  /** Records the final outcome on an existing attempt. */
  async recordOutcome(
    eventId: string,
    registrationId: string,
    outcome: "sent" | "skipped",
    at: string,
    reason: string,
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: reminderAttemptKey(eventId, registrationId),
        UpdateExpression: "SET #outcome = :outcome, #at = :at, #reason = :reason",
        ConditionExpression: "attribute_exists(#pk)",
        ExpressionAttributeNames: {
          "#pk": "pk",
          "#outcome": "outcome",
          "#at": outcome === "sent" ? "deliveredAt" : "skippedAt",
          "#reason": "outcomeReason",
        },
        ExpressionAttributeValues: { ":outcome": outcome, ":at": at, ":reason": reason },
      }),
    );
  }
}

function toReminderEvent(item: Item): ReminderEvent {
  return {
    eventId: String(item.eventId),
    title: String(item.title ?? ""),
    startsAt: String(item.startsAt),
    lifecycleStatus: String(item.lifecycleStatus),
  };
}

function toConfirmedRegistration(item: Item): ConfirmedRegistration {
  return {
    eventId: String(item.eventId),
    registrationId: String(item.registrationId),
    normalizedEmail: String(item.normalizedEmail ?? ""),
  };
}
