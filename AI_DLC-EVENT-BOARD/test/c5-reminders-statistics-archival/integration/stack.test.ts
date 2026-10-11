import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { beforeAll, describe, expect, it } from "vitest";
import { ReminderFunctions } from "../../../src/infrastructure/async-monitoring/reminder-functions.js";
import { RESOURCE_NAMES } from "../../../src/infrastructure/async-monitoring/settings.js";
import { SES_CONTEXT, synthWiredApp, type WiredApp } from "../support/app.js";

type Resource = { Properties: Record<string, unknown> };

const C5_FUNCTIONS = {
  "team32-ceb-admin-stats": "foundation",
  "team32-ceb-archival": "foundation",
  "team32-ceb-reminder-selector": "asyncMonitoring",
  "team32-ceb-reminder-worker": "asyncMonitoring",
} as const;

let wired: WiredApp;
let foundation: Template;
let asyncMonitoring: Template;

function resources(template: Template, type: string): [string, Resource][] {
  return Object.entries(template.findResources(type)) as [string, Resource][];
}

function functionId(template: Template, name: string): string {
  const match = resources(template, "AWS::Lambda::Function").find(
    ([, resource]) => resource.Properties.FunctionName === name,
  );
  if (!match) throw new Error(`No function named ${name}.`);
  return match[0];
}

function policyText(template: Template, functionName: string): string {
  const roleId = (
    resources(template, "AWS::Lambda::Function").find(
      ([, resource]) => resource.Properties.FunctionName === functionName,
    )?.[1].Properties.Role as { "Fn::GetAtt": [string, string] }
  )["Fn::GetAtt"][0];
  const policies = resources(template, "AWS::IAM::Policy").filter(([, policy]) =>
    (policy.Properties.Roles as { Ref: string }[]).some((role) => role.Ref === roleId),
  );
  return JSON.stringify(policies.map(([, policy]) => policy.Properties.PolicyDocument));
}

beforeAll(() => {
  wired = synthWiredApp();
  foundation = Template.fromStack(wired.foundation);
  asyncMonitoring = Template.fromStack(wired.asyncMonitoring);
});

describe("C5 functions (NFR3, NFR5, NFR31)", () => {
  it("runs the four C5 functions on Node.js 22.x in the Q1 A stacks with 14-day log groups", () => {
    for (const [name, stack] of Object.entries(C5_FUNCTIONS)) {
      const template = stack === "foundation" ? foundation : asyncMonitoring;
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: name,
        Runtime: "nodejs22.x",
        LoggingConfig: { LogGroup: Match.anyValue() },
      });
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: name,
        RetentionInDays: 14,
      });
      template.hasResourceProperties("AWS::IAM::Role", { RoleName: `${name}-runtime` });
    }
  });

  it("tags C5 resources with project=team32-ceb", () => {
    for (const template of [foundation, asyncMonitoring]) {
      const tagged = resources(template, "AWS::Lambda::Function").filter(([, resource]) =>
        String(resource.Properties.FunctionName).startsWith("team32-ceb-"),
      );
      expect(tagged.length).toBeGreaterThan(0);
      for (const [, resource] of tagged) {
        expect(resource.Properties.Tags).toEqual(
          expect.arrayContaining([{ Key: "project", Value: "team32-ceb" }]),
        );
      }
    }
  });
});

describe("statistics route (C-02, FR8.1, FR8.3)", () => {
  it("attaches GET /api/admin/stats to the C1 JWT authorizer", () => {
    const authorizerId = Object.keys(foundation.findResources("AWS::ApiGatewayV2::Authorizer"))[0];
    foundation.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /api/admin/stats",
      AuthorizationType: "JWT",
      AuthorizerId: { Ref: authorizerId },
    });
    foundation.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 1);
  });

  it("limits the statistics role to Query on GSI7", () => {
    const text = policyText(foundation, "team32-ceb-admin-stats");
    expect(text).toContain("/index/GSI7");
    expect(text).not.toMatch(/GSI[1-6]|PutItem|UpdateItem|DeleteItem|GetItem|s3:|sqs:/);
  });
});

