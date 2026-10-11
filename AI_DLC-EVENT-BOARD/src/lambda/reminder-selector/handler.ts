import { SQSClient } from "@aws-sdk/client-sqs";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../../event-api/data/client.js";
import { requireEnv, type Environment } from "../../event-api/http/environment.js";
import { SqsReminderQueue, type ReminderQueue } from "../../operations/reminders/reminder-queue.js";
import { ReminderRepository } from "../../operations/reminders/reminder-repository.js";
import {
  ReminderSelector,
  type ReminderSelectionResult,
} from "../../operations/reminders/reminder-selector.js";
import { createOperationsLogger } from "../../operations/shared/logger.js";

// team32-ceb-reminder-selector: invoked every 15 minutes by the C6
// team32-ceb-reminder-selection schedule. A thrown error fails the invocation
// so EventBridge Scheduler retries it; nothing is swallowed.
export function buildReminderSelector(
  env: Environment,
  client: DynamoDBDocumentClient = createDocumentClient(),
  queue: ReminderQueue = new SqsReminderQueue(
    new SQSClient({}),
    requireEnv(env, "REMINDER_QUEUE_URL"),
  ),
): ReminderSelector {
  return new ReminderSelector({
    repository: new ReminderRepository(client, requireEnv(env, "TABLE_NAME")),
    queue,
    clock: () => new Date(),
    logger: createOperationsLogger(),
  });
}

let selector: ReminderSelector | undefined;

export async function handler(): Promise<ReminderSelectionResult> {
  selector ??= buildReminderSelector(process.env);
  return selector.run();
}
