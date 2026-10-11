import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { describe, expect, it } from "vitest";
import { AsyncMonitoringStack } from "../../../src/infrastructure/async-monitoring/async-monitoring-stack.js";
import { RESOURCE_NAMES } from "../../../src/infrastructure/async-monitoring/settings.js";

type PolicyStatement = { Effect: string; Action: unknown; Resource: unknown };

function createStack(): { stack: AsyncMonitoringStack; selector: lambda.Function } {
  const app = new App();
  const stack = new AsyncMonitoringStack(app, RESOURCE_NAMES.stack, {
    env: { region: "us-east-1" },
    httpApiIdParameterName: "team32-ceb-http-api-id",
    apiAccessLogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
  });
  // Throwaway selector for template assertions only; nothing is deployed.
  const selector = new lambda.Function(stack, "TestReminderSelector", {
    functionName: "team32-ceb-test-reminder-selector",
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => ({});"),
  });
  return { stack, selector };
}

function selectorArnRef(stack: AsyncMonitoringStack, selector: lambda.Function): unknown {
  return stack.resolve(selector.functionArn);
}

describe("C6 reminder schedule before a selector is attached", () => {
  it("creates no schedule and no scheduler role", () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Scheduler::Schedule", 0);
    template.resourceCountIs("AWS::IAM::Role", 1); // only the test selector's own role
    template.resourcePropertiesCountIs(
      "AWS::IAM::Role",
      { RoleName: RESOURCE_NAMES.schedulerRole },
      0,
    );
  });
});

describe("C6 reminder schedule after attachReminderSelector", () => {
  it("creates the 15-minute enabled schedule targeting the selector with 3 retries", () => {
    const { stack, selector } = createStack();
    stack.attachReminderSelector(selector);
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: RESOURCE_NAMES.reminderSchedule,
      ScheduleExpression: "rate(15 minutes)",
      State: "ENABLED",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: selectorArnRef(stack, selector),
        RetryPolicy: { MaximumRetryAttempts: 3 },
      },
    });
  });

  it("uses the scheduler role as the schedule's execution role", () => {
    const { stack, selector } = createStack();
    stack.attachReminderSelector(selector);
    const template = Template.fromStack(stack);
    const roleIds = Object.keys(
      template.findResources("AWS::IAM::Role", {
        Properties: { RoleName: RESOURCE_NAMES.schedulerRole },
      }),
    );
    expect(roleIds).toHaveLength(1);
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Target: { RoleArn: { "Fn::GetAtt": [roleIds[0], "Arn"] } },
    });
  });

  it("trusts only scheduler.amazonaws.com from this account", () => {
    const { stack, selector } = createStack();
    stack.attachReminderSelector(selector);
    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
      RoleName: RESOURCE_NAMES.schedulerRole,
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: "sts:AssumeRole",
            Principal: { Service: "scheduler.amazonaws.com" },
            Condition: { StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } } },
          },
        ],
      },
    });
  });

  it("allows only lambda:InvokeFunction on the selector ARN, with no wildcard", () => {
    const { stack, selector } = createStack();
    stack.attachReminderSelector(selector);
    const template = Template.fromStack(stack);
    const roleId = Object.keys(
      template.findResources("AWS::IAM::Role", {
        Properties: { RoleName: RESOURCE_NAMES.schedulerRole },
      }),
    )[0];
    const policies = Object.values(
      template.findResources("AWS::IAM::Policy", {
        Properties: { Roles: [{ Ref: roleId }] },
      }),
    ) as { Properties: { PolicyDocument: { Statement: PolicyStatement[] } } }[];
    expect(policies).toHaveLength(1);
    const statements = policies[0].Properties.PolicyDocument.Statement;
    expect(statements).toEqual([
      {
        Effect: "Allow",
        Action: "lambda:InvokeFunction",
        Resource: selectorArnRef(stack, selector),
      },
    ]);
    expect(JSON.stringify(statements)).not.toContain("*");
    template.hasResourceProperties("AWS::IAM::Policy", {
      Roles: [{ Ref: roleId }],
      PolicyDocument: {
        Statement: Match.not(Match.arrayWith([Match.objectLike({ Action: "*" })])),
      },
    });
  });

  it("refuses a second selector with a clear error", () => {
    const { stack, selector } = createStack();
    stack.attachReminderSelector(selector);
    expect(() => stack.attachReminderSelector(selector)).toThrow(
      /reminder selector is already attached/,
    );
    Template.fromStack(stack).resourceCountIs("AWS::Scheduler::Schedule", 1);
  });
});
