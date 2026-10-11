import { Aws, Duration } from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import { allowIndexQuery, allowItems, createOperationsFunction } from "./operations-function.js";

export interface StatisticsAndArchivalProps {
  /** C1's shared HTTP API. */
  httpApi: apigatewayv2.HttpApi;
  /** C1's Cognito JWT authorizer; reused, never replaced. */
  jwtAuthorizer: apigatewayv2.CfnAuthorizer;
  table: dynamodb.ITable;
  archiveBucket: s3.IBucket;
}

/** C5 resource names (all carry the mandatory `team32-ceb-` prefix). */
export const C5_FOUNDATION_NAMES = {
  statsFunction: "team32-ceb-admin-stats",
  archivalFunction: "team32-ceb-archival",
  archivalSchedule: "team32-ceb-archival-daily",
  archivalSchedulerRole: "team32-ceb-archival-scheduler",
} as const;

/** FR9: the daily archival schedule; FR9.3's post-deploy run is the pipeline's. */
export const ARCHIVAL_SCHEDULE_EXPRESSION = "rate(1 day)";

/** Binds a route to C1's existing L1 Cognito JWT authorizer (as C3 does). */
class ExistingJwtAuthorizer implements apigatewayv2.IHttpRouteAuthorizer {
  constructor(private readonly authorizer: apigatewayv2.CfnAuthorizer) {}

  bind(): apigatewayv2.HttpRouteAuthorizerConfig {
    return { authorizationType: "JWT", authorizerId: this.authorizer.ref };
  }
}

/**
 * C5 resources that depend on foundation-owned table, archive bucket, HTTP API,
 * and authorizer (Q1 A): the admin statistics function and its JWT route, the
 * archival function, and its daily EventBridge Scheduler schedule.
 */
export class StatisticsAndArchival extends Construct {
  public readonly statsFunction: nodejs.NodejsFunction;
  public readonly archivalFunction: nodejs.NodejsFunction;
  public readonly archivalSchedule: scheduler.CfnSchedule;

  constructor(scope: Construct, id: string, props: StatisticsAndArchivalProps) {
    super(scope, id);
    const { table, archiveBucket } = props;

    this.statsFunction = createOperationsFunction(this, {
      id: "AdminStats",
      name: C5_FOUNDATION_NAMES.statsFunction,
      entry: "src/lambda/admin-stats/handler.ts",
      description: "Admin-only statistics (GET /api/admin/stats).",
      environment: { TABLE_NAME: table.tableName },
      timeout: Duration.seconds(10),
    });
    // Statistics read active Event META and EventView counts through GSI7 only.
    allowIndexQuery(this.statsFunction, table.tableArn, ["GSI7"]);

    this.archivalFunction = createOperationsFunction(this, {
      id: "Archival",
      name: C5_FOUNDATION_NAMES.archivalFunction,
      entry: "src/lambda/archival/handler.ts",
      description: "Archives events older than one year to S3 (C-06, C-07 v1).",
      environment: { TABLE_NAME: table.tableName, ARCHIVE_BUCKET_NAME: archiveBucket.bucketName },
      timeout: Duration.minutes(5),
      extraWildcardJustification: {
        reason:
          "The archive/* object prefix bounds archival writes to the C-07 key space of the archive bucket.",
        patterns: [/^Resource::<.*ArchiveBucket[A-F0-9]+\.Arn>\/archive\/\*$/g],
      },
    });
    // Freeze, registration read/delete, and the marker + META finalize
    // transaction, all limited to EVENT#{eventId} partitions.
    allowItems(
      this.archivalFunction,
      [
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:Query",
      ],
      table.tableArn,
      ["EVENT#*"],
    );
    allowIndexQuery(this.archivalFunction, table.tableArn, ["GSI7"]);
    this.archivalFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [archiveBucket.arnForObjects("archive/*")],
      }),
    );

    this.addStatsRoute(props);
    this.archivalSchedule = this.createArchivalSchedule();
  }

  private addStatsRoute(props: StatisticsAndArchivalProps): void {
    props.httpApi.addRoutes({
      path: "/api/admin/stats",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "AdminStatsIntegration",
        this.statsFunction,
      ),
      authorizer: new ExistingJwtAuthorizer(props.jwtAuthorizer),
    });
  }

  private createArchivalSchedule(): scheduler.CfnSchedule {
    const role = new iam.Role(this, "ArchivalSchedulerRole", {
      roleName: C5_FOUNDATION_NAMES.archivalSchedulerRole,
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID } },
      }),
      description: "Lets EventBridge Scheduler invoke only the C5 archival function.",
    });
    // Explicit statement instead of grantInvoke, which would also allow `<arn>:*`.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [this.archivalFunction.functionArn],
      }),
    );
    return new scheduler.CfnSchedule(this, "ArchivalDailySchedule", {
      name: C5_FOUNDATION_NAMES.archivalSchedule,
      description: "Runs the C5 archival function once a day (FR9.1, C-06 scheduled mode).",
      scheduleExpression: ARCHIVAL_SCHEDULE_EXPRESSION,
      flexibleTimeWindow: { mode: "OFF" },
      state: "ENABLED",
      target: {
        arn: this.archivalFunction.functionArn,
        roleArn: role.roleArn,
        input: JSON.stringify({ mode: "scheduled" }),
        retryPolicy: { maximumRetryAttempts: 2 },
      },
    });
  }
}
