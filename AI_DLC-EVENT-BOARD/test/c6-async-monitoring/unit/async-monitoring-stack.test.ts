import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AsyncMonitoringStack } from "../../../src/infrastructure/async-monitoring/async-monitoring-stack.js";
import {
  ALARM_NAMES,
  C6_OUTPUT_KEYS,
  RESOURCE_NAMES,
} from "../../../src/infrastructure/async-monitoring/settings.js";

const TEST_API_ID_PARAMETER = "team32-ceb-http-api-id";

type CfnResource = { Type: string; Properties?: Record<string, unknown> };

let cachedTemplate: Template | undefined;

function createTemplate(): Template {
  if (cachedTemplate) {
    return cachedTemplate;
  }
  const app = new App();
  const stack = new AsyncMonitoringStack(app, RESOURCE_NAMES.stack, {
    env: { region: "us-east-1" },
    httpApiIdParameterName: TEST_API_ID_PARAMETER,
    apiAccessLogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
  });
  cachedTemplate = Template.fromStack(stack);
  return cachedTemplate;
}

/** The deploy-time SSM parameter CDK creates for the HTTP API id (D5). */
function apiIdParameterRef(): { Ref: string } {
  const parameters = Object.keys(
    createTemplate().findParameters("*", {
      Type: "AWS::SSM::Parameter::Value<String>",
      Default: TEST_API_ID_PARAMETER,
    }),
  );
  expect(parameters).toHaveLength(1);
  return { Ref: parameters[0] };
}

function logicalIdOf(type: string, properties: Record<string, unknown>): string {
  const matches = Object.keys(createTemplate().findResources(type, { Properties: properties }));
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe("C6 reminder queue and dead-letter queue", () => {
  it("creates the reminder queue with SQS-managed encryption, 180 s visibility, and redrive to the DLQ", () => {
    const dlqId = logicalIdOf("AWS::SQS::Queue", { QueueName: RESOURCE_NAMES.reminderDlq });
    createTemplate().hasResourceProperties("AWS::SQS::Queue", {
      QueueName: RESOURCE_NAMES.reminderQueue,
      SqsManagedSseEnabled: true,
      VisibilityTimeout: 180,
      RedrivePolicy: {
        deadLetterTargetArn: { "Fn::GetAtt": [dlqId, "Arn"] },
        maxReceiveCount: 3,
      },
    });
  });

  it("creates the DLQ with SQS-managed encryption and 14-day retention", () => {
    createTemplate().hasResourceProperties("AWS::SQS::Queue", {
      QueueName: RESOURCE_NAMES.reminderDlq,
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 1209600,
    });
  });

  it("does not give the DLQ its own redrive policy", () => {
    const queues = createTemplate().findResources("AWS::SQS::Queue", {
      Properties: { QueueName: RESOURCE_NAMES.reminderDlq },
    });
    const dlq = Object.values(queues)[0] as CfnResource;
    expect(dlq.Properties?.RedrivePolicy).toBeUndefined();
  });

  it("attaches an SSL-only deny policy to both queues", () => {
    const template = createTemplate();
    for (const queueName of [RESOURCE_NAMES.reminderQueue, RESOURCE_NAMES.reminderDlq]) {
      const queueId = logicalIdOf("AWS::SQS::Queue", { QueueName: queueName });
      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        Queues: [{ Ref: queueId }],
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Action: "sqs:*",
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            }),
          ]),
        },
      });
    }
  });
});

