import { App, Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { AsyncMonitoringStack } from "../../../src/infrastructure/async-monitoring/async-monitoring-stack.js";
import { LogRetentionAspect } from "../../../src/infrastructure/async-monitoring/log-retention-aspect.js";
import { ReminderFunctions } from "../../../src/infrastructure/async-monitoring/reminder-functions.js";
import { RESOURCE_NAMES } from "../../../src/infrastructure/async-monitoring/settings.js";
import {
  FoundationStack,
  HTTP_API_ID_PARAMETER_NAME,
} from "../../../src/infrastructure/foundation-stack.js";

export interface WiredApp {
  foundation: FoundationStack;
  asyncMonitoring: AsyncMonitoringStack;
  reminders: ReminderFunctions;
}

/** Mirrors src/app.ts: both stacks, the C5 wiring, cdk-nag, and log retention. */
export function synthWiredApp(context: Record<string, string> = {}): WiredApp {
  const app = new App({ context });
  const env = { region: "us-east-1", account: "123456789012" };
  const foundation = new FoundationStack(app, "team32-ceb-foundation", { env });
  const asyncMonitoring = new AsyncMonitoringStack(app, RESOURCE_NAMES.stack, {
    env,
    httpApiIdParameterName: HTTP_API_ID_PARAMETER_NAME,
    apiAccessLogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
  });
  asyncMonitoring.addStackDependency(foundation);
  const reminders = new ReminderFunctions(asyncMonitoring, "ReminderFunctions", {
    queue: asyncMonitoring.reminderQueue,
  });
  asyncMonitoring.attachReminderSelector(reminders.selector);
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  Aspects.of(app).add(new LogRetentionAspect());
  app.synth();
  return { foundation, asyncMonitoring, reminders };
}

/** The debug-sandbox SES context (synthetic sender and identity). */
export const SES_CONTEXT = {
  reminderEmailMode: "ses",
  reminderSenderEmail: "sender@example.com",
  reminderSenderIdentityArn: "arn:aws:ses:us-east-1:123456789012:identity/example.com",
};
