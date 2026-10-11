import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { readString, transactionCancellationReasons } from "../data/dynamo.js";
import { eventPrimaryKey } from "../events/event-keys.js";
import {
  cancelTokenKeys,
  cancelTokenPartition,
  registrationPrimaryKey,
  registrationStatusKeys,
  registrationStatusPartition,
  type RegistrationStatus,
} from "./registration-keys.js";

export interface RegistrationRecord {
  eventId: string;
  registrationId: string;
  normalizedEmail: string;
  displayName: string;
  status: RegistrationStatus;
  cancellationTokenDigest: string;
  waitlistedAt?: string;
  createdAt?: string;
}

/** Capacity view of Event META. RSVP reads it but never edits event content. */
export interface EventCapacity {
  eventId: string;
  lifecycleStatus: string;
  capacity: number;
  confirmedRsvpCount: number;
  waitlistCount: number;
}

export type AdmissionFailure = "event-unavailable" | "capacity" | "duplicate" | "conflict";
export type TransitionFailure = "event-unavailable" | "capacity" | "status-changed" | "conflict";

export type AdmissionResult = { ok: true } | { ok: false; reason: AdmissionFailure };
export type TransitionResult = { ok: true } | { ok: false; reason: TransitionFailure };

type TransactionItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

const ACTIVE = "active";

