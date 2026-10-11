import { Aws, CfnOutput, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import {
  ALARM_NAMES,
  ALARM_PERIOD,
  API_LATENCY_EVALUATION_PERIODS,
  API_LATENCY_P95_THRESHOLD_MS,
  HTTP_API_STAGE,
  METRIC_FILTERS,
  METRIC_NAMESPACE,
  PROJECT_TAG,
  REMINDER_REDRIVE,
  REMINDER_SCHEDULE_EXPRESSION,
  REMINDER_SCHEDULE_RETRY_ATTEMPTS,
  RESOURCE_NAMES,
} from "./settings.js";

interface AlarmSpec {
  readonly id: string;
  readonly alarmName: string;
  readonly description: string;
  readonly metric: cloudwatch.IMetric;
  readonly threshold: number;
  readonly evaluationPeriods?: number;
}

export interface AsyncMonitoringStackProps extends StackProps {
  /**
   * Name of the SSM String parameter holding the foundation's HTTP API id
   * (`team32-ceb-http-api-id`). Read at deploy time instead of a CloudFormation
   * export (decision D5), so the foundation can change its API without a lock.
   */
  readonly httpApiIdParameterName: string;
  /** Name of the foundation's HTTP API access log group (`team32-ceb-http-api-access`). */
  readonly apiAccessLogGroupName: string;
}

/**
 * C6 async and monitoring resources.
 *
 * Provides the reminder queue and its dead-letter queue (FR7.5), the alarm
 * topic, and (after a selector is attached) the 15-minute reminder schedule
 * (FR7.4). The queue message payload is owned by C5 (C-05); this stack never
 * produces a message.
 *
 * Redrive values are PROVISIONAL (decision D2) until C-05 Group B is agreed;
 * see `REMINDER_REDRIVE` in `settings.ts`.
 */
export class AsyncMonitoringStack extends Stack {
  public readonly reminderQueue: sqs.Queue;
  public readonly reminderDlq: sqs.Queue;
  public readonly alarmTopic: sns.Topic;
  private reminderSchedule?: scheduler.CfnSchedule;

  constructor(scope: Construct, id: string, props: AsyncMonitoringStackProps) {
    super(scope, id, props);
    requireNonEmpty(props.httpApiIdParameterName, "httpApiIdParameterName");
    requireNonEmpty(props.apiAccessLogGroupName, "apiAccessLogGroupName");
    Tags.of(this).add(PROJECT_TAG.key, PROJECT_TAG.value);

    this.reminderDlq = new sqs.Queue(this, "ReminderDlq", {
      queueName: RESOURCE_NAMES.reminderDlq,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: REMINDER_REDRIVE.dlqRetention,
    });
    this.reminderQueue = new sqs.Queue(this, "ReminderQueue", {
      queueName: RESOURCE_NAMES.reminderQueue,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      visibilityTimeout: REMINDER_REDRIVE.visibilityTimeout,
      deadLetterQueue: {
        queue: this.reminderDlq,
        maxReceiveCount: REMINDER_REDRIVE.maxReceiveCount,
      },
    });
    // No subscriptions: the final sandbox cannot confirm email endpoints (NFR21).
    // Alarm state and history are the C-08 evidence.
    // No server-side encryption (decision D4): CloudWatch alarms cannot publish to a
    // topic encrypted with the AWS-managed `alias/aws/sns` key, and a customer-managed
    // key adds recurring cost and teardown work for messages that hold only alarm
    // names and states. Access stays account-only and SSL-only.
    this.alarmTopic = new sns.Topic(this, "AlarmTopic", {
      topicName: RESOURCE_NAMES.alarmTopic,
      enforceSSL: true,
    });
    NagSuppressions.addResourceSuppressions(this.alarmTopic, [
      {
        id: "AwsSolutions-SNS2",
        reason:
          "Alarm notifications carry only alarm names, metric names, and states; no event or personal data. CloudWatch cannot publish to a topic encrypted with the AWS-managed SNS key, and a customer-managed key adds recurring cost the community budget does not justify. The topic policy keeps access account-only and SSL-only. Owner: project maintainer. Review by 2027-01-03.",
      },
    ]);

    this.createAlarms(props);
    // C-01: exactly these two outputs; additive outputs are not allowed.
    new CfnOutput(this, "ReminderQueueUrl", { value: this.reminderQueue.queueUrl });
    new CfnOutput(this, "AlarmTopicArn", { value: this.alarmTopic.topicArn });
  }

  /**
   * Attaches the C5 reminder selector to the 15-minute reminder schedule (FR7.4, decision D1).
   *
   * Until this is called the stack creates no schedule, so nothing fires against a
   * missing target and C6 never puts a non-contract message on the queue (C-05).
   *
   * C5 usage, in `src/app.ts` after creating its selector function:
   *
   * ```ts
   * asyncMonitoring.attachReminderSelector(reminderSelectorFunction);
   * ```
   *
   * Creates the `team32-ceb-reminder-scheduler` role, trusted only by EventBridge
   * Scheduler from this account and allowed only `lambda:InvokeFunction` on the
   * selector's ARN, and the `team32-ceb-reminder-selection` schedule. The selector
   * should give itself an explicit 14-day log group so the log-retention aspect passes.
   *
   * @throws Error when a selector is already attached (one selector per stack).
   */
  public attachReminderSelector(selector: lambda.IFunction): scheduler.CfnSchedule {
    if (this.reminderSchedule) {
      throw new Error(
        "A reminder selector is already attached to this stack; only one selector is supported.",
      );
    }
    const role = new iam.Role(this, "ReminderSchedulerRole", {
      roleName: RESOURCE_NAMES.schedulerRole,
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID } },
      }),
      description: "Lets EventBridge Scheduler invoke only the C5 reminder selector.",
    });
    // Explicit statement instead of grantInvoke, which would also allow `<arn>:*`.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [selector.functionArn],
      }),
    );
    this.reminderSchedule = new scheduler.CfnSchedule(this, "ReminderSelectionSchedule", {
      name: RESOURCE_NAMES.reminderSchedule,
      description: "Runs the C5 reminder selector every 15 minutes (FR7.4).",
      scheduleExpression: REMINDER_SCHEDULE_EXPRESSION,
      flexibleTimeWindow: { mode: "OFF" },
      state: "ENABLED",
      target: {
        arn: selector.functionArn,
        roleArn: role.roleArn,
        retryPolicy: { maximumRetryAttempts: REMINDER_SCHEDULE_RETRY_ATTEMPTS },
      },
    });
    return this.reminderSchedule;
  }

  /**
   * C-08 / NFR22 alarms. Every alarm uses a 5-minute period, fires at or above
   * its threshold, treats missing data as not breaching, and notifies the
   * alarm topic.
   */
  private createAlarms(props: AsyncMonitoringStackProps): void {
    const httpApiId = ssm.StringParameter.valueForStringParameter(
      this,
      props.httpApiIdParameterName,
    );
    const apiDimensions = { ApiId: httpApiId, Stage: HTTP_API_STAGE };
    const apiMetric = (metricName: string, statistic: string): cloudwatch.Metric =>
      new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName,
        dimensionsMap: apiDimensions,
        statistic,
        period: ALARM_PERIOD,
      });
    // No dimensions: the account/region aggregate covers every solution Lambda,
    // including functions added by later Units.
    const lambdaMetric = (metricName: string): cloudwatch.Metric =>
      new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName,
        statistic: cloudwatch.Stats.SUM,
        period: ALARM_PERIOD,
      });
    const filterMetrics = this.createAccessLogMetricFilters(props.apiAccessLogGroupName);

    const specs: AlarmSpec[] = [
      {
        id: "Api5xxAlarm",
        alarmName: ALARM_NAMES.api5xx,
        description: "HTTP API returned one or more 5xx responses in 5 minutes.",
        metric: apiMetric("5xx", cloudwatch.Stats.SUM),
        threshold: 1,
      },
      {
        id: "ApiLatencyP95Alarm",
        alarmName: ALARM_NAMES.apiLatencyP95,
        description: "HTTP API p95 latency is at or above 1000 ms (NFR8 target is under 1 s).",
        metric: apiMetric("Latency", cloudwatch.Stats.p(95)),
        threshold: API_LATENCY_P95_THRESHOLD_MS,
        evaluationPeriods: API_LATENCY_EVALUATION_PERIODS,
      },
      {
        id: "LambdaErrorsAlarm",
        alarmName: ALARM_NAMES.lambdaErrors,
        description: "One or more Lambda invocations failed in 5 minutes.",
        metric: lambdaMetric("Errors"),
        threshold: 1,
      },
      {
        id: "LambdaThrottlesAlarm",
        alarmName: ALARM_NAMES.lambdaThrottles,
        description: "One or more Lambda invocations were throttled in 5 minutes.",
        metric: lambdaMetric("Throttles"),
        threshold: 1,
      },
      {
        id: "ReminderDlqMessagesAlarm",
        alarmName: ALARM_NAMES.reminderDlqMessages,
        description: "Failed reminder messages are waiting in the reminder DLQ.",
        metric: this.reminderDlq.metricApproximateNumberOfMessagesVisible({
          statistic: cloudwatch.Stats.MAXIMUM,
          period: ALARM_PERIOD,
        }),
        threshold: 1,
      },
      {
        id: "AuthFailuresAlarm",
        alarmName: ALARM_NAMES.authFailures,
        description: "The HTTP API returned one or more 401 responses in 5 minutes.",
        metric: filterMetrics.authFailures,
        threshold: 1,
      },
      {
        id: "DeniedAdminActionsAlarm",
        alarmName: ALARM_NAMES.deniedAdminActions,
        description: "The HTTP API returned one or more 403 responses in 5 minutes.",
        metric: filterMetrics.deniedAdminActions,
        threshold: 1,
      },
    ];

    const topicAction = new cloudwatchActions.SnsAction(this.alarmTopic);
    for (const spec of specs) {
      const alarm = new cloudwatch.Alarm(this, spec.id, {
        alarmName: spec.alarmName,
        alarmDescription: spec.description,
        metric: spec.metric,
        threshold: spec.threshold,
        evaluationPeriods: spec.evaluationPeriods ?? 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(topicAction);
    }
  }

  /** NFR22: count 401 and 403 responses from the foundation's access log. */
  private createAccessLogMetricFilters(
    logGroupName: string,
  ): Record<keyof typeof METRIC_FILTERS, cloudwatch.Metric> {
    const accessLogs = logs.LogGroup.fromLogGroupName(this, "ApiAccessLogs", logGroupName);
    const filter = (id: string, spec: { metricName: string; pattern: string }): cloudwatch.Metric =>
      new logs.MetricFilter(this, id, {
        logGroup: accessLogs,
        filterPattern: logs.FilterPattern.literal(spec.pattern),
        metricNamespace: METRIC_NAMESPACE,
        metricName: spec.metricName,
        metricValue: "1",
        defaultValue: 0,
      }).metric({ statistic: cloudwatch.Stats.SUM, period: ALARM_PERIOD });

    return {
      authFailures: filter("AuthFailuresMetricFilter", METRIC_FILTERS.authFailures),
      deniedAdminActions: filter(
        "DeniedAdminActionsMetricFilter",
        METRIC_FILTERS.deniedAdminActions,
      ),
    };
  }
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`AsyncMonitoringStack requires a non-empty ${name}.`);
  }
}
