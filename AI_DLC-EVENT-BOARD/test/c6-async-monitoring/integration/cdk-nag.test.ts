import { App, Aspects, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { AwsSolutionsChecks } from "cdk-nag";
import { beforeAll, describe, expect, it } from "vitest";
import { AsyncMonitoringStack } from "../../../src/infrastructure/async-monitoring/async-monitoring-stack.js";
import { LogRetentionAspect } from "../../../src/infrastructure/async-monitoring/log-retention-aspect.js";
import {
  ALARM_NAMES,
  RESOURCE_NAMES,
} from "../../../src/infrastructure/async-monitoring/settings.js";
import {
  FoundationStack,
  HTTP_API_ID_PARAMETER_NAME,
} from "../../../src/infrastructure/foundation-stack.js";

interface WiredApp {
  foundation: FoundationStack;
  asyncMonitoring: AsyncMonitoringStack;
}

// Mirrors src/app.ts: both stacks, cdk-nag AwsSolutions, and the log-retention aspect.
function synthWiredApp(): WiredApp {
  const app = new App();
  const env = { region: "us-east-1" };
  const foundation = new FoundationStack(app, "team32-ceb-foundation", { env });
  const asyncMonitoring = new AsyncMonitoringStack(app, RESOURCE_NAMES.stack, {
    env,
    httpApiIdParameterName: HTTP_API_ID_PARAMETER_NAME,
    apiAccessLogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
  });
  asyncMonitoring.addStackDependency(foundation);
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  Aspects.of(app).add(new LogRetentionAspect());
  app.synth();
  return { foundation, asyncMonitoring };
}

function errorMessages(stack: Stack, pattern: string): string[] {
  return Annotations.fromStack(stack)
    .findError("*", Match.stringLikeRegexp(pattern))
    .map(({ id, entry }) => `${id}: ${String(entry.data)}`);
}

describe("C6 + C1 whole-app synthesis", () => {
  let wired: WiredApp;

  beforeAll(() => {
    wired = synthWiredApp();
  });

  it("has no unsuppressed AwsSolutions errors in either stack", () => {
    expect(errorMessages(wired.foundation, "AwsSolutions-.*")).toEqual([]);
    expect(errorMessages(wired.asyncMonitoring, "AwsSolutions-.*")).toEqual([]);
  });

  it("has no log-retention errors in either stack", () => {
    expect(errorMessages(wired.foundation, "\\[LogRetention\\].*")).toEqual([]);
    expect(errorMessages(wired.asyncMonitoring, "\\[LogRetention\\].*")).toEqual([]);
  });

  it("publishes the HTTP API id as an SSM parameter in the foundation (D5)", () => {
    const foundationTemplate = Template.fromStack(wired.foundation);
    foundationTemplate.hasResourceProperties("AWS::SSM::Parameter", {
      Name: HTTP_API_ID_PARAMETER_NAME,
      Type: "String",
      Value: wired.foundation.resolve(wired.foundation.httpApi.apiId),
    });
  });

  it("creates no cross-stack export between the stacks (D5)", () => {
    const outputs = Object.keys(Template.fromStack(wired.foundation).findOutputs("*"));
    expect(outputs.filter((key) => key.startsWith("ExportsOutput"))).toEqual([]);
    expect(JSON.stringify(Template.fromStack(wired.asyncMonitoring).toJSON())).not.toContain(
      "Fn::ImportValue",
    );
  });

  it("points the API alarms at the API id read from the SSM parameter", () => {
    const template = Template.fromStack(wired.asyncMonitoring);
    const parameterIds = Object.keys(
      template.findParameters("*", {
        Type: "AWS::SSM::Parameter::Value<String>",
        Default: HTTP_API_ID_PARAMETER_NAME,
      }),
    );
    expect(parameterIds).toHaveLength(1);
    for (const alarmName of [ALARM_NAMES.api5xx, ALARM_NAMES.apiLatencyP95]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        Dimensions: Match.arrayWith([{ Name: "ApiId", Value: { Ref: parameterIds[0] } }]),
      });
    }
  });

  it("attaches the metric filters to the foundation's access log group", () => {
    const foundationTemplate = Template.fromStack(wired.foundation);
    foundationTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
      RetentionInDays: 14,
    });
    const filters = Template.fromStack(wired.asyncMonitoring).findResources(
      "AWS::Logs::MetricFilter",
    ) as Record<string, { Properties: { LogGroupName: string } }>;
    expect(Object.values(filters).map((filter) => filter.Properties.LogGroupName)).toEqual([
      RESOURCE_NAMES.apiAccessLogGroup,
      RESOURCE_NAMES.apiAccessLogGroup,
    ]);
  });

  it("deploys the async-monitoring stack after the foundation stack", () => {
    expect(wired.asyncMonitoring.dependencies).toContain(wired.foundation);
  });
});

describe("cdk-nag control case", () => {
  it("reports a deliberately non-compliant queue (no DLQ, no SSL enforcement)", () => {
    const app = new App();
    const stack = new Stack(app, "team32-ceb-nag-control", { env: { region: "us-east-1" } });
    new sqs.Queue(stack, "NonCompliantQueue");
    Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
    app.synth();
    const errors = errorMessages(stack, "AwsSolutions-.*");
    expect(errors.some((message) => message.includes("AwsSolutions-SQS3"))).toBe(true);
    expect(errors.some((message) => message.includes("AwsSolutions-SQS4"))).toBe(true);
  });
});
