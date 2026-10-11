import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * Atomic in-memory stand-in for the DynamoDB document client, modelled on
 * test/c3-event-apis/support/fake-dynamodb.ts and extended for C5.
 *
 * It models only what C5 issues: Get, Put, Update, Delete, Query (base table
 * and GSI1-GSI7, with Limit/ExclusiveStartKey pagination and Select COUNT) and
 * TransactWrite (Put/Update/Delete/ConditionCheck). Expressions support only
 * =, <, <=, >, >=, BETWEEN, begins_with, attribute_exists,
 * attribute_not_exists, AND, OR, parentheses, and in updates SET (with + / -
 * and if_not_exists), REMOVE, ADD. Every attribute must be referenced through
 * ExpressionAttributeNames, and unused names or values are rejected, as
 * DynamoDB does. Anything else throws, so a test cannot pass against behavior
 * the fake does not model. Consistent reads on a GSI are rejected.
 *
 * Each call first yields to the event loop, then evaluates every condition and
 * applies every write synchronously, so concurrent callers interleave between
 * calls while each write or transaction stays atomic.
 */
export type Item = Record<string, unknown>;

export const INDEX_KEYS: Record<string, [string, string]> = {
  GSI1: ["gsi1pk", "gsi1sk"],
  GSI2: ["gsi2pk", "gsi2sk"],
  GSI3: ["gsi3pk", "gsi3sk"],
  GSI4: ["gsi4pk", "gsi4sk"],
  GSI5: ["gsi5pk", "gsi5sk"],
  GSI6: ["gsi6pk", "gsi6sk"],
  GSI7: ["gsi7pk", "gsi7sk"],
};

export interface RecordedCommand {
  name: string;
  input: Record<string, unknown>;
}

type FailureRule = {
  matches: (name: string, input: Record<string, unknown>) => boolean;
  error: Error;
};
type CommitListener = (fake: FakeDynamoDb) => void;

export class FakeDynamoDb {
  public readonly commands: RecordedCommand[] = [];
  /** Optional page size applied to every Query, to exercise pagination. */
  public queryPageSize: number | undefined;
  private readonly items = new Map<string, Item>();
  private readonly failures: FailureRule[] = [];
  private readonly listeners: CommitListener[] = [];

  constructor(private readonly tableName = "team32-ceb-events") {}

  asClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }

  seed(items: readonly Item[]): void {
    for (const item of items) {
      this.items.set(itemKey(item), clone(item));
    }
  }

  get(pk: string, sk: string): Item | undefined {
    const item = this.items.get(keyOf(pk, sk));
    return item ? clone(item) : undefined;
  }

  all(): Item[] {
    return [...this.items.values()].map(clone);
  }

  /** Fails the next matching command with the given error. */
  failNext(
    commandName: string,
    error: Error,
    when: (input: Record<string, unknown>) => boolean = () => true,
  ): void {
    this.failures.push({ matches: (name, input) => name === commandName && when(input), error });
  }

  /** Runs `listener` after every committed write (to inject concurrent changes). */
  onCommit(listener: CommitListener): void {
    this.listeners.push(listener);
  }

  commandsNamed(name: string): RecordedCommand[] {
    return this.commands.filter((command) => command.name === name);
  }

  async send(command: unknown): Promise<unknown> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const name = commandName(command);
    const input = (command as { input: Record<string, unknown> }).input;
    this.commands.push({ name, input: clone(input) });
    const failureIndex = this.failures.findIndex((rule) => rule.matches(name, input));
    if (failureIndex >= 0) {
      const [rule] = this.failures.splice(failureIndex, 1);
      throw rule.error;
    }
    switch (name) {
      case "GetCommand":
        return this.handleGet(input);
      case "PutCommand":
        return this.commit(this.handlePut(input, true));
      case "UpdateCommand":
        return this.commit(this.handleUpdate(input, true));
      case "DeleteCommand":
        return this.commit(this.handleDelete(input, true));
      case "QueryCommand":
        return this.handleQuery(input);
      case "TransactWriteCommand":
        return this.commit(this.handleTransaction(input));
      default:
        throw new Error(`FakeDynamoDb does not support ${name}.`);
    }
  }

  private commit<T>(result: T): T {
    for (const listener of this.listeners) {
      listener(this);
    }
    return result;
  }

  private requireTable(input: Record<string, unknown>): void {
    if (input.TableName !== this.tableName) {
      throw awsError("ResourceNotFoundException", `Unknown table ${String(input.TableName)}.`);
    }
  }

  private handleGet(input: Record<string, unknown>): { Item?: Item } {
    this.requireTable(input);
    const item = this.items.get(itemKey(input.Key as Item));
    return item ? { Item: clone(item) } : {};
  }

  private handlePut(input: Record<string, unknown>, apply: boolean): Item {
    this.requireTable(input);
    const item = input.Item as Item;
    if (typeof item.pk !== "string" || typeof item.sk !== "string") {
      throw awsError("ValidationException", "Item requires string pk and sk.");
    }
    for (const value of Object.values(item)) {
      if (value === undefined) {
        throw awsError("ValidationException", "Item contains an undefined value.");
      }
    }
    this.checkCondition(input, item);
    if (apply) {
      this.items.set(itemKey(item), clone(item));
    }
    return {};
  }

  private handleUpdate(input: Record<string, unknown>, apply: boolean): Item {
    this.requireTable(input);
    const key = input.Key as Item;
    const existing = this.items.get(itemKey(key));
    const context = new ExpressionContext(input);
    this.checkCondition(input, key, context);
    const next = applyUpdate(
      String(input.UpdateExpression ?? ""),
      clone(existing ?? { pk: key.pk, sk: key.sk }),
      context,
    );
    context.assertAllUsed();
    if (apply) {
      this.items.set(itemKey(key), next);
    }
    return input.ReturnValues === "ALL_NEW" ? { Attributes: clone(next) } : {};
  }

  private handleDelete(input: Record<string, unknown>, apply: boolean): Item {
    this.requireTable(input);
    const key = input.Key as Item;
    this.checkCondition(input, key);
    if (apply) {
      this.items.delete(itemKey(key));
    }
    return {};
  }

  private checkCondition(
    input: Record<string, unknown>,
    target: Item,
    context = new ExpressionContext(input),
  ): void {
    const existing = this.items.get(itemKey(target));
    const condition = input.ConditionExpression as string | undefined;
    const passed = condition === undefined || evaluateCondition(condition, existing ?? {}, context);
    if (input.UpdateExpression === undefined) {
      context.assertAllUsed();
    }
    if (!passed) {
      const error = awsError("ConditionalCheckFailedException", "The conditional request failed");
      if (input.ReturnValuesOnConditionCheckFailure === "ALL_OLD" && existing) {
        Object.assign(error, { Item: marshallItem(existing) });
      }
      throw error;
    }
  }

  private handleQuery(input: Record<string, unknown>): Item {
    this.requireTable(input);
    if (input.FilterExpression !== undefined) {
      throw new Error("FakeDynamoDb does not support FilterExpression.");
    }
    const indexName = input.IndexName as string | undefined;
    if (indexName && input.ConsistentRead === true) {
      throw awsError("ValidationException", "Consistent reads are not supported on GSIs.");
    }
    if (input.Select !== undefined && input.Select !== "COUNT") {
      unsupported(`Select ${String(input.Select)}`);
    }
    const [partitionAttribute, sortAttribute] = indexName
      ? (INDEX_KEYS[indexName] ?? unsupported(`index ${indexName}`))
      : ["pk", "sk"];
    const context = new ExpressionContext(input);
    const keyCondition = String(input.KeyConditionExpression ?? "");
    // Parse once up front so placeholder usage is validated even with no items.
    evaluateCondition(keyCondition, {}, context);
    const matches = [...this.items.values()]
      .filter(
        (item) =>
          typeof item[partitionAttribute] === "string" && typeof item[sortAttribute] === "string",
      )
      .filter((item) => evaluateCondition(keyCondition, item, context))
      .sort((left, right) =>
        compareKeys(
          left,
          right,
          partitionAttribute,
          sortAttribute,
          input.ScanIndexForward !== false,
        ),
      );
    context.assertAllUsed();
    const startKey = input.ExclusiveStartKey as Item | undefined;
    const startIndex = startKey
      ? matches.findIndex((item) => itemKey(item) === itemKey(startKey)) + 1
      : 0;
    const limits = [input.Limit as number | undefined, this.queryPageSize].filter(
      (value): value is number => typeof value === "number",
    );
    const limit = limits.length > 0 ? Math.min(...limits) : Number.POSITIVE_INFINITY;
    const page = matches.slice(startIndex, startIndex + limit);
    const result: Item =
      input.Select === "COUNT"
        ? { Count: page.length }
        : { Items: page.map(clone), Count: page.length };
    if (page.length === limit && page.length > 0) {
      const last = page[page.length - 1];
      result.LastEvaluatedKey = {
        pk: last.pk,
        sk: last.sk,
        ...(indexName ? { [partitionAttribute]: last[partitionAttribute] } : {}),
        ...(indexName ? { [sortAttribute]: last[sortAttribute] } : {}),
      };
    }
    return result;
  }

  private handleTransaction(input: Record<string, unknown>): Item {
    const transactItems = input.TransactItems as Item[];
    if (!Array.isArray(transactItems) || transactItems.length === 0) {
      throw awsError("ValidationException", "A transaction needs at least one item.");
    }
    if (transactItems.length > 100) {
      throw awsError("ValidationException", "A transaction may contain at most 100 items.");
    }
    const seen = new Set<string>();
    const reasons: Item[] = [];
    let failed = false;
    for (const entry of transactItems) {
      const [kind, operation] = transactionOperation(entry);
      const key = kind === "Put" ? (operation.Item as Item) : (operation.Key as Item);
      const identity = itemKey(key);
      if (seen.has(identity)) {
        throw awsError("ValidationException", "Transaction items must target distinct keys.");
      }
      seen.add(identity);
      try {
        if (kind === "Put") {
          this.handlePut(operation, false);
        } else if (kind === "Update") {
          this.handleUpdate(operation, false);
        } else if (kind === "Delete") {
          this.handleDelete(operation, false);
        } else {
          this.requireTable(operation);
          this.checkCondition(operation, key);
        }
        reasons.push({ Code: "None" });
      } catch (error) {
        if ((error as Error).name !== "ConditionalCheckFailedException") {
          throw error;
        }
        failed = true;
        reasons.push({ Code: "ConditionalCheckFailed", Message: "The conditional request failed" });
      }
    }
    if (failed) {
      throw Object.assign(
        awsError("TransactionCanceledException", "Transaction cancelled, conditional check failed"),
        { CancellationReasons: reasons },
      );
    }
    for (const entry of transactItems) {
      const [kind, operation] = transactionOperation(entry);
      if (kind === "Put") {
        this.handlePut(operation, true);
      } else if (kind === "Update") {
        this.handleUpdate(operation, true);
      } else if (kind === "Delete") {
        this.handleDelete(operation, true);
      }
    }
    return {};
  }
}

