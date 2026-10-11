import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { createSeedFixtures } from "../../../src/seed/fixtures.js";
import { loadSeedFixtures } from "../../../src/seed/loader.js";

function seedBoundary() {
  const items = createSeedFixtures({
    organizerSubject: "11111111-1111-4111-8111-111111111111",
    clock: () => new Date("2030-01-15T12:00:00.000Z"),
  });
  const records = new Map<string, Record<string, unknown>>();
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
  const persist = async (command: unknown) => {
    if (command instanceof PutCommand) {
      expect(command.input.TableName).toBe("team32-ceb-events");
      expect(command.input.ConditionExpression).toBe("attribute_not_exists(#pk)");
      expect(command.input.ExpressionAttributeNames).toEqual({ "#pk": "pk" });
      const item = command.input.Item;
      if (!item) throw new Error("Missing item.");
      const key = `${item.pk}/${item.sk}`;
      if (records.has(key)) {
        throw Object.assign(new Error("Record exists."), {
          name: "ConditionalCheckFailedException",
        });
      }
      // No await between condition evaluation and persistence: emulate atomic PutItem.
      records.set(key, structuredClone(item));
      return {};
    }
    if (command instanceof GetCommand) {
      expect(command.input.ConsistentRead).toBe(true);
      return { Item: records.get(`${command.input.Key?.pk}/${command.input.Key?.sk}`) };
    }
    throw new Error("Unexpected persistence command.");
  };
  const send = vi.spyOn(client, "send").mockImplementation((command) => persist(command));
  const run = (seedItems = items) =>
    loadSeedFixtures({
      tableName: "team32-ceb-events",
      items: seedItems,
      client,
      delay: async () => undefined,
    });
  return { items, records, send, run, persist };
}

describe("seed initialization persistence boundary (in-memory AWS stubs)", () => {
  it("initializes fixtures on the first run and preserves them unchanged on repeat runs", async () => {
    const { items, records, run } = seedBoundary();
    expect(await run()).toBe(3);
    expect([...records.values()]).toEqual(items);
    expect(await run()).toBe(3);
    expect([...records.values()]).toEqual(items);
    expect(records.size).toBe(3);
  });

  it("preserves edited content, counts, indexes, lifecycle and registration status across concurrent runs", async () => {
    const { items, records, run } = seedBoundary();
    await run();
    const event = {
      ...items[0],
      title: "Edited community market",
      description: "Organizer-owned content",
      startsAt: "2030-03-01T12:00:00.000Z",
      capacity: 70,
      confirmedRsvpCount: 42,
      lifecycleStatus: "archived",
      gsi1pk: "USER-OWNED-INDEX",
      gsi7pk: "LIFECYCLE#archived",
    };
    const registration = { ...items[2], status: "cancelled", gsi5pk: "USER-OWNED-STATUS-INDEX" };
    records.set(`${event.pk}/${event.sk}`, event);
    records.set(`${registration.pk}/${registration.sk}`, registration);
    const before = structuredClone([...records.entries()]);
    expect(await Promise.all([run(), run(), run()])).toEqual([3, 3, 3]);
    expect([...records.entries()]).toEqual(before);
  });

  it("atomically initializes each absent composite key once across simultaneous first runs", async () => {
    const { items, records, run } = seedBoundary();
    expect(await Promise.all([run(), run(), run()])).toEqual([3, 3, 3]);
    expect([...records.values()]).toEqual(items);
    expect(records.size).toBe(3);
  });

  it("recovers from partial failure without rolling back or overwriting completed records", async () => {
    const { items, records, send, run, persist } = seedBoundary();
    send
      .mockImplementationOnce((command) => persist(command))
      .mockRejectedValueOnce(
        Object.assign(new Error("Write denied."), { name: "AccessDeniedException" }),
      );
    await expect(run()).rejects.toThrow(/Write denied/);
    expect([...records.values()]).toEqual([items[0]]);
    const edited = { ...items[0], title: "Edited between attempts", confirmedRsvpCount: 15 };
    records.set(`${edited.pk}/${edited.sk}`, edited);
    expect(await run()).toBe(3);
    expect([...records.values()]).toEqual([edited, items[1], items[2]]);
  });

  it("recovers a committed but timed-out write through a conditional retry and validated read", async () => {
    const { items, records, send, run, persist } = seedBoundary();
    send.mockImplementationOnce(async (command) => {
      await persist(command);
      const edited = { ...items[0], title: "Edited after commit", confirmedRsvpCount: 7 };
      records.set(`${edited.pk}/${edited.sk}`, edited);
      throw Object.assign(new Error("Response lost."), { name: "TimeoutError" });
    });
    expect(await run()).toBe(3);
    expect(records.get(`${items[0].pk}/${items[0].sk}`)).toEqual({
      ...items[0],
      title: "Edited after commit",
      confirmedRsvpCount: 7,
    });
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      PutCommand,
      PutCommand,
      GetCommand,
      PutCommand,
      PutCommand,
    ]);
  });

  it("preserves completed records after partial retry exhaustion and safely resumes on rerun", async () => {
    const { items, records, send, run, persist } = seedBoundary();
    send.mockImplementation((command) => {
      if (command instanceof PutCommand && command.input.Item?.pk === items[1].pk) {
        return Promise.reject(
          Object.assign(new Error("Temporarily throttled."), { name: "ThrottlingException" }),
        );
      }
      return persist(command);
    });
    await expect(run()).rejects.toThrow(/retry budget/);
    expect(send).toHaveBeenCalledTimes(7);
    expect([...records.values()]).toEqual([items[0]]);
    expect(
      send.mock.calls.filter(
        ([command]) => command instanceof PutCommand && command.input.Item?.pk === items[0].pk,
      ),
    ).toHaveLength(1);
    send.mockImplementation((command) => persist(command));
    expect(await run()).toBe(3);
    expect([...records.values()]).toEqual(items);
  });

  it("fails on legacy missing identity while preserving the record and adding no repair path", async () => {
    const { items, records, run } = seedBoundary();
    const legacy = { pk: items[0].pk, sk: items[0].sk, title: "Legacy user content" };
    records.set(`${legacy.pk}/${legacy.sk}`, legacy);
    await expect(run()).rejects.toThrow(/no repair allowed/);
    expect([...records.values()]).toEqual([legacy]);
  });
});