describe("C6 alarm topic", () => {
  it("leaves the topic unencrypted so CloudWatch can publish (decision D4)", () => {
    const template = createTemplate();
    const topics = template.findResources("AWS::SNS::Topic", {
      Properties: { TopicName: RESOURCE_NAMES.alarmTopic },
    });
    const topic = Object.values(topics)[0] as CfnResource;
    // CloudWatch cannot publish to a topic encrypted with the AWS-managed SNS key.
    expect(topic.Properties?.KmsMasterKeyId).toBeUndefined();
    template.resourceCountIs("AWS::KMS::Key", 0);
  });

  it("documents the SNS2 encryption waiver with owner and review date", () => {
    const topics = createTemplate().findResources("AWS::SNS::Topic", {
      Properties: { TopicName: RESOURCE_NAMES.alarmTopic },
    });
    const topic = Object.values(topics)[0] as CfnResource & {
      Metadata?: { cdk_nag?: { rules_to_suppress?: { id: string; reason: string }[] } };
    };
    const waivers = topic.Metadata?.cdk_nag?.rules_to_suppress ?? [];
    expect(waivers.map(({ id }) => id)).toEqual(["AwsSolutions-SNS2"]);
    expect(waivers[0]?.reason).toMatch(/Owner: project maintainer\. Review by 2027-01-03\./);
  });

  it("attaches an SSL-only deny policy to the topic", () => {
    const topicId = logicalIdOf("AWS::SNS::Topic", { TopicName: RESOURCE_NAMES.alarmTopic });
    createTemplate().hasResourceProperties("AWS::SNS::TopicPolicy", {
      Topics: [{ Ref: topicId }],
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("has no subscriptions (no email confirmation needed in the final sandbox)", () => {
    createTemplate().resourceCountIs("AWS::SNS::Subscription", 0);
  });
});

describe("C6 alarms (C-08, NFR8, NFR22)", () => {
  const apiDimensions = (): { Name: string; Value: unknown }[] => [
    { Name: "ApiId", Value: apiIdParameterRef() },
    { Name: "Stage", Value: "$default" },
  ];

  it("reads the HTTP API id from SSM at deploy time instead of a cross-stack import (D5)", () => {
    const template = createTemplate();
    expect(apiIdParameterRef().Ref).toBeTruthy();
    expect(JSON.stringify(template.toJSON())).not.toContain("Fn::ImportValue");
  });
  const common = {
    ComparisonOperator: "GreaterThanOrEqualToThreshold",
    TreatMissingData: "notBreaching",
    Period: 300,
  };

  function topicRef(): { Ref: string } {
    return { Ref: logicalIdOf("AWS::SNS::Topic", { TopicName: RESOURCE_NAMES.alarmTopic }) };
  }

  it("creates exactly the seven approved alarms, each notifying the alarm topic", () => {
    const alarms = Object.values(
      createTemplate().findResources("AWS::CloudWatch::Alarm"),
    ) as CfnResource[];
    expect(alarms.map((alarm) => alarm.Properties?.AlarmName).sort()).toEqual(
      Object.values(ALARM_NAMES).sort(),
    );
    for (const alarm of alarms) {
      expect(alarm.Properties?.AlarmActions).toEqual([topicRef()]);
      expect(alarm.Properties).toMatchObject(common);
    }
  });

  it("alarms on HTTP API 5xx Sum >= 1 for the foundation API $default stage", () => {
    createTemplate().hasResourceProperties("AWS::CloudWatch::Alarm", {
      ...common,
      AlarmName: ALARM_NAMES.api5xx,
      Namespace: "AWS/ApiGateway",
      MetricName: "5xx",
      Dimensions: apiDimensions(),
      Statistic: "Sum",
      Threshold: 1,
      EvaluationPeriods: 1,
    });
  });

  it("alarms on HTTP API p95 latency >= 1000 ms over three periods (NFR8)", () => {
    createTemplate().hasResourceProperties("AWS::CloudWatch::Alarm", {
      ...common,
      AlarmName: ALARM_NAMES.apiLatencyP95,
      Namespace: "AWS/ApiGateway",
      MetricName: "Latency",
      Dimensions: apiDimensions(),
      ExtendedStatistic: "p95",
      Threshold: 1000,
      EvaluationPeriods: 3,
    });
  });

  it("alarms on region-wide Lambda Errors and Throttles Sum >= 1 without dimensions", () => {
    const template = createTemplate();
    for (const [alarmName, metricName] of [
      [ALARM_NAMES.lambdaErrors, "Errors"],
      [ALARM_NAMES.lambdaThrottles, "Throttles"],
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        ...common,
        AlarmName: alarmName,
        Namespace: "AWS/Lambda",
        MetricName: metricName,
        Dimensions: Match.absent(),
        Statistic: "Sum",
        Threshold: 1,
      });
    }
  });

  it("alarms when the reminder DLQ holds at least one visible message", () => {
    const dlqId = logicalIdOf("AWS::SQS::Queue", { QueueName: RESOURCE_NAMES.reminderDlq });
    createTemplate().hasResourceProperties("AWS::CloudWatch::Alarm", {
      ...common,
      AlarmName: ALARM_NAMES.reminderDlqMessages,
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Dimensions: [{ Name: "QueueName", Value: { "Fn::GetAtt": [dlqId, "QueueName"] } }],
      Statistic: "Maximum",
      Threshold: 1,
    });
  });

  it("alarms on the 401 and 403 access-log metrics", () => {
    const template = createTemplate();
    for (const [alarmName, metricName] of [
      [ALARM_NAMES.authFailures, "AuthFailures"],
      [ALARM_NAMES.deniedAdminActions, "DeniedAdminActions"],
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        ...common,
        AlarmName: alarmName,
        Namespace: "team32-ceb",
        MetricName: metricName,
        Statistic: "Sum",
        Threshold: 1,
      });
    }
  });
});

describe("C6 access-log metric filters (NFR22)", () => {
  it("counts 401 and 403 responses from the HTTP API access log", () => {
    const template = createTemplate();
    template.resourceCountIs("AWS::Logs::MetricFilter", 2);
    for (const [status, metricName] of [
      ["401", "AuthFailures"],
      ["403", "DeniedAdminActions"],
    ]) {
      template.hasResourceProperties("AWS::Logs::MetricFilter", {
        LogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
        FilterPattern: `{ $.status = "${status}" }`,
        MetricTransformations: [
          {
            MetricNamespace: "team32-ceb",
            MetricName: metricName,
            MetricValue: "1",
            DefaultValue: 0,
          },
        ],
      });
    }
  });

  it("does not create or own the access log group (the foundation owns it)", () => {
    createTemplate().resourceCountIs("AWS::Logs::LogGroup", 0);
  });
});

describe("C6 outputs (C-01)", () => {
  it("publishes exactly ReminderQueueUrl and AlarmTopicArn", () => {
    const outputs = createTemplate().toJSON().Outputs as Record<string, unknown>;
    expect(Object.keys(outputs).sort()).toEqual([...C6_OUTPUT_KEYS].sort());
  });

  it("points the outputs at the reminder queue and alarm topic", () => {
    const template = createTemplate();
    const queueId = logicalIdOf("AWS::SQS::Queue", { QueueName: RESOURCE_NAMES.reminderQueue });
    const topicId = logicalIdOf("AWS::SNS::Topic", { TopicName: RESOURCE_NAMES.alarmTopic });
    template.hasOutput("ReminderQueueUrl", { Value: { Ref: queueId } });
    template.hasOutput("AlarmTopicArn", { Value: { Ref: topicId } });
  });
});

describe("C6 naming and tagging", () => {
  it("tags every taggable resource with project=team32-ceb", () => {
    const resources = createTemplate().toJSON().Resources as Record<string, CfnResource>;
    const taggable = Object.entries(resources).filter(
      ([, resource]) => resource.Properties && "Tags" in resource.Properties,
    );
    expect(taggable.length).toBeGreaterThanOrEqual(3);
    for (const [logicalId, resource] of taggable) {
      expect(resource.Properties?.Tags, logicalId).toEqual(
        expect.arrayContaining([{ Key: "project", Value: "team32-ceb" }]),
      );
    }
    for (const type of ["AWS::SQS::Queue", "AWS::SNS::Topic", "AWS::CloudWatch::Alarm"]) {
      for (const [logicalId, resource] of Object.entries(resources)) {
        if (resource.Type === type) {
          expect(resource.Properties?.Tags, logicalId).toBeDefined();
        }
      }
    }
  });

  it("prefixes every named resource with team32-ceb-", () => {
    const resources = createTemplate().toJSON().Resources as Record<string, CfnResource>;
    const nameKeys = [
      "QueueName",
      "TopicName",
      "AlarmName",
      "RoleName",
      "Name",
      "FilterName",
      "LogGroupName",
    ];
    const names = Object.values(resources).flatMap((resource) =>
      nameKeys
        .map((key) => resource.Properties?.[key])
        .filter((value): value is string => typeof value === "string"),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.startsWith("team32-ceb-")).toBe(true);
    }
  });
});

describe("C6 stack input validation", () => {
  it("rejects an empty HTTP API id parameter name", () => {
    const app = new App();
    expect(
      () =>
        new AsyncMonitoringStack(app, "team32-ceb-invalid-api", {
          httpApiIdParameterName: " ",
          apiAccessLogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
        }),
    ).toThrow(/non-empty httpApiIdParameterName/);
  });

  it("rejects an empty access log group name", () => {
    const app = new App();
    expect(
      () =>
        new AsyncMonitoringStack(app, "team32-ceb-invalid-log", {
          httpApiIdParameterName: TEST_API_ID_PARAMETER,
          apiAccessLogGroupName: "",
        }),
    ).toThrow(/non-empty apiAccessLogGroupName/);
  });
});
