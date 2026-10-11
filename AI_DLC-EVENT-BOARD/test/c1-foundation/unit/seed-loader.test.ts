import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { createSeedFixtures } from "../../../src/seed/fixtures.js";
import { loadSeedFixtures } from "../../../src/seed/loader.js";

function fixtures() {
  return createSeedFixtures({
    organizerSubject: "11111111-1111-4111-8111-111111111111",
    clock: () => new Date("2030-01-15T12:00:00.000Z"),
  });
}

function clientWithSend(send: (command: unknown) => Promise<unknown>): DynamoDBDocumentClient {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
  vi.spyOn(client, "send").mockImplementation((command) => send(command));
  return client;
}

function serviceError(name: string): Error {
  return Object.assign(new Error("Synthetic service failure."), { name });
}

describe("conditional DynamoDB seed writes", () => {
  it("initializes every validated fixture with an atomic create-if-absent condition", async () => {
    const send = vi.fn().mockResolvedValue({});
    const items = fixtures();
    const count = await loadSeedFixtures({
      tableName: "team32-ceb-events",
      items,
      client: clientWithSend(send),
    });
    expect(count).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
    for (const [index, [command]] of send.mock.calls.entries()) {
      expect(command).toBeInstanceOf(PutCommand);
      expect(command.input).toEqual({
        TableName: "team32-ceb-events",
        Item: items[index],
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk" },
      });
    }
  });

  it("handles more than 25 records without falling back to unconditional batch writes", async () => {
    const send = vi.fn().mockResolvedValue({});
    const items = Array.from({ length: 26 }, (_, index) => ({
      pk: `TEST#${index}`,
      sk: "META",
    }));
    expect(
      await loadSeedFixtures({ tableName: "events", items, client: clientWithSend(send) }),
    ).toBe(26);
    expect(send).toHaveBeenCalledTimes(26);
    expect(send.mock.calls.every(([command]) => command instanceof PutCommand)).toBe(true);
  });

  it("validates existing identity with a strongly consistent read without comparing mutable defaults", async () => {
    const item = fixtures()[0];
    const existing = {
      ...item,
      title: "Resident-edited event",
      capacity: 100,
      confirmedRsvpCount: 65,
      lifecycleStatus: "archived",
      gsi7pk: "LIFECYCLE#archived",
      organizerSubject: "22222222-2222-4222-8222-222222222222",
    };
    const send = vi
      .fn()
      .mockRejectedValueOnce(serviceError("ConditionalCheckFailedException"))
      .mockResolvedValueOnce({ Item: existing });
    expect(
      await loadSeedFixtures({ tableName: "events", items: [item], client: clientWithSend(send) }),
    ).toBe(1);
    const read = send.mock.calls[1][0];
    expect(read).toBeInstanceOf(GetCommand);
    expect(read.input).toEqual({
      TableName: "events",
      Key: { pk: item.pk, sk: item.sk },
      ConsistentRead: true,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(existing.confirmedRsvpCount).toBe(65);
  });

  it.each(["pk", "sk", "eventId", "entityType"])(
    "rejects conflicting existing %s without repairing or overwriting it",
    async (attribute) => {
      const item = fixtures()[0];
      const send = vi
        .fn()
        .mockRejectedValueOnce(serviceError("ConditionalCheckFailedException"))
        .mockResolvedValueOnce({ Item: { ...item, [attribute]: "conflicting" } });
      await expect(
        loadSeedFixtures({ tableName: "events", items: [item], client: clientWithSend(send) }),
      ).rejects.toThrow(/conflicting identity; no repair allowed/);
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects a conflicting registration identity even when its event key matches", async () => {
    const item = fixtures()[2];
    const send = vi
      .fn()
      .mockRejectedValueOnce(serviceError("ConditionalCheckFailedException"))
      .mockResolvedValueOnce({ Item: { ...item, registrationId: "another-registration" } });
    await expect(
      loadSeedFixtures({ tableName: "events", items: [item], client: clientWithSend(send) }),
    ).rejects.toThrow(/conflicting identity/);
  });

  it.each([undefined, { pk: fixtures()[0].pk, sk: "META" }])(
    "fails explicitly when the existing record is absent or lacks identity",
    async (existing) => {
      const send = vi
        .fn()
        .mockRejectedValueOnce(serviceError("ConditionalCheckFailedException"))
        .mockResolvedValueOnce({ Item: existing });
      await expect(
        loadSeedFixtures({
          tableName: "events",
          items: [fixtures()[0]],
          client: clientWithSend(send),
        }),
      ).rejects.toThrow(/missing or has conflicting identity/);
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    serviceError("ProvisionedThroughputExceededException"),
    serviceError("ThrottlingException"),
    serviceError("RequestLimitExceeded"),
    serviceError("InternalServerError"),
    serviceError("TimeoutError"),
    Object.assign(new Error("Synthetic transport failure."), { code: "ECONNRESET" }),
    Object.assign(new Error("Synthetic service failure."), { $metadata: { httpStatusCode: 503 } }),
    Object.assign(new Error("Synthetic service failure."), { $metadata: { httpStatusCode: 429 } }),
  ])(
    "retries only the current failed write for transient or ambiguous errors (%s)",
    async (error) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(error)
        .mockResolvedValue({});
      const delay = vi.fn().mockResolvedValue(undefined);
      await loadSeedFixtures({
        tableName: "events",
        items: fixtures(),
        client: clientWithSend(send),
        delay,
      });
      expect(send).toHaveBeenCalledTimes(4);
      expect(send.mock.calls[1][0].input).toEqual(send.mock.calls[2][0].input);
      expect(send.mock.calls[0][0].input.Item).toEqual(fixtures()[0]);
      expect(delay).toHaveBeenCalledExactlyOnceWith(25);
    },
  );

  it.each([
    new Error("DynamoDB unavailable"),
    serviceError("AccessDeniedException"),
    serviceError("ValidationException"),
    Object.assign(new Error("Bad request."), { $metadata: { httpStatusCode: 400 } }),
    Object.assign(new Error("Malformed metadata."), { $metadata: null }),
    "non-Error failure",
  ])("surfaces permanent or unknown write failures immediately (%s)", async (error) => {
    const send = vi.fn().mockRejectedValue(error);
    const delay = vi.fn();
    await expect(
      loadSeedFixtures({
        tableName: "events",
        items: fixtures(),
        client: clientWithSend(send),
        delay,
      }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("bounds retries and exponential backoff, retaining the service error as cause", async () => {
    const error = serviceError("ThrottlingException");
    const send = vi.fn().mockRejectedValue(error);
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(
      loadSeedFixtures({
        tableName: "events",
        items: fixtures(),
        client: clientWithSend(send),
        delay,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/retry budget/), cause: error });
    expect(send).toHaveBeenCalledTimes(6);
    expect(delay.mock.calls).toEqual([[25], [50], [100], [200], [400]]);
  });

  it("retries a throttled preservation read without retrying a known conflicting write", async () => {
    const item = fixtures()[0];
    const send = vi
      .fn()
      .mockRejectedValueOnce(serviceError("ConditionalCheckFailedException"))
      .mockRejectedValueOnce(serviceError("ThrottlingException"))
      .mockResolvedValueOnce({ Item: item });
    const delay = vi.fn().mockResolvedValue(undefined);
    expect(
      await loadSeedFixtures({
        tableName: "events",
        items: [item],
        client: clientWithSend(send),
        delay,
      }),
    ).toBe(1);
    expect(send.mock.calls.slice(1).every(([command]) => command instanceof GetCommand)).toBe(true);
    expect(delay).toHaveBeenCalledExactlyOnceWith(25);
  });

  it("surfaces permanent read failures rather than treating existence as success", async () => {
    const error = serviceError("AccessDeniedException");
    const send = vi
      .fn()
      .mockRejectedValueOnce(serviceError("ConditionalCheckFailedException"))
      .mockRejectedValueOnce(error);
    await expect(
      loadSeedFixtures({ tableName: "events", items: fixtures(), client: clientWithSend(send) }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("bounds read retries after a condition failure", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(serviceError("ConditionalCheckFailedException"))
      .mockRejectedValue(serviceError("InternalServerError"));
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(
      loadSeedFixtures({
        tableName: "events",
        items: fixtures(),
        client: clientWithSend(send),
        delay,
      }),
    ).rejects.toThrow(/retry budget/);
    expect(send).toHaveBeenCalledTimes(7);
    expect(delay).toHaveBeenCalledTimes(5);
  });

  it("surfaces backoff failures without continuing persistence", async () => {
    const send = vi.fn().mockRejectedValue(serviceError("ThrottlingException"));
    const error = new Error("Backoff failed.");
    await expect(
      loadSeedFixtures({
        tableName: "events",
        items: fixtures(),
        client: clientWithSend(send),
        delay: vi.fn().mockRejectedValue(error),
      }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects missing table names and empty fixture sets before any write", async () => {
    const send = vi.fn();
    const client = clientWithSend(send);
    await expect(loadSeedFixtures({ tableName: " ", items: fixtures(), client })).rejects.toThrow(
      /table name is required/,
    );
    await expect(loadSeedFixtures({ tableName: "events", items: [], client })).rejects.toThrow(
      /At least one seed fixture/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("validates all fixtures up front, including duplicate keys, before any persistence", async () => {
    const send = vi.fn();
    const items = fixtures();
    await expect(
      loadSeedFixtures({
        tableName: "events",
        items: [...items, items[0]],
        client: clientWithSend(send),
      }),
    ).rejects.toThrow(/Duplicate deterministic seed key/);
    expect(send).not.toHaveBeenCalled();
  });
});
