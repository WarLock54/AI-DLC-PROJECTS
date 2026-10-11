import { Duration, Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import type * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { allowIndexQuery, allowItems, createOperationsFunction } from "../operations-function.js";

/**
 * The foundation table's fixed physical name. The reminder functions reference
 * it by name (Q1 A) so the foundation never depends on this stack and no
 * cross-stack export is created.
 */
export const EVENTS_TABLE_NAME = "team32-ceb-events";

export const C5_REMINDER_NAMES = {
  selectorFunction: "team32-ceb-reminder-selector",
  workerFunction: "team32-ceb-reminder-worker",
} as const;

/** CDK context keys for the debug-sandbox SES path (FR7.6). */
export const REMINDER_CONTEXT_KEYS = {
  emailMode: "reminderEmailMode",
  senderEmail: "reminderSenderEmail",
  senderIdentityArn: "reminderSenderIdentityArn",
} as const;

/** SQS batch size for the worker; failed records are reported individually. */
export const REMINDER_WORKER_BATCH_SIZE = 10;

export interface ReminderFunctionsProps {
  /** The C6 reminder queue (same stack). */
  queue: sqs.IQueue;
}

interface EmailSettings {
  mode: "log" | "ses";
  senderEmail?: string;
  senderIdentityArn?: string;
}

/**
 * C5 reminder selector and worker, placed in the C6 async-monitoring stack
 * beside the queue they use (Q1 A). The selector is attached to the C6
 * 15-minute schedule by `AsyncMonitoringStack.attachReminderSelector`.
 *
 * Email mode comes from CDK context `reminderEmailMode` (default `log`, the
 * final-sandbox setting). `ses` is for the debug sandbox only and also needs
 * `reminderSenderEmail` and `reminderSenderIdentityArn`; only then is
 * `ses:SendEmail` granted, on that identity alone.
 */
export class ReminderFunctions extends Construct {
  public readonly selector: nodejs.NodejsFunction;
  public readonly worker: nodejs.NodejsFunction;
  public readonly emailMode: "log" | "ses";

  constructor(scope: Construct, id: string, props: ReminderFunctionsProps) {
    super(scope, id);
    const email = this.readEmailSettings();
    this.emailMode = email.mode;
    const stack = Stack.of(this);
    const tableArn = stack.formatArn({
      service: "dynamodb",
      resource: "table",
      resourceName: EVENTS_TABLE_NAME,
    });

    this.selector = createOperationsFunction(this, {
      id: "ReminderSelector",
      name: C5_REMINDER_NAMES.selectorFunction,
      entry: "src/lambda/reminder-selector/handler.ts",
      description: "Selects confirmed registrations for events starting in ~24 hours (FR7).",
      environment: { TABLE_NAME: EVENTS_TABLE_NAME, REMINDER_QUEUE_URL: props.queue.queueUrl },
      timeout: Duration.seconds(60),
    });
    allowIndexQuery(this.selector, tableArn, ["GSI5", "GSI7"]);
    allowItems(this.selector, ["dynamodb:PutItem", "dynamodb:DeleteItem"], tableArn, [
      "REMINDER#*",
    ]);
    this.selector.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [props.queue.queueArn],
      }),
    );

    const workerEnvironment: Record<string, string> = {
      TABLE_NAME: EVENTS_TABLE_NAME,
      EMAIL_MODE: email.mode,
    };
    if (email.mode === "ses" && email.senderEmail) {
      workerEnvironment.REMINDER_SENDER_EMAIL = email.senderEmail;
    }
    this.worker = createOperationsFunction(this, {
      id: "ReminderWorker",
      name: C5_REMINDER_NAMES.workerFunction,
      entry: "src/lambda/reminder-worker/handler.ts",
      description: "Delivers queued reminders (EMAIL_MODE=log by default).",
      environment: workerEnvironment,
      // Must stay below the C6 queue visibility timeout (180 s).
      timeout: Duration.seconds(30),
    });
    // Event META and ReminderAttempt reads; outcome updates on attempts only.
    allowItems(this.worker, ["dynamodb:GetItem"], tableArn, ["EVENT#*", "REMINDER#*"]);
    allowItems(this.worker, ["dynamodb:UpdateItem"], tableArn, ["REMINDER#*"]);
    allowIndexQuery(this.worker, tableArn, ["GSI5"]);
    if (email.mode === "ses" && email.senderIdentityArn) {
      this.worker.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ses:SendEmail"],
          resources: [email.senderIdentityArn],
        }),
      );
    }
    this.worker.addEventSource(
      new lambdaEventSources.SqsEventSource(props.queue, {
        batchSize: REMINDER_WORKER_BATCH_SIZE,
        reportBatchItemFailures: true,
      }),
    );
  }

  private readEmailSettings(): EmailSettings {
    const mode = String(this.node.tryGetContext(REMINDER_CONTEXT_KEYS.emailMode) ?? "log");
    if (mode === "log") {
      return { mode };
    }
    if (mode !== "ses") {
      throw new Error("CDK context reminderEmailMode must be `log` or `ses`.");
    }
    const senderEmail = this.node.tryGetContext(REMINDER_CONTEXT_KEYS.senderEmail) as unknown;
    const senderIdentityArn = this.node.tryGetContext(
      REMINDER_CONTEXT_KEYS.senderIdentityArn,
    ) as unknown;
    if (typeof senderEmail !== "string" || !senderEmail.includes("@")) {
      throw new Error("reminderEmailMode=ses requires the reminderSenderEmail context value.");
    }
    if (typeof senderIdentityArn !== "string" || !senderIdentityArn.startsWith("arn:")) {
      throw new Error(
        "reminderEmailMode=ses requires the reminderSenderIdentityArn context value.",
      );
    }
    return { mode, senderEmail, senderIdentityArn };
  }
}
