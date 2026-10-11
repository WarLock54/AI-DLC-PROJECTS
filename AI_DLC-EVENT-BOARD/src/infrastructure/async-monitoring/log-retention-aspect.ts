import { Annotations, type IAspect, Stack } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { IConstruct } from "constructs";
import { LOG_RETENTION_DAYS } from "./settings.js";

/**
 * NFR31: enforces explicit 14-day log retention across the whole CDK app.
 *
 * Apply it to the app (`Aspects.of(app).add(new LogRetentionAspect())`). It adds
 * an error annotation, which makes `cdk synth` fail, for:
 *
 * - any `AWS::Logs::LogGroup` whose `RetentionInDays` is not exactly 14
 *   (including a missing value, which means "never expire"); and
 * - any `AWS::Lambda::Function` without an explicit `LoggingConfig.LogGroup`,
 *   because the implicit `/aws/lambda/<name>` group Lambda creates on first
 *   invocation never expires and is outside IaC.
 *
 * Fix a finding by giving the function its own `logs.LogGroup` with
 * `retention: logs.RetentionDays.TWO_WEEKS` and passing it as `logGroup`.
 */
export class LogRetentionAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof logs.CfnLogGroup) {
      this.checkLogGroup(node);
    } else if (node instanceof lambda.CfnFunction) {
      this.checkFunction(node);
    }
  }

  private checkLogGroup(logGroup: logs.CfnLogGroup): void {
    const retention: unknown = Stack.of(logGroup).resolve(logGroup.retentionInDays);
    if (retention !== LOG_RETENTION_DAYS) {
      const actual = retention === undefined ? "never expire" : String(retention);
      Annotations.of(logGroup).addError(
        `[LogRetention] Log group retention must be ${LOG_RETENTION_DAYS} days (NFR31); found: ${actual}.`,
      );
    }
  }

  private checkFunction(fn: lambda.CfnFunction): void {
    const loggingConfig: unknown = Stack.of(fn).resolve(fn.loggingConfig);
    const logGroup =
      loggingConfig && typeof loggingConfig === "object"
        ? (loggingConfig as { logGroup?: unknown }).logGroup
        : undefined;
    if (logGroup === undefined || logGroup === null || logGroup === "") {
      Annotations.of(fn).addError(
        `[LogRetention] Lambda function must set an explicit LoggingConfig.LogGroup with ${LOG_RETENTION_DAYS}-day retention (NFR31); the implicit log group never expires.`,
      );
    }
  }
}