/** RSVP-owned registration access with atomic Event META capacity transitions. */
export class RsvpRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async getEventCapacity(eventId: string): Promise<EventCapacity | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: eventPrimaryKey(eventId),
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (!item) {
      return undefined;
    }
    return {
      eventId,
      lifecycleStatus: String(item.lifecycleStatus),
      capacity: Number(item.capacity),
      confirmedRsvpCount: Number(item.confirmedRsvpCount ?? 0),
      waitlistCount: Number(item.waitlistCount ?? 0),
    };
  }

  async getRegistration(
    eventId: string,
    normalizedEmail: string,
  ): Promise<RegistrationRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: registrationPrimaryKey(eventId, normalizedEmail),
        ConsistentRead: true,
      }),
    );
    return result.Item ? toRegistration(result.Item) : undefined;
  }

  /**
   * D3: confirm only while the event is active, a seat is free, and nobody is
   * waiting. The registration put replaces only an absent or cancelled item.
   */
  async admitConfirmed(registration: RegistrationRecord, now: string): Promise<AdmissionResult> {
    return this.admit(
      registration,
      now,
      "SET #confirmed = #confirmed + :one",
      "#lifecycleStatus = :active AND #confirmed < #capacity AND " +
        "(attribute_not_exists(#waitlistCount) OR #waitlistCount = :zero)",
      {
        "#confirmed": "confirmedRsvpCount",
        "#capacity": "capacity",
        "#waitlistCount": "waitlistCount",
      },
      { ":zero": 0 },
    );
  }

  /** Waitlist admission: counted on Event META in the same transaction. */
  async admitWaitlisted(registration: RegistrationRecord, now: string): Promise<AdmissionResult> {
    return this.admit(
      registration,
      now,
      "SET #waitlistCount = if_not_exists(#waitlistCount, :zero) + :one",
      "#lifecycleStatus = :active",
      { "#waitlistCount": "waitlistCount" },
      { ":zero": 0 },
    );
  }

  /** GSI5 ascending by waitlistedAt: the current waitlist head (eventually consistent). */
  async findWaitlistHead(eventId: string): Promise<RegistrationRecord | undefined> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI5",
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "gsi5pk" },
        ExpressionAttributeValues: { ":pk": registrationStatusPartition(eventId, "waitlisted") },
        ScanIndexForward: true,
        Limit: 1,
      }),
    );
    const head = result.Items?.[0];
    return head ? toRegistration(head) : undefined;
  }

  /** Cancellation-token lookup through GSI6 (eventually consistent, D2). */
  async findByTokenDigest(digest: string): Promise<RegistrationRecord | undefined> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI6",
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "gsi6pk" },
        ExpressionAttributeValues: { ":pk": cancelTokenPartition(digest) },
        Limit: 1,
      }),
    );
    const match = result.Items?.[0];
    return match ? toRegistration(match) : undefined;
  }

  /** Promotes one waiter while a seat is free; fails if the head changed. */
  async promoteHead(head: RegistrationRecord, now: string): Promise<TransitionResult> {
    return this.transition(
      head,
      "confirmed",
      now,
      {
        update: "SET #confirmed = #confirmed + :one, #waitlistCount = #waitlistCount - :one",
        condition:
          "#lifecycleStatus = :active AND #confirmed < #capacity AND #waitlistCount > :zero",
        names: {
          "#confirmed": "confirmedRsvpCount",
          "#capacity": "capacity",
          "#waitlistCount": "waitlistCount",
        },
      },
      "promotedAt",
    );
  }

  async cancelConfirmed(registration: RegistrationRecord, now: string): Promise<TransitionResult> {
    return this.transition(
      registration,
      "cancelled",
      now,
      {
        update: "SET #confirmed = #confirmed - :one",
        condition: "#lifecycleStatus = :active AND #confirmed > :zero",
        names: { "#confirmed": "confirmedRsvpCount" },
      },
      "cancelledAt",
    );
  }

  async cancelWaitlisted(registration: RegistrationRecord, now: string): Promise<TransitionResult> {
    return this.transition(
      registration,
      "cancelled",
      now,
      {
        update: "SET #waitlistCount = #waitlistCount - :one",
        condition: "#lifecycleStatus = :active AND #waitlistCount > :zero",
        names: { "#waitlistCount": "waitlistCount" },
      },
      "cancelledAt",
    );
  }

  private async admit(
    registration: RegistrationRecord,
    now: string,
    metaUpdate: string,
    metaCondition: string,
    metaNames: Record<string, string>,
    metaValues: Record<string, unknown>,
  ): Promise<AdmissionResult> {
    const items: TransactionItem[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: eventPrimaryKey(registration.eventId),
          UpdateExpression: metaUpdate,
          ConditionExpression: metaCondition,
          ExpressionAttributeNames: { "#lifecycleStatus": "lifecycleStatus", ...metaNames },
          ExpressionAttributeValues: { ":active": ACTIVE, ":one": 1, ...metaValues },
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: registrationItem(registration, now),
          ConditionExpression: "attribute_not_exists(#pk) OR #status = :cancelled",
          ExpressionAttributeNames: { "#pk": "pk", "#status": "status" },
          ExpressionAttributeValues: { ":cancelled": "cancelled" },
        },
      },
    ];
    const failure = await this.runTransaction(items);
    if (!failure) {
      return { ok: true };
    }
    if (failure === "conflict") {
      return { ok: false, reason: "conflict" };
    }
    const [metaReason, registrationReason] = failure;
    if (metaReason.failed && readString(metaReason.item, "lifecycleStatus") !== ACTIVE) {
      return { ok: false, reason: "event-unavailable" };
    }
    if (registrationReason.failed) {
      return { ok: false, reason: "duplicate" };
    }
    return { ok: false, reason: "capacity" };
  }

  private async transition(
    registration: RegistrationRecord,
    nextStatus: RegistrationStatus,
    now: string,
    meta: { update: string; condition: string; names: Record<string, string> },
    timestampAttribute: "promotedAt" | "cancelledAt",
  ): Promise<TransitionResult> {
    const nextKeys = registrationStatusKeys(
      registration.eventId,
      registration.registrationId,
      nextStatus,
      registration.waitlistedAt,
    );
    const items: TransactionItem[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: eventPrimaryKey(registration.eventId),
          UpdateExpression: meta.update,
          ConditionExpression: meta.condition,
          ExpressionAttributeNames: { "#lifecycleStatus": "lifecycleStatus", ...meta.names },
          ExpressionAttributeValues: { ":active": ACTIVE, ":one": 1, ":zero": 0 },
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
      },
      {
        Update: {
          TableName: this.tableName,
          Key: registrationPrimaryKey(registration.eventId, registration.normalizedEmail),
          UpdateExpression: "SET #status = :next, #gsi5pk = :gsi5pk, #gsi5sk = :gsi5sk, #at = :now",
          ConditionExpression: "#status = :expected AND #registrationId = :registrationId",
          ExpressionAttributeNames: {
            "#status": "status",
            "#gsi5pk": "gsi5pk",
            "#gsi5sk": "gsi5sk",
            "#at": timestampAttribute,
            "#registrationId": "registrationId",
          },
          ExpressionAttributeValues: {
            ":next": nextStatus,
            ":gsi5pk": nextKeys.gsi5pk,
            ":gsi5sk": nextKeys.gsi5sk,
            ":now": now,
            ":expected": registration.status,
            ":registrationId": registration.registrationId,
          },
        },
      },
    ];
    const failure = await this.runTransaction(items);
    if (!failure) {
      return { ok: true };
    }
    if (failure === "conflict") {
      return { ok: false, reason: "conflict" };
    }
    const [metaReason, registrationReason] = failure;
    if (registrationReason.failed) {
      return { ok: false, reason: "status-changed" };
    }
    if (readString(metaReason.item, "lifecycleStatus") !== ACTIVE) {
      return { ok: false, reason: "event-unavailable" };
    }
    return { ok: false, reason: "capacity" };
  }

  /**
   * Runs a transaction. Returns undefined on success, "conflict" for a
   * TransactionConflict (retryable), or the per-item condition outcome. Any
   * other error propagates unchanged.
   */
  private async runTransaction(
    items: TransactionItem[],
  ): Promise<undefined | "conflict" | { failed: boolean; item?: Record<string, unknown> }[]> {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: items }));
      return undefined;
    } catch (error) {
      const reasons = transactionCancellationReasons(error);
      if (!reasons) {
        throw error;
      }
      if (reasons.some((reason) => reason.code === "ConditionalCheckFailed")) {
        return reasons.map((reason) => ({
          failed: reason.code === "ConditionalCheckFailed",
          item: reason.item,
        }));
      }
      if (reasons.some((reason) => reason.code === "TransactionConflict")) {
        return "conflict";
      }
      throw error;
    }
  }
}