type TransactionKind = "Put" | "Update" | "Delete" | "ConditionCheck";

function transactionOperation(entry: Item): [TransactionKind, Item] {
  const kinds = Object.keys(entry);
  if (kinds.length !== 1 || !["Put", "Update", "Delete", "ConditionCheck"].includes(kinds[0])) {
    throw new Error(`FakeDynamoDb does not support transaction item ${kinds.join(",")}.`);
  }
  return [kinds[0] as TransactionKind, entry[kinds[0]] as Item];
}

function commandName(command: unknown): string {
  if (command instanceof GetCommand) return "GetCommand";
  if (command instanceof PutCommand) return "PutCommand";
  if (command instanceof UpdateCommand) return "UpdateCommand";
  if (command instanceof DeleteCommand) return "DeleteCommand";
  if (command instanceof QueryCommand) return "QueryCommand";
  if (command instanceof TransactWriteCommand) return "TransactWriteCommand";
  return (command as { constructor?: { name?: string } })?.constructor?.name ?? "unknown";
}

function compareKeys(
  left: Item,
  right: Item,
  partitionAttribute: string,
  sortAttribute: string,
  ascending: boolean,
): number {
  const order =
    compareValues(left[sortAttribute], right[sortAttribute]) ||
    compareValues(left[partitionAttribute], right[partitionAttribute]) ||
    compareValues(itemKey(left), itemKey(right));
  return ascending ? order : -order;
}

