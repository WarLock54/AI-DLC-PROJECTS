// C4 (D3): web-deployment custom resource logic. Publishes the built UI assets
// and config.json into the web bucket, prunes objects it wrote before that are
// no longer part of the set, and invalidates the UI paths in CloudFront.
//
// Every failure becomes a FAILED CloudFormation response with a clear reason;
// nothing fails silently. Delete never removes objects (bucket retention
// matches C1). Reasons and logs carry only error names, never ARNs, account IDs,
// or SDK messages.
import type { CloudFormationCustomResourceEvent } from "aws-lambda";

export const PHYSICAL_ID_PREFIX = "team32-ceb-web-deployment";
export const CONFIG_KEY = "config.json";
export const NO_CACHE = "no-cache";
export const SHORT_CACHE = "public, max-age=300, must-revalidate";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};
const NO_CACHE_KEYS = new Set(["index.html", CONFIG_KEY]);

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const DISTRIBUTION_PATTERN = /^[A-Z0-9]{8,32}$/;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const USER_POOL_ID_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+_[0-9A-Za-z]+$/;
const CLIENT_ID_PATTERN = /^[0-9A-Za-z]+$/;

export interface WebFile {
  key: string;
  sourceBucket: string;
  sourceKey: string;
}

export interface WebDeployProperties {
  destinationBucket: string;
  distributionId: string;
  files: WebFile[];
  config: { region: string; userPoolId: string; userPoolClientId: string };
  invalidationPaths: string[];
}

export interface WebDeployPorts {
  copyObject(input: {
    sourceBucket: string;
    sourceKey: string;
    bucket: string;
    key: string;
    contentType: string;
    cacheControl: string;
  }): Promise<void>;
  putObject(input: {
    bucket: string;
    key: string;
    body: string;
    contentType: string;
    cacheControl: string;
  }): Promise<void>;
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  createInvalidation(input: {
    distributionId: string;
    paths: string[];
    callerReference: string;
  }): Promise<string>;
  getInvalidationStatus(input: { distributionId: string; invalidationId: string }): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(entry: Record<string, unknown>): void;
}

export interface WaitOptions {
  /** How long to wait for the invalidation to complete before reporting it as in progress. */
  waitTimeoutMs: number;
  pollIntervalMs: number;
}

export const DEFAULT_WAIT: WaitOptions = { waitTimeoutMs: 5 * 60_000, pollIntervalMs: 10_000 };

export interface DeployResult {
  status: "SUCCESS" | "FAILED";
  physicalResourceId: string;
  reason?: string;
  data?: Record<string, string>;
}

export class PropertyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyError";
  }
}

class StepError extends Error {
  constructor(step: string, cause: unknown) {
    super(`${step} failed: ${errorName(cause)}.`);
    this.name = "StepError";
  }
}

export function contentTypeFor(key: string): string {
  const dot = key.lastIndexOf(".");
  const type = dot === -1 ? undefined : CONTENT_TYPES[key.slice(dot).toLowerCase()];
  if (!type) {
    throw new PropertyError(`No content type is known for "${key}".`);
  }
  return type;
}

export function cacheControlFor(key: string): string {
  return NO_CACHE_KEYS.has(key) ? NO_CACHE : SHORT_CACHE;
}

export async function processEvent(
  event: CloudFormationCustomResourceEvent,
  ports: WebDeployPorts,
  wait: WaitOptions = DEFAULT_WAIT,
): Promise<DeployResult> {
  const existingId = "PhysicalResourceId" in event ? event.PhysicalResourceId : undefined;
  if (event.RequestType === "Delete") {
    ports.log({ level: "info", event: "WEB_DEPLOY_DELETE_SKIPPED" });
    return { status: "SUCCESS", physicalResourceId: existingId ?? PHYSICAL_ID_PREFIX };
  }
  let properties: WebDeployProperties;
  try {
    properties = parseProperties(event.ResourceProperties);
  } catch (error) {
    const reason = `Invalid web deployment properties: ${(error as Error).message}`;
    ports.log({ level: "error", event: "WEB_DEPLOY_FAILED", step: "properties" });
    return { status: "FAILED", physicalResourceId: existingId ?? PHYSICAL_ID_PREFIX, reason };
  }
  const physicalResourceId = `${PHYSICAL_ID_PREFIX}-${properties.destinationBucket}`;
  try {
    const previous =
      event.RequestType === "Update" ? previousKeys(event.OldResourceProperties) : [];
    await publish(properties, previous, ports);
    const invalidation = await invalidate(properties, event.RequestId, ports, wait);
    ports.log({ level: "info", event: "WEB_DEPLOY_SUCCEEDED", ...invalidation });
    return { status: "SUCCESS", physicalResourceId, data: invalidation };
  } catch (error) {
    const reason =
      error instanceof StepError || error instanceof PropertyError
        ? error.message
        : `Web deployment failed: ${errorName(error)}.`;
    ports.log({ level: "error", event: "WEB_DEPLOY_FAILED", reason });
    return { status: "FAILED", physicalResourceId, reason };
  }
}