describe("archival (C-06, FR9.3)", () => {
  it("runs the archival function daily with the scheduled mode", () => {
    const archivalId = functionId(foundation, "team32-ceb-archival");
    foundation.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "team32-ceb-archival-daily",
      ScheduleExpression: "rate(1 day)",
      State: "ENABLED",
      Target: Match.objectLike({
        Arn: { "Fn::GetAtt": [archivalId, "Arn"] },
        Input: '{"mode":"scheduled"}',
      }),
    });
    foundation.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "team32-ceb-archival-scheduler",
    });
  });

  it("bounds archival IAM to EVENT# partitions, GSI7, and archive/*", () => {
    const text = policyText(foundation, "team32-ceb-archival");
    expect(text).toContain('"dynamodb:LeadingKeys":["EVENT#*"]');
    expect(text).toContain("/archive/*");
    expect(text).toContain("s3:PutObject");
    expect(text).not.toMatch(/s3:GetObject|s3:DeleteObject|BatchWriteItem|dynamodb:Scan|"\*"/);
  });

  it("exposes exactly the C-01 output sets on both stacks", () => {
    expect(Object.keys(foundation.toJSON().Outputs as object).sort()).toEqual([
      "ApiBaseUrl",
      "ArchiveBucketName",
      "ArchiveFunctionName",
      "BannerBucketName",
      "DemoCredentialsSecretArn",
      "DistributionId",
      "Region",
      "SiteUrl",
      "TableName",
      "UserPoolClientId",
      "UserPoolId",
      "WebBucketName",
    ]);
    foundation.hasOutput("ArchiveFunctionName", {
      Value: { Ref: functionId(foundation, "team32-ceb-archival") },
    });
    expect(Object.keys(asyncMonitoring.toJSON().Outputs as object).sort()).toEqual([
      "AlarmTopicArn",
      "ReminderQueueUrl",
    ]);
  });
});

describe("reminders (FR7.2, FR7.4, FR7.5, C-05)", () => {
  it("attaches the selector to the C6 15-minute schedule", () => {
    asyncMonitoring.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: RESOURCE_NAMES.reminderSchedule,
      ScheduleExpression: "rate(15 minutes)",
      Target: Match.objectLike({
        Arn: { "Fn::GetAtt": [functionId(asyncMonitoring, "team32-ceb-reminder-selector"), "Arn"] },
      }),
    });
  });

  it("consumes the DLQ-backed reminder queue with partial batch responses", () => {
    const queueId = Object.entries(asyncMonitoring.findResources("AWS::SQS::Queue")).find(
      ([, queue]) => (queue as Resource).Properties.QueueName === RESOURCE_NAMES.reminderQueue,
    )?.[0];
    expect(queueId).toBeDefined();
    asyncMonitoring.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: RESOURCE_NAMES.reminderQueue,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
    asyncMonitoring.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      EventSourceArn: { "Fn::GetAtt": [queueId, "Arn"] },
      FunctionName: { Ref: functionId(asyncMonitoring, "team32-ceb-reminder-worker") },
      BatchSize: 10,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("defaults to EMAIL_MODE=log with no SES permission", () => {
    asyncMonitoring.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "team32-ceb-reminder-worker",
      Environment: { Variables: { TABLE_NAME: "team32-ceb-events", EMAIL_MODE: "log" } },
    });
    expect(JSON.stringify(asyncMonitoring.toJSON())).not.toContain("ses:");
    expect(wired.reminders.emailMode).toBe("log");
  });

  it("reaches the foundation table by name without any cross-stack export", () => {
    const selectorText = policyText(asyncMonitoring, "team32-ceb-reminder-selector");
    expect(selectorText).toContain("table/team32-ceb-events");
    expect(selectorText).toContain('"dynamodb:LeadingKeys":["REMINDER#*"]');
    expect(selectorText).toContain("sqs:SendMessage");
    expect(selectorText).toMatch(/\/index\/GSI5.*\/index\/GSI7/);
    const workerText = policyText(asyncMonitoring, "team32-ceb-reminder-worker");
    expect(workerText).toContain('["EVENT#*","REMINDER#*"]');
    expect(workerText).not.toMatch(/PutItem|DeleteItem|sqs:SendMessage/);
    expect(
      Object.keys(foundation.findOutputs("*")).some((key) => key.startsWith("ExportsOutput")),
    ).toBe(false);
    expect(JSON.stringify(asyncMonitoring.toJSON())).not.toContain("Fn::ImportValue");
  });

  it("grants ses:SendEmail on the sender identity only when synthesized for SES", () => {
    const ses = synthWiredApp(SES_CONTEXT);
    const template = Template.fromStack(ses.asyncMonitoring);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "team32-ceb-reminder-worker",
      Environment: {
        Variables: Match.objectLike({
          EMAIL_MODE: "ses",
          REMINDER_SENDER_EMAIL: "sender@example.com",
        }),
      },
    });
    const text = policyText(template, "team32-ceb-reminder-worker");
    expect(text).toContain('"Action":"ses:SendEmail"');
    expect(text).toContain(`"Resource":"${SES_CONTEXT.reminderSenderIdentityArn}"`);
  });

  it.each([
    [{ reminderEmailMode: "smtp" }, /log` or `ses/],
    [{ reminderEmailMode: "ses" }, /reminderSenderEmail/],
    [
      { reminderEmailMode: "ses", reminderSenderEmail: "sender@example.com" },
      /reminderSenderIdentityArn/,
    ],
  ])("rejects an incomplete email context %j at synthesis", (context, message) => {
    const app = new App({ context });
    const stack = new Stack(app, "team32-ceb-context-check", { env: { region: "us-east-1" } });
    const queue = new sqs.Queue(stack, "Queue");
    expect(() => new ReminderFunctions(stack, "ReminderFunctions", { queue })).toThrow(message);
  });
});
