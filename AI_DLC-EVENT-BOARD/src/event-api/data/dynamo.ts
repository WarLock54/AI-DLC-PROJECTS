// Helpers for reading DynamoDB condition-failure details. The document client
// does not unmarshall items attached to errors, so values may arrive either in
// the raw AttributeValue form ({S: "..."}) or as plain values.
export type AttributeMap = Record<string, unknown>;

export interface CancellationReason {
  code: string;
  item?: AttributeMap;
}

interface NamedError {
  name?: unknown;
}

export function isConditionalCheckFailed(error: unknown): boolean {
  return (error as NamedError | null)?.name === "ConditionalCheckFailedException";
}

/** The ALL_OLD item attached to a ConditionalCheckFailedException, if any. */
export function conditionFailureItem(error: unknown): AttributeMap | undefined {
  const item = (error as { Item?: unknown } | null)?.Item;
  return isAttributeMap(item) ? item : undefined;
}

/** Cancellation reasons of a TransactionCanceledException, else undefined. */
export function transactionCancellationReasons(error: unknown): CancellationReason[] | undefined {
  if ((error as NamedError | null)?.name !== "TransactionCanceledException") {
    return undefined;
  }
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  if (!Array.isArray(reasons)) {
    return undefined;
  }
  return reasons.map((reason: unknown) => {
    const { Code, Item } = (reason ?? {}) as { Code?: unknown; Item?: unknown };
    return {
      code: typeof Code === "string" ? Code : "None",
      item: isAttributeMap(Item) ? Item : undefined,
    };
  });
}

export function readString(item: AttributeMap | undefined, name: string): string | undefined {
  const value = item?.[name];
  if (typeof value === "string") {
    return value;
  }
  const raw = (value as { S?: unknown } | undefined)?.S;
  return typeof raw === "string" ? raw : undefined;
}

export function readNumber(item: AttributeMap | undefined, name: string): number | undefined {
  const value = item?.[name];
  if (typeof value === "number") {
    return value;
  }
  const raw = (value as { N?: unknown } | undefined)?.N;
  return typeof raw === "string" && raw.trim() !== "" ? Number(raw) : undefined;
}

function isAttributeMap(value: unknown): value is AttributeMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