async function publish(
  properties: WebDeployProperties,
  previous: string[],
  ports: WebDeployPorts,
): Promise<void> {
  const bucket = properties.destinationBucket;
  for (const file of properties.files) {
    await step(`Copying ${file.key} into the web bucket`, () =>
      ports.copyObject({
        sourceBucket: file.sourceBucket,
        sourceKey: file.sourceKey,
        bucket,
        key: file.key,
        contentType: contentTypeFor(file.key),
        cacheControl: cacheControlFor(file.key),
      }),
    );
  }
  await step("Writing config.json into the web bucket", () =>
    ports.putObject({
      bucket,
      key: CONFIG_KEY,
      body: JSON.stringify(properties.config),
      contentType: contentTypeFor(CONFIG_KEY),
      cacheControl: cacheControlFor(CONFIG_KEY),
    }),
  );
  const current = new Set([...properties.files.map((file) => file.key), CONFIG_KEY]);
  for (const key of previous.filter((candidate) => !current.has(candidate))) {
    await step(`Removing stale ${key} from the web bucket`, () =>
      ports.deleteObject({ bucket, key }),
    );
  }
}

async function invalidate(
  properties: WebDeployProperties,
  requestId: string,
  ports: WebDeployPorts,
  wait: WaitOptions,
): Promise<Record<string, string>> {
  const invalidationId = await step("Creating the CloudFront invalidation", () =>
    ports.createInvalidation({
      distributionId: properties.distributionId,
      paths: properties.invalidationPaths,
      callerReference: `${PHYSICAL_ID_PREFIX}-${requestId}`,
    }),
  );
  const deadline = ports.now() + wait.waitTimeoutMs;
  for (;;) {
    const status = await step("Reading the CloudFront invalidation status", () =>
      ports.getInvalidationStatus({ distributionId: properties.distributionId, invalidationId }),
    );
    if (status === "Completed") {
      return { InvalidationId: invalidationId, InvalidationStatus: status };
    }
    if (ports.now() >= deadline) {
      // The files are published and the invalidation is accepted; CloudFront
      // finishes it on its own. Report it clearly instead of failing the stack.
      ports.log({
        level: "warn",
        event: "WEB_DEPLOY_INVALIDATION_PENDING",
        invalidationId,
        status,
      });
      return { InvalidationId: invalidationId, InvalidationStatus: status };
    }
    await ports.sleep(wait.pollIntervalMs);
  }
}

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof PropertyError) {
      throw error;
    }
    throw new StepError(name, error);
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "Error" ? "UnknownError" : error.name;
  }
  return "UnknownError";
}

function previousKeys(properties: unknown): string[] {
  try {
    const parsed = parseProperties(properties);
    return [...parsed.files.map((file) => file.key), CONFIG_KEY];
  } catch {
    // Old properties that cannot be read give nothing to prune; this never
    // deletes anything it cannot prove it wrote.
    return [];
  }
}

export function parseProperties(raw: unknown): WebDeployProperties {
  const source = asRecord(raw, "properties");
  const destinationBucket = matching(source.DestinationBucket, "DestinationBucket", BUCKET_PATTERN);
  const distributionId = matching(source.DistributionId, "DistributionId", DISTRIBUTION_PATTERN);
  if (!Array.isArray(source.Files) || source.Files.length === 0) {
    throw new PropertyError("Files must be a non-empty list.");
  }
  const files = source.Files.map((entry, index): WebFile => {
    const file = asRecord(entry, `Files[${index}]`);
    const key = matching(file.Key, `Files[${index}].Key`, OBJECT_KEY_PATTERN);
    if (key === CONFIG_KEY) {
      throw new PropertyError(`Files[${index}].Key must not be ${CONFIG_KEY}.`);
    }
    contentTypeFor(key);
    return {
      key,
      sourceBucket: matching(file.SourceBucket, `Files[${index}].SourceBucket`, BUCKET_PATTERN),
      sourceKey: matching(file.SourceKey, `Files[${index}].SourceKey`, OBJECT_KEY_PATTERN),
    };
  });
  const config = asRecord(source.Config, "Config");
  const paths = source.InvalidationPaths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((path) => typeof path === "string" && path.startsWith("/"))
  ) {
    throw new PropertyError("InvalidationPaths must be a non-empty list of absolute paths.");
  }
  return {
    destinationBucket,
    distributionId,
    files,
    config: {
      region: matching(config.Region, "Config.Region", REGION_PATTERN),
      userPoolId: matching(config.UserPoolId, "Config.UserPoolId", USER_POOL_ID_PATTERN),
      userPoolClientId: matching(
        config.UserPoolClientId,
        "Config.UserPoolClientId",
        CLIENT_ID_PATTERN,
      ),
    },
    invalidationPaths: paths as string[],
  };
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PropertyError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function matching(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new PropertyError(`${name} is missing or invalid.`);
  }
  return value;
}
