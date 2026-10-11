import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../../event-api/data/client.js";
import { requireEnv, type Environment } from "../../event-api/http/environment.js";
import { ArchivalRepository } from "../../operations/archival/archival-repository.js";
import {
  ArchivalService,
  type ArchivalMode,
  type ArchivalResult,
} from "../../operations/archival/archival-service.js";
import { S3ArchiveStore, type ArchiveStore } from "../../operations/archival/archive-store.js";
import { createOperationsLogger } from "../../operations/shared/logger.js";

// team32-ceb-archival: C-06 direct invocation by the pipeline and the daily
// schedule. There is no HTTP endpoint.
export interface ArchivalRequest {
  mode: ArchivalMode;
}

const MODES: readonly ArchivalMode[] = ["postDeploy", "scheduled"];

/** A request that does not match C-06; the invocation fails with this error. */
export class InvalidArchivalRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArchivalRequestError";
  }
}

/** Strict C-06 request validation: exactly {mode: "postDeploy" | "scheduled"}. */
export function parseArchivalRequest(event: unknown): ArchivalRequest {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    throw new InvalidArchivalRequestError("The archival request must be a JSON object.");
  }
  const keys = Object.keys(event);
  if (keys.length !== 1 || keys[0] !== "mode") {
    throw new InvalidArchivalRequestError("The archival request must contain only `mode`.");
  }
  const mode = (event as { mode: unknown }).mode;
  if (typeof mode !== "string" || !MODES.includes(mode as ArchivalMode)) {
    throw new InvalidArchivalRequestError("mode must be `postDeploy` or `scheduled`.");
  }
  return { mode: mode as ArchivalMode };
}

export function buildArchivalService(
  env: Environment,
  client: DynamoDBDocumentClient = createDocumentClient(),
  store: ArchiveStore = new S3ArchiveStore(
    new S3Client({}),
    requireEnv(env, "ARCHIVE_BUCKET_NAME"),
  ),
): ArchivalService {
  const tableName = requireEnv(env, "TABLE_NAME");
  return new ArchivalService({
    repository: new ArchivalRepository(client, tableName),
    store,
    clock: () => new Date(),
    logger: createOperationsLogger(),
  });
}

export function createArchivalHandler(service: Pick<ArchivalService, "run">) {
  return async (event: unknown): Promise<ArchivalResult> => {
    const request = parseArchivalRequest(event);
    // Per-event failures are counted in the response (and logged); the
    // pipeline treats failures > 0 as a failed post-deploy step.
    return service.run(request.mode);
  };
}

let archive: ((event: unknown) => Promise<ArchivalResult>) | undefined;

export async function handler(event: unknown): Promise<ArchivalResult> {
  archive ??= createArchivalHandler(buildArchivalService(process.env));
  return archive(event);
}
