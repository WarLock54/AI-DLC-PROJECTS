/**
 * Debug-sandbox teardown for the Community Event Board (NFR18, NFR30).
 *
 * Order: delete every `team32-ceb-` CloudFormation stack and wait for each,
 * then delete the resources that survive stack deletion because of
 * `RemovalPolicy.RETAIN` (found by the `project=team32-ceb` tag), then prove
 * the inventory is empty. Every AWS failure propagates with the resource type
 * and name; nothing is skipped silently. Log and error text is redacted so no
 * ARN or 12-digit account ID reaches the job log.
 */
export const STACK_PREFIX = "team32-ceb-";
export const PROJECT_TAG_KEY = "project";
export const PROJECT_TAG_VALUE = "team32-ceb";

export type DeletionOutcome = "deleted" | "absent";

export interface ObjectVersion {
  key: string;
  versionId: string;
}

export interface VersionPageMarker {
  keyMarker: string;
  versionIdMarker?: string;
}

export interface ObjectVersionPage {
  /** Object versions and delete markers on this page. */
  versions: ObjectVersion[];
  next?: VersionPageMarker;
}

/** Narrow AWS operations the teardown needs; `aws-ports.ts` implements them with SDK v3. */
export interface TeardownPorts {
  /** Names of stacks that are not already DELETE_COMPLETE. */
  listStackNames(): Promise<string[]>;
  deleteStack(name: string): Promise<void>;
  /** Resolves once the stack is gone; rejects if deletion fails. */
  waitForStackDeleted(name: string): Promise<void>;
  /** ARNs of resources tagged project=team32-ceb, all pages. */
  listTaggedResourceArns(): Promise<string[]>;
  listObjectVersions(
    bucket: string,
    marker?: VersionPageMarker,
  ): Promise<ObjectVersionPage | "absent">;
  /** Deletes one page of versions; rejects if any key could not be deleted. */
  deleteObjectVersions(bucket: string, versions: ObjectVersion[]): Promise<void>;
  deleteBucket(bucket: string): Promise<DeletionOutcome>;
  deleteLogGroup(name: string): Promise<DeletionOutcome>;
  deleteUserPool(userPoolId: string): Promise<DeletionOutcome>;
  /** Deletes the table and waits until it no longer exists. */
  deleteTable(name: string): Promise<DeletionOutcome>;
  /** Force-deletes the secret with no recovery window. */
  deleteSecret(secretArn: string): Promise<DeletionOutcome>;
}

export interface TeardownLogger {
  info(message: string): void;
}

export interface TeardownDependencies {
  ports: TeardownPorts;
  environment: Readonly<Record<string, string | undefined>>;
  sleep: (milliseconds: number) => Promise<void>;
  logger: TeardownLogger;
  /** Inventory polls for tag-index eventual consistency; default 10 x 30 s. */
  inventoryAttempts?: number;
  inventoryDelayMs?: number;
}

export interface TeardownReport {
  stacksDeleted: string[];
  resourcesDeleted: string[];
  resourcesAlreadyAbsent: string[];
}

export type ResourceKind =
  | "s3-bucket"
  | "log-group"
  | "user-pool"
  | "dynamodb-table"
  | "secret"
  | "cloudformation-stack"
  | "other";

export interface TaggedResource {
  arn: string;
  kind: ResourceKind;
  /** Human-readable type, for example "S3 bucket". */
  label: string;
  /** Resource name or ID as used for deletion (never the ARN, except for secrets). */
  name: string;
}

export class TeardownError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(redactSensitive(message), options);
    this.name = "TeardownError";
  }
}

const ARN_PATTERN = /arn:aws[a-z-]*:[^\s"'`,;)]+/g;
const ACCOUNT_ID_PATTERN = /(?<!\d)\d{12}(?!\d)/g;

/** Removes ARNs and 12-digit account IDs from text bound for logs or errors. */
export function redactSensitive(text: string): string {
  return text.replace(ARN_PATTERN, "[redacted-arn]").replace(ACCOUNT_ID_PATTERN, "[account]");
}

export function isProjectStack(name: string): boolean {
  return name.startsWith(STACK_PREFIX);
}

export function assertTeardownRequested(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.TEARDOWN !== "true") {
    throw new TeardownError(
      "Teardown refused: TEARDOWN=true must be set explicitly to run the debug-sandbox cleanup.",
    );
  }
}

