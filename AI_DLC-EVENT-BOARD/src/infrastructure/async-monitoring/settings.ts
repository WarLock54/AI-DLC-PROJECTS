import { Duration } from "aws-cdk-lib";

/**
 * Named settings for the C6 async and monitoring stack.
 *
 * Every physical resource name lives here so tests and evidence scripts use the
 * same strings as the infrastructure, and a name that drifts away from the
 * `team32-ceb-` prefix or the C-01/C-08 contracts fails the C6 tests.
 */

/** Project tag applied to every taggable resource in the stack. */
export const PROJECT_TAG = { key: "project", value: "team32-ceb" } as const;

/** Resource names (all carry the mandatory `team32-ceb-` prefix). */
export const RESOURCE_NAMES = {
  stack: "team32-ceb-async-monitoring",
  reminderQueue: "team32-ceb-reminders",
  reminderDlq: "team32-ceb-reminders-dlq",
  alarmTopic: "team32-ceb-alarms",
  schedulerRole: "team32-ceb-reminder-scheduler",
  reminderSchedule: "team32-ceb-reminder-selection",
  apiAccessLogGroup: "team32-ceb-http-api-access",
} as const;

/** Alarm names required by C-08 / NFR22. */
export const ALARM_NAMES = {
  api5xx: "team32-ceb-api-5xx",
  apiLatencyP95: "team32-ceb-api-latency-p95",
  lambdaErrors: "team32-ceb-lambda-errors",
  lambdaThrottles: "team32-ceb-lambda-throttles",
  reminderDlqMessages: "team32-ceb-reminder-dlq-messages",
  authFailures: "team32-ceb-auth-failures",
  deniedAdminActions: "team32-ceb-denied-admin-actions",
} as const;

/** FR7.4: the reminder selector runs every 15 minutes. */
export const REMINDER_SCHEDULE_EXPRESSION = "rate(15 minutes)";

/** EventBridge Scheduler retries for a failed selector invocation. */
export const REMINDER_SCHEDULE_RETRY_ATTEMPTS = 3;

/**
 * FR7.5 redrive settings.
 *
 * PROVISIONAL (decision D2): C-05 Group B (redrive semantics) is still open with
 * the C5 owner. These defaults are safe to change later; changing them is a
 * non-breaking infrastructure update.
 */
export const REMINDER_REDRIVE = {
  maxReceiveCount: 3,
  visibilityTimeout: Duration.seconds(180),
  dlqRetention: Duration.days(14),
} as const;

/** NFR8: p95 API latency target is under 1 s, so the alarm fires at p95 >= 1000 ms. */
export const API_LATENCY_P95_THRESHOLD_MS = 1000;

/** Consecutive 5-minute periods the latency alarm needs before it fires. */
export const API_LATENCY_EVALUATION_PERIODS = 3;

/** Evaluation period shared by every C6 alarm. */
export const ALARM_PERIOD = Duration.minutes(5);

/** NFR31: every log group keeps logs for exactly 14 days. */
export const LOG_RETENTION_DAYS = 14;

/** HTTP API stage whose metrics the API alarms read. */
export const HTTP_API_STAGE = "$default";

/** Custom metric namespace for the access-log metric filters. */
export const METRIC_NAMESPACE = "team32-ceb";

/** NFR22 / C-08 access-log metric filters. */
export const METRIC_FILTERS = {
  authFailures: { metricName: "AuthFailures", pattern: '{ $.status = "401" }' },
  deniedAdminActions: { metricName: "DeniedAdminActions", pattern: '{ $.status = "403" }' },
} as const;

/** C-01: the only outputs this stack may publish. */
export const C6_OUTPUT_KEYS = ["ReminderQueueUrl", "AlarmTopicArn"] as const;
