import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AsyncMonitoringStack } from "../../../src/infrastructure/async-monitoring/async-monitoring-stack.js";
import {
  C5_REMINDER_NAMES,
  EVENTS_TABLE_NAME,
  ReminderFunctions,
} from "../../../src/infrastructure/async-monitoring/reminder-functions.js";
import { RESOURCE_NAMES } from "../../../src/infrastructure/async-monitoring/settings.js";

// C5 places its reminder selector and worker in this stack (Q1 A). These
// checks keep the C6 module's own coverage scope honest; the full C5 IaC
// contract is in test/c5-reminders-statistics-archival/integration.
function createStack(context: Record<string, string> = {}): {
  stack: AsyncMonitoringStack;
  reminders: ReminderFunctions;
} {
  const app = new App({ context });
  const stack = new AsyncMonitoringStack(app, RESOURCE_NAMES.stack, {
    env: { region: "us-east-1" },
    httpApiIdParameterName: "team32-ceb-http-api-id",
    apiAccessLogGroupName: RESOURCE_NAMES.apiAccessLogGroup,
  });
  const reminders = new ReminderFunctions(stack, "ReminderFunctions", {
    queue: stack.reminderQueue,
  });
  stack.attachReminderSelector(reminders.selector);
  return { stack, reminders };
}

describe("C5 reminder functions in the C6 stack", () => {
  it("wires the selector to the schedule and the worker to the reminder queue", () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: C5_REMINDER_NAMES.selectorFunction,
      Environment: {
        Variables: { TABLE_NAME: EVENTS_TABLE_NAME, REMINDER_QUEUE_URL: Match.anyValue() },
      },
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
    // Both functions bring their own 14-day log groups (NFR31).
    template.resourcePropertiesCountIs("AWS::Logs::LogGroup", { RetentionInDays: 14 }, 2);
  });

  it("defaults to log mode and grants SES only for a complete SES context", () => {
    expect(createStack().reminders.emailMode).toBe("log");
    const { stack, reminders } = createStack({
      reminderEmailMode: "ses",
      reminderSenderEmail: "sender@example.com",
      reminderSenderIdentityArn: "arn:aws:ses:us-east-1:123456789012:identity/example.com",
    });
    expect(reminders.emailMode).toBe("ses");
    expect(JSON.stringify(Template.fromStack(stack).toJSON())).toContain("ses:SendEmail");
  });

  it.each([
    [{ reminderEmailMode: "smtp" }, /log` or `ses/],
    [{ reminderEmailMode: "ses" }, /reminderSenderEmail/],
    [
      { reminderEmailMode: "ses", reminderSenderEmail: "sender@example.com" },
      /reminderSenderIdentityArn/,
    ],
  ])("rejects the email context %j", (context, message) => {
    expect(() => createStack(context)).toThrow(message);
  });
});