function splitResource(resource: string): { type: string; name: string } {
  const index = resource.search(/[/:]/);
  return index === -1
    ? { type: "resource", name: resource }
    : { type: resource.slice(0, index), name: resource.slice(index + 1) };
}

/** Classifies a tagged-resource ARN by service and type. */
export function describeResource(arn: string): TaggedResource {
  const parts = arn.split(":");
  if (parts.length < 6 || parts[0] !== "arn") {
    return { arn, kind: "other", label: "unrecognized resource", name: "[unparseable]" };
  }
  const service = parts[2];
  const resource = parts.slice(5).join(":");
  const { type, name } = splitResource(resource);

  if (service === "s3" && !resource.includes("/")) {
    return { arn, kind: "s3-bucket", label: "S3 bucket", name: resource };
  }
  if (service === "logs" && type === "log-group") {
    return {
      arn,
      kind: "log-group",
      label: "CloudWatch log group",
      name: name.replace(/:\*$/, ""),
    };
  }
  if (service === "cognito-idp" && type === "userpool") {
    return { arn, kind: "user-pool", label: "Cognito user pool", name };
  }
  if (service === "dynamodb" && type === "table" && !name.includes("/")) {
    return { arn, kind: "dynamodb-table", label: "DynamoDB table", name };
  }
  if (service === "secretsmanager" && type === "secret") {
    return { arn, kind: "secret", label: "Secrets Manager secret", name };
  }
  if (service === "cloudformation" && type === "stack") {
    return {
      arn,
      kind: "cloudformation-stack",
      label: "CloudFormation stack",
      name: name.split("/")[0],
    };
  }
  return { arn, kind: "other", label: `${service} ${type}`, name };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

async function attempt<T>(description: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    throw new TeardownError(`Failed to ${description}: ${describeError(error)}`, { cause: error });
  }
}

async function deleteProjectStacks(
  ports: TeardownPorts,
  log: (message: string) => void,
): Promise<string[]> {
  let remaining = (
    await attempt("list CloudFormation stacks", () => ports.listStackNames())
  ).filter(isProjectStack);
  log(`Found ${remaining.length} CloudFormation stack(s) with prefix ${STACK_PREFIX}.`);
  const deleted: string[] = [];
  // Several passes let a stack that imports another stack's exports go first.
  while (remaining.length > 0) {
    const failures: string[] = [];
    const notDeleted: string[] = [];
    for (const name of remaining) {
      try {
        await ports.deleteStack(name);
        await ports.waitForStackDeleted(name);
        deleted.push(name);
        log(`Deleted CloudFormation stack ${name}.`);
      } catch (error: unknown) {
        notDeleted.push(name);
        failures.push(`CloudFormation stack ${name} (${describeError(error)})`);
      }
    }
    if (notDeleted.length === remaining.length) {
      throw new TeardownError(`Failed to delete ${failures.join("; ")}`);
    }
    remaining = notDeleted;
  }
  return deleted;
}

async function emptyBucket(
  ports: TeardownPorts,
  bucket: string,
  log: (message: string) => void,
): Promise<DeletionOutcome> {
  let marker: VersionPageMarker | undefined;
  let removed = 0;
  do {
    const page = await attempt(`list object versions of S3 bucket ${bucket}`, () =>
      ports.listObjectVersions(bucket, marker),
    );
    if (page === "absent") {
      return "absent";
    }
    if (page.versions.length > 0) {
      await attempt(`delete object versions of S3 bucket ${bucket}`, () =>
        ports.deleteObjectVersions(bucket, page.versions),
      );
      removed += page.versions.length;
    }
    marker = page.next;
  } while (marker);
  log(`Emptied S3 bucket ${bucket} (${removed} object version(s) and delete marker(s)).`);
  return "deleted";
}

