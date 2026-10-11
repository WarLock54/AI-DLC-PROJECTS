import { SESv2Client } from "@aws-sdk/client-sesv2";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../event-api/data/client.js";
import { requireEnv, type Environment } from "../../event-api/http/environment.js";
import {
  LogEmailSender,
  SesEmailSender,
  type EmailSender,
} from "../../operations/reminders/email-sender.js";
import { parseReminderMessage } from "../../operations/reminders/message.js";
import { ReminderRepository } from "../../operations/reminders/reminder-repository.js";
import { ReminderWorker } from "../../operations/reminders/reminder-worker.js";
import {
  createOperationsLogger,
  errorName,
  type OperationsLogger,
} from "../../operations/shared/logger.js";

// team32-ceb-reminder-worker: consumes the C6 reminder queue with partial
// batch responses. A failed record is reported, retried by SQS, and moved to
// the DLQ after the redrive limit (FR7.5).

/** EMAIL_MODE=log is the default and the final-sandbox setting (FR7.2). */
export function createEmailSender(
  env: Environment,
  sesClient: () => Pick<SESv2Client, "send"> = () => new SESv2Client({}),
): EmailSender {
  const mode = env.EMAIL_MODE?.trim() || "log";
  if (mode === "log") {
    return new LogEmailSender();
  }
  if (mode === "ses") {
    return new SesEmailSender(sesClient(), requireEnv(env, "REMINDER_SENDER_EMAIL"));
  }
  throw new Error("EMAIL_MODE must be `log` or `ses`.");
}

export interface ReminderWorkerHandlerDependencies {
  worker: Pick<ReminderWorker, "process">;
  logger: OperationsLogger;
}

export function createReminderWorkerHandler(deps: ReminderWorkerHandlerDependencies) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        const message = parseReminderMessage(record.body);
        await deps.worker.process(message);
      } catch (error) {
        deps.logger.error({
          event: "REMINDER_DELIVERY_FAILED",
          messageId: record.messageId,
          errorName: errorName(error),
        });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

export function buildReminderWorkerDependencies(
  env: Environment,
  client: DynamoDBDocumentClient = createDocumentClient(),
  sender: EmailSender = createEmailSender(env),
): ReminderWorkerHandlerDependencies {
  const logger = createOperationsLogger();
  return {
    worker: new ReminderWorker({
      repository: new ReminderRepository(client, requireEnv(env, "TABLE_NAME")),
      sender,
      clock: () => new Date(),
      logger,
    }),
    logger,
  };
}

let processBatch: ((event: SQSEvent) => Promise<SQSBatchResponse>) | undefined;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  processBatch ??= createReminderWorkerHandler(buildReminderWorkerDependencies(process.env));
  return processBatch(event);
}