function registrationItem(registration: RegistrationRecord, now: string): Record<string, unknown> {
  const item: Record<string, unknown> = {
    ...registrationPrimaryKey(registration.eventId, registration.normalizedEmail),
    ...registrationStatusKeys(
      registration.eventId,
      registration.registrationId,
      registration.status,
      registration.waitlistedAt,
    ),
    ...cancelTokenKeys(
      registration.cancellationTokenDigest,
      registration.eventId,
      registration.registrationId,
    ),
    entityType: "Registration",
    registrationId: registration.registrationId,
    eventId: registration.eventId,
    displayName: registration.displayName,
    normalizedEmail: registration.normalizedEmail,
    status: registration.status,
    cancellationTokenDigest: registration.cancellationTokenDigest,
    createdAt: now,
    schemaVersion: 1,
  };
  if (registration.waitlistedAt) {
    item.waitlistedAt = registration.waitlistedAt;
  }
  return item;
}

function toRegistration(item: Record<string, unknown>): RegistrationRecord {
  const record: RegistrationRecord = {
    eventId: String(item.eventId),
    registrationId: String(item.registrationId),
    normalizedEmail: String(item.normalizedEmail),
    displayName: String(item.displayName),
    status: String(item.status) as RegistrationStatus,
    cancellationTokenDigest: String(item.cancellationTokenDigest),
  };
  if (typeof item.waitlistedAt === "string") {
    record.waitlistedAt = item.waitlistedAt;
  }
  if (typeof item.createdAt === "string") {
    record.createdAt = item.createdAt;
  }
  return record;
}