async function deleteRetained(
  ports: TeardownPorts,
  resource: TaggedResource,
  log: (message: string) => void,
): Promise<DeletionOutcome | "skipped"> {
  const action = `delete ${resource.label} ${resource.name}`;
  switch (resource.kind) {
    case "s3-bucket":
      if ((await emptyBucket(ports, resource.name, log)) === "absent") {
        return "absent";
      }
      return attempt(action, () => ports.deleteBucket(resource.name));
    case "log-group":
      return attempt(action, () => ports.deleteLogGroup(resource.name));
    case "user-pool":
      return attempt(action, () => ports.deleteUserPool(resource.name));
    case "dynamodb-table":
      return attempt(action, () => ports.deleteTable(resource.name));
    case "secret":
      return attempt(action, () => ports.deleteSecret(resource.arn));
    default:
      // Stacks were handled above; unknown types are never guessed at. Both
      // stay in the inventory check, which fails if they do not disappear.
      return "skipped";
  }
}

async function deleteRetainedResources(
  ports: TeardownPorts,
  log: (message: string) => void,
): Promise<{ deleted: string[]; absent: string[] }> {
  const arns = await attempt(`list resources tagged ${PROJECT_TAG_KEY}=${PROJECT_TAG_VALUE}`, () =>
    ports.listTaggedResourceArns(),
  );
  const deleted: string[] = [];
  const absent: string[] = [];
  for (const resource of arns.map(describeResource)) {
    const description = `${resource.label} ${resource.name}`;
    const outcome = await deleteRetained(ports, resource, log);
    if (outcome === "deleted") {
      deleted.push(description);
      log(`Deleted ${description}.`);
    } else if (outcome === "absent") {
      absent.push(description);
      log(`Already absent: ${description}.`);
    } else {
      log(`Not a retained type; waiting for it in the inventory check: ${description}.`);
    }
  }
  return { deleted, absent };
}

async function listLeftovers(ports: TeardownPorts): Promise<string[]> {
  const stacks = (await attempt("list CloudFormation stacks", () => ports.listStackNames())).filter(
    isProjectStack,
  );
  const tagged = await attempt(
    `list resources tagged ${PROJECT_TAG_KEY}=${PROJECT_TAG_VALUE}`,
    () => ports.listTaggedResourceArns(),
  );
  return [
    ...stacks.map((name) => `CloudFormation stack ${name}`),
    ...tagged.map(describeResource).map((resource) => `${resource.label} ${resource.name}`),
  ];
}

function resolveInventoryBounds(dependencies: TeardownDependencies): {
  attempts: number;
  delayMs: number;
} {
  const attempts = dependencies.inventoryAttempts ?? 10;
  const delayMs = dependencies.inventoryDelayMs ?? 30_000;
  if (!Number.isInteger(attempts) || attempts < 1) {
    // Zero checks would report success without looking; refuse instead.
    throw new TeardownError("inventoryAttempts must be an integer of at least 1.");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new TeardownError("inventoryDelayMs must be a finite number of at least 0.");
  }
  return { attempts, delayMs };
}

async function verifyInventory(
  dependencies: TeardownDependencies,
  bounds: { attempts: number; delayMs: number },
  log: (message: string) => void,
): Promise<void> {
  const { attempts, delayMs } = bounds;
  for (let check = 1; check <= attempts; check += 1) {
    const leftovers = await listLeftovers(dependencies.ports);
    if (leftovers.length === 0) {
      log(
        `Inventory check passed: no ${STACK_PREFIX} stacks and no resources tagged ` +
          `${PROJECT_TAG_KEY}=${PROJECT_TAG_VALUE} remain.`,
      );
      return;
    }
    const summary = `${leftovers.length} item(s) remain: ${leftovers.join(", ")}`;
    if (check === attempts) {
      throw new TeardownError(
        `Teardown incomplete after ${attempts} inventory check(s); ${summary}.`,
      );
    }
    log(`Inventory check ${check}/${attempts}: ${summary}. Waiting for the tag index to settle.`);
    await dependencies.sleep(delayMs);
  }
}

export async function runTeardown(dependencies: TeardownDependencies): Promise<TeardownReport> {
  assertTeardownRequested(dependencies.environment);
  const bounds = resolveInventoryBounds(dependencies);
  const log = (message: string) => dependencies.logger.info(redactSensitive(message));

  const stacksDeleted = await deleteProjectStacks(dependencies.ports, log);
  const { deleted, absent } = await deleteRetainedResources(dependencies.ports, log);
  await verifyInventory(dependencies, bounds, log);
  return { stacksDeleted, resourcesDeleted: deleted, resourcesAlreadyAbsent: absent };
}
