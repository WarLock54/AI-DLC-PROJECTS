import { App, Aspects, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { describe, expect, it } from "vitest";
import { LogRetentionAspect } from "../../../src/infrastructure/async-monitoring/log-retention-aspect.js";

type StackBuilder = (stack: Stack) => void;

function retentionErrors(build: StackBuilder): string[] {
  const app = new App();
  const stack = new Stack(app, "team32-ceb-log-retention-test", { env: { region: "us-east-1" } });
  build(stack);
  Aspects.of(app).add(new LogRetentionAspect());
  app.synth();
  return Annotations.fromStack(stack)
    .findError("*", Match.stringLikeRegexp("\\[LogRetention\\].*"))
    .map(({ entry }) => String(entry.data));
}

function inlineFunction(stack: Stack, props: Partial<lambda.FunctionProps> = {}): lambda.Function {
  return new lambda.Function(stack, "Fn", {
    functionName: "team32-ceb-log-retention-fn",
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => ({});"),
    ...props,
  });
}

describe("LogRetentionAspect log groups", () => {
  it("accepts a log group with 14-day retention", () => {
    expect(
      retentionErrors((stack) => {
        new logs.LogGroup(stack, "Logs", { retention: logs.RetentionDays.TWO_WEEKS });
      }),
    ).toEqual([]);
  });

  it("reports a log group with another retention", () => {
    const errors = retentionErrors((stack) => {
      new logs.LogGroup(stack, "Logs", { retention: logs.RetentionDays.ONE_WEEK });
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("must be 14 days");
    expect(errors[0]).toContain("found: 7");
  });

  it("reports a log group that never expires", () => {
    const errors = retentionErrors((stack) => {
      new logs.LogGroup(stack, "Logs", { retention: logs.RetentionDays.INFINITE });
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("found: never expire");
  });

  it("reports a raw CfnLogGroup with no retention", () => {
    const errors = retentionErrors((stack) => {
      new logs.CfnLogGroup(stack, "RawLogs", {});
    });
    expect(errors).toHaveLength(1);
  });
});

describe("LogRetentionAspect Lambda functions", () => {
  it("accepts a function with an explicit 14-day log group", () => {
    expect(
      retentionErrors((stack) => {
        const logGroup = new logs.LogGroup(stack, "FnLogs", {
          retention: logs.RetentionDays.TWO_WEEKS,
        });
        inlineFunction(stack, { logGroup });
      }),
    ).toEqual([]);
  });

  it("reports a function without an explicit log group", () => {
    const errors = retentionErrors((stack) => {
      inlineFunction(stack);
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("explicit LoggingConfig.LogGroup");
  });

  it("reports a function whose explicit log group has the wrong retention", () => {
    const errors = retentionErrors((stack) => {
      const logGroup = new logs.LogGroup(stack, "FnLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
      });
      inlineFunction(stack, { logGroup });
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("found: 30");
  });

  it("reports a function with a logging config that has no log group", () => {
    const errors = retentionErrors((stack) => {
      inlineFunction(stack, { loggingFormat: lambda.LoggingFormat.JSON });
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("explicit LoggingConfig.LogGroup");
  });
});
