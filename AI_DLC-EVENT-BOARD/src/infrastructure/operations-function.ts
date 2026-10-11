import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";

/** C5 functions keep Onur as the documented owner (Q1 clarification). */
export const C5_REVIEW = "Owner: Onur. Review by 2027-01-03.";

export interface OperationsFunctionSpec {
  /** Construct id prefix; the log group id ends in `Logs` for the nag regex. */
  id: string;
  /** Physical function, log group, and (with `-runtime`) role name. */
  name: string;
  entry: string;
  description: string;
  environment: Record<string, string>;
  timeout?: Duration;
  memorySize?: number;
  /** Extra IAM5 justifications for resource patterns beyond the log stream. */
  extraWildcardJustification?: { reason: string; patterns: RegExp[] };
}

/**
 * NFR3/NFR5/NFR11/NFR31: a Node.js 22.x function with its own
 * least-privilege role and its own 14-day `team32-ceb-<fn>` log group.
 */
export function createOperationsFunction(
  scope: Construct,
  spec: OperationsFunctionSpec,
): nodejs.NodejsFunction {
  const logGroup = new logs.LogGroup(scope, `${spec.id}Logs`, {
    logGroupName: spec.name,
    retention: logs.RetentionDays.TWO_WEEKS,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const role = new iam.Role(scope, `${spec.id}RuntimeRole`, {
    roleName: `${spec.name}-runtime`,
    assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    description: `Runtime role for ${spec.name}.`,
  });
  logGroup.grantWrite(role);
  const fn = new nodejs.NodejsFunction(scope, `${spec.id}Function`, {
    functionName: spec.name,
    description: spec.description,
    entry: spec.entry,
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_22_X,
    timeout: spec.timeout ?? Duration.seconds(30),
    memorySize: spec.memorySize ?? 256,
    role,
    logGroup,
    bundling: {
      minify: true,
      sourceMap: false,
      // Bundle the pinned AWS SDK v3 clients instead of the runtime-provided ones.
      externalModules: [],
    },
    environment: spec.environment,
  });
  NagSuppressions.addResourceSuppressions(
    fn,
    [
      {
        id: "AwsSolutions-L1",
        reason: `Node.js 22.x is explicitly locked by the approved runtime contract (NFR3). Re-evaluate before AWS deprecation. ${C5_REVIEW}`,
      },
    ],
    true,
  );
  const extra = spec.extraWildcardJustification;
  NagSuppressions.addResourceSuppressions(
    role,
    [
      {
        id: "AwsSolutions-IAM5",
        reason: `CloudWatch Logs requires the log-stream wildcard for Lambda writes; it is bounded to the single ${spec.name} log group.${extra ? ` ${extra.reason}` : ""} ${C5_REVIEW}`,
        appliesTo: [
          { regex: "/^Resource::<.*Logs[A-F0-9]+\\.Arn>:\\*$/g" },
          ...(extra?.patterns ?? []).map((pattern) => ({ regex: String(pattern) })),
        ],
      },
    ],
    true,
  );
  return fn;
}

/**
 * Item-level DynamoDB actions limited by `dynamodb:LeadingKeys` to partition
 * keys with the given prefixes (for example `EVENT#*`). The table ARN itself
 * carries no wildcard.
 */
export function allowItems(
  fn: lambda.IFunction,
  actions: string[],
  tableArn: string,
  leadingKeyPatterns: string[],
): void {
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions,
      resources: [tableArn],
      conditions: {
        "ForAllValues:StringLike": { "dynamodb:LeadingKeys": leadingKeyPatterns },
      },
    }),
  );
}

/** Query on the named GSIs only. */
export function allowIndexQuery(fn: lambda.IFunction, tableArn: string, indexes: string[]): void {
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ["dynamodb:Query"],
      resources: indexes.map((index) => `${tableArn}/index/${index}`),
    }),
  );
}