function compareValues(left: unknown, right: unknown): number {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function keyOf(pk: unknown, sk: unknown): string {
  return `${String(pk)}\u0000${String(sk)}`;
}

function itemKey(item: Item): string {
  return keyOf(item.pk, item.sk);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function unsupported(feature: string): never {
  throw new Error(`FakeDynamoDb does not support ${feature}.`);
}

export function awsError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function marshallItem(item: Item): Item {
  return Object.fromEntries(
    Object.entries(item).map(([name, value]) => [name, marshallValue(value)]),
  );
}

function marshallValue(value: unknown): unknown {
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (value === null) return { NULL: true };
  return unsupported(`marshalling ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Expression support (same grammar as the C3 fake)
// ---------------------------------------------------------------------------

class ExpressionContext {
  private readonly names: Record<string, string>;
  private readonly values: Record<string, unknown>;
  private readonly usedNames = new Set<string>();
  private readonly usedValues = new Set<string>();

  constructor(input: Record<string, unknown>) {
    this.names = (input.ExpressionAttributeNames as Record<string, string>) ?? {};
    this.values = (input.ExpressionAttributeValues as Record<string, unknown>) ?? {};
  }

  name(token: string): string {
    if (!(token in this.names)) {
      throw awsError("ValidationException", `Undefined attribute name ${token}.`);
    }
    this.usedNames.add(token);
    return this.names[token];
  }

  value(token: string): unknown {
    if (!(token in this.values)) {
      throw awsError("ValidationException", `Undefined attribute value ${token}.`);
    }
    this.usedValues.add(token);
    return this.values[token];
  }

  assertAllUsed(): void {
    const unusedNames = Object.keys(this.names).filter((name) => !this.usedNames.has(name));
    const unusedValues = Object.keys(this.values).filter((value) => !this.usedValues.has(value));
    if (unusedNames.length > 0 || unusedValues.length > 0) {
      throw awsError(
        "ValidationException",
        `Unused expression attributes: ${[...unusedNames, ...unusedValues].join(", ")}.`,
      );
    }
  }
}

type Token = { kind: "word" | "name" | "value" | "punct"; text: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(<=|>=|<>|[()=<>,+-]|#[A-Za-z0-9_]+|:[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*)/y;
  let index = 0;
  while (index < expression.length) {
    if (/^\s*$/.test(expression.slice(index))) {
      break;
    }
    pattern.lastIndex = index;
    const match = pattern.exec(expression);
    if (!match) {
      throw new Error(`FakeDynamoDb cannot parse expression near '${expression.slice(index)}'.`);
    }
    const text = match[1];
    if (text === "<>") {
      unsupported("the <> operator");
    }
    const kind = text.startsWith("#")
      ? "name"
      : text.startsWith(":")
        ? "value"
        : /^[A-Za-z_]/.test(text)
          ? "word"
          : "punct";
    tokens.push({ kind, text });
    index = pattern.lastIndex;
  }
  return tokens;
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: ExpressionContext,
  ) {}

  done(): boolean {
    return this.position >= this.tokens.length;
  }

  peek(): Token | undefined {
    return this.tokens[this.position];
  }

  next(): Token {
    const token = this.tokens[this.position++];
    if (!token) {
      throw new Error("FakeDynamoDb reached the end of an expression unexpectedly.");
    }
    return token;
  }

  expect(text: string): void {
    const token = this.next();
    if (token.text.toUpperCase() !== text) {
      throw new Error(`FakeDynamoDb expected '${text}' but found '${token.text}'.`);
    }
  }

  isWord(text: string): boolean {
    const token = this.peek();
    return token?.kind === "word" && token.text.toUpperCase() === text;
  }

  path(): string {
    const token = this.next();
    if (token.kind !== "name") {
      throw new Error(`FakeDynamoDb requires #name placeholders, found '${token.text}'.`);
    }
    return this.context.name(token.text);
  }

  operand(item: Item): unknown {
    const token = this.peek();
    if (token?.kind === "value") {
      this.next();
      return this.context.value(token.text);
    }
    return item[this.path()];
  }

  condition(item: Item): boolean {
    let result = this.conjunction(item);
    while (this.isWord("OR")) {
      this.next();
      const right = this.conjunction(item);
      result = result || right;
    }
    return result;
  }

  private conjunction(item: Item): boolean {
    let result = this.primary(item);
    while (this.isWord("AND")) {
      this.next();
      const right = this.primary(item);
      result = result && right;
    }
    return result;
  }

  private primary(item: Item): boolean {
    const token = this.peek();
    if (token?.text === "(") {
      this.next();
      const result = this.condition(item);
      this.expect(")");
      return result;
    }
    if (token?.kind === "word") {
      return this.functionCall(item);
    }
    const left = this.operand(item);
    if (this.isWord("BETWEEN")) {
      this.next();
      const low = this.operand(item);
      this.expect("AND");
      const high = this.operand(item);
      return compare(left, low, ">=") && compare(left, high, "<=");
    }
    const operator = this.next().text;
    if (!["=", "<", "<=", ">", ">="].includes(operator)) {
      unsupported(`operator ${operator}`);
    }
    return compare(left, this.operand(item), operator);
  }

  private functionCall(item: Item): boolean {
    const name = this.next().text;
    this.expect("(");
    let result: boolean;
    if (name === "attribute_exists" || name === "attribute_not_exists") {
      const exists = item[this.path()] !== undefined;
      result = name === "attribute_exists" ? exists : !exists;
    } else if (name === "begins_with") {
      const value = item[this.path()];
      this.expect(",");
      const prefix = this.operand(item);
      result = typeof value === "string" && typeof prefix === "string" && value.startsWith(prefix);
    } else {
      return unsupported(`function ${name}`);
    }
    this.expect(")");
    return result;
  }
}

function compare(left: unknown, right: unknown, operator: string): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  if (operator === "=") {
    return left === right;
  }
  const comparable =
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "string" && typeof right === "string");
  if (!comparable) {
    return false;
  }
  const a = left as number | string;
  const b = right as number | string;
  switch (operator) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    default:
      return a >= b;
  }
}

