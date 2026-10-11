#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { resolveRegion } from "./config/region.js";
import { AsyncMonitoringStack } from "./infrastructure/async-monitoring/async-monitoring-stack.js";
import { LogRetentionAspect } from "./infrastructure/async-monitoring/log-retention-aspect.js";
import { ReminderFunctions } from "./infrastructure/async-monitoring/reminder-functions.js";
import { RESOURCE_NAMES } from "./infrastructure/async-monitoring/settings.js";
import { FoundationStack, HTTP_API_ID_PARAMETER_NAME } from "./infrastructure/foundation-stack.js";

const region = resolveRegion();
const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region,
};

const foundation = new FoundationStack(app, "team32-ceb-foundation", {
  env,
  description: "Shared Community Event Board foundation resources.",
});

// C6: reminder queue/DLQ, alarm topic, alarms, and metric filters.
// The API id is read from SSM rather than a cross-stack export (D5); the explicit
// dependency keeps the deploy order: foundation first, then C6.
const asyncMonitoring = new AsyncMonitoringStack(app, RESOURCE_NAMES.stack, {
  env,
  description: "Community Event Board async and monitoring resources.",
  httpApiIdParameterName: HTTP_API_ID_PARAMETER_NAME,
  apiAccessLogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
});
asyncMonitoring.addStackDependency(foundation);

// C5 (Q1 A): the reminder selector and worker live beside the queue in the C6
// stack and reach the foundation table by its fixed name (no cross-stack export).
const reminderFunctions = new ReminderFunctions(asyncMonitoring, "ReminderFunctions", {
  queue: asyncMonitoring.reminderQueue,
});
asyncMonitoring.attachReminderSelector(reminderFunctions.selector);

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
// NFR31: every log group in the app keeps logs for exactly 14 days.
Aspects.of(app).add(new LogRetentionAspect());
app.synth();