function evaluateCondition(expression: string, item: Item, context: ExpressionContext): boolean {
  const parser = new Parser(tokenize(expression), context);
  const result = parser.condition(item);
  if (!parser.done()) {
    throw new Error(`FakeDynamoDb could not parse the whole expression '${expression}'.`);
  }
  return result;
}

function applyUpdate(expression: string, item: Item, context: ExpressionContext): Item {
  const parser = new Parser(tokenize(expression), context);
  const original = clone(item);
  while (!parser.done()) {
    const clause = parser.next().text.toUpperCase();
    do {
      if (clause === "SET") {
        const target = parser.path();
        parser.expect("=");
        item[target] = setValue(parser, original);
      } else if (clause === "REMOVE") {
        delete item[parser.path()];
      } else if (clause === "ADD") {
        const target = parser.path();
        const amount = parser.operand(original);
        const current = original[target] ?? 0;
        if (typeof current !== "number" || typeof amount !== "number") {
          unsupported("non-numeric ADD");
        }
        item[target] = current + amount;
      } else {
        unsupported(`update clause ${clause}`);
      }
    } while (parser.peek()?.text === "," && parser.next());
  }
  return item;
}

function setValue(parser: Parser, original: Item): unknown {
  const left = setOperand(parser, original);
  const operator = parser.peek()?.text;
  if (operator !== "+" && operator !== "-") {
    return left;
  }
  parser.next();
  const right = setOperand(parser, original);
  if (typeof left !== "number" || typeof right !== "number") {
    throw awsError(
      "ValidationException",
      "An operand in the update expression has an incorrect data type or does not exist.",
    );
  }
  return operator === "+" ? left + right : left - right;
}

function setOperand(parser: Parser, original: Item): unknown {
  if (parser.isWord("IF_NOT_EXISTS")) {
    parser.next();
    parser.expect("(");
    const existing = original[parser.path()];
    parser.expect(",");
    const fallback = parser.operand(original);
    parser.expect(")");
    return existing === undefined ? fallback : existing;
  }
  return parser.operand(original);
}
