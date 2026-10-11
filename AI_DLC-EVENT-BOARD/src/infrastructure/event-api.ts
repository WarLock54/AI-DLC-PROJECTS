import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface EventApiProps {
  /** C1's shared HTTP API. */
  httpApi: apigatewayv2.HttpApi;
  /** C1's Cognito JWT authorizer; reused, never replaced. */
  jwtAuthorizer: apigatewayv2.CfnAuthorizer;
  table: dynamodb.ITable;
  bannerBucket: s3.IBucket;
}

interface FunctionSpec {
  id: string;
  name: string;
  entry: string;
  description: string;
  environment: Record<string, string>;
}

type HttpMethod = apigatewayv2.HttpMethod;

const REVIEW = "Owner: Onur. Review by 2027-01-03.";

/**
 * Binds a route to C1's existing L1 Cognito JWT authorizer. The generated
 * CfnRoute carries AuthorizationType JWT and C1's AuthorizerId, so C1's
 * authorizer is reused rather than replaced (D15).
 */
class ExistingJwtAuthorizer implements apigatewayv2.IHttpRouteAuthorizer {
  constructor(private readonly authorizer: apigatewayv2.CfnAuthorizer) {}

  bind(): apigatewayv2.HttpRouteAuthorizerConfig {
    return { authorizationType: "JWT", authorizerId: this.authorizer.ref };
  }
}

/**
 * C3 Event APIs (D14, D15): three Node.js 22.x functions with dedicated
 * least-privilege roles and 14-day log groups, attached to C1's HTTP API.
 */
export class EventApi extends Construct {
  public readonly publicFunction: nodejs.NodejsFunction;
  public readonly managementFunction: nodejs.NodejsFunction;
  public readonly rsvpFunction: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: EventApiProps) {
    super(scope, id);
    const { table, bannerBucket } = props;
    const tableEnvironment = { TABLE_NAME: table.tableName };

    this.publicFunction = this.createFunction({
      id: "EventPublic",
      name: "team32-ceb-events-public",
      entry: "src/lambda/event-public/handler.ts",
      description: "Public event list and detail with EventView recording.",
      environment: tableEnvironment,
    });
    this.allowItems(this.publicFunction, ["dynamodb:GetItem"], table, "EVENT#*");
    this.allowItems(this.publicFunction, ["dynamodb:PutItem"], table, "VIEW#*");
    this.allowIndexQuery(this.publicFunction, table, ["GSI1", "GSI2", "GSI3"]);

    this.managementFunction = this.createFunction({
      id: "EventManagement",
      name: "team32-ceb-events-manage",
      entry: "src/lambda/event-management/handler.ts",
      description: "Organizer/admin event management and banner presigned POST.",
      environment: { ...tableEnvironment, BANNER_BUCKET_NAME: bannerBucket.bucketName },
    });
    this.allowItems(
      this.managementFunction,
      ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      table,
      "EVENT#*",
    );
    this.allowIndexQuery(this.managementFunction, table, ["GSI4", "GSI7"]);
    // A presigned POST is signed with this role, so the role needs PutObject,
    // limited to the banners/ prefix.
    this.managementFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [bannerBucket.arnForObjects("banners/*")],
      }),
    );

    this.rsvpFunction = this.createFunction({
      id: "Rsvp",
      name: "team32-ceb-rsvp",
      entry: "src/lambda/rsvp/handler.ts",
      description: "Public RSVP, waitlist, and token cancellation.",
      environment: tableEnvironment,
    });
    // TransactWriteItems is authorized per item against these actions.
    this.allowItems(
      this.rsvpFunction,
      [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:ConditionCheckItem",
      ],
      table,
      "EVENT#*",
    );
    this.allowIndexQuery(this.rsvpFunction, table, ["GSI5", "GSI6"]);

    this.addRoutes(props);
  }

  private createFunction(spec: FunctionSpec): nodejs.NodejsFunction {
    const logGroup = new logs.LogGroup(this, `${spec.id}Logs`, {
      logGroupName: spec.name,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const role = new iam.Role(this, `${spec.id}RuntimeRole`, {
      roleName: `${spec.name}-runtime`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `Runtime role for ${spec.name}.`,
    });
    logGroup.grantWrite(role);
    const fn = new nodejs.NodejsFunction(this, `${spec.id}Function`, {
      functionName: spec.name,
      description: spec.description,
      entry: spec.entry,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      role,
      logGroup,
      bundling: {
        minify: true,
        sourceMap: false,
        // Bundle the pinned AWS SDK v3 packages (including s3-presigned-post)
        // instead of relying on the runtime-provided SDK version.
        externalModules: [],
      },
      environment: spec.environment,
    });
    NagSuppressions.addResourceSuppressions(
      fn,
      [
        {
          id: "AwsSolutions-L1",
          reason: `Node.js 22.x is explicitly locked by the approved runtime contract (NFR3). Re-evaluate before AWS deprecation. ${REVIEW}`,
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      role,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: `CloudWatch Logs requires the log-stream wildcard for Lambda writes; it is bounded to the single ${spec.name} log group. The banners/* object prefix (events-manage only) bounds presigned banner uploads to the banner key space. ${REVIEW}`,
          appliesTo: [
            { regex: "/^Resource::<.*Logs[A-F0-9]+\\.Arn>:\\*$/g" },
            { regex: "/^Resource::<.*BannerBucket[A-F0-9]+\\.Arn>\\/banners\\/\\*$/g" },
          ],
        },
      ],
      true,
    );
    return fn;
  }

  /** Item-level actions on the table, limited to partition keys with a prefix. */
  private allowItems(
    fn: nodejs.NodejsFunction,
    actions: string[],
    table: dynamodb.ITable,
    leadingKeyPattern: string,
  ): void {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions,
        resources: [table.tableArn],
        conditions: {
          "ForAllValues:StringLike": { "dynamodb:LeadingKeys": [leadingKeyPattern] },
        },
      }),
    );
  }

  private allowIndexQuery(
    fn: nodejs.NodejsFunction,
    table: dynamodb.ITable,
    indexes: string[],
  ): void {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: indexes.map((index) => `${table.tableArn}/index/${index}`),
      }),
    );
  }

  private addRoutes(props: EventApiProps): void {
    const { httpApi } = props;
    const publicIntegration = new integrations.HttpLambdaIntegration(
      "EventPublicIntegration",
      this.publicFunction,
    );
    const managementIntegration = new integrations.HttpLambdaIntegration(
      "EventManagementIntegration",
      this.managementFunction,
    );
    const rsvpIntegration = new integrations.HttpLambdaIntegration(
      "RsvpIntegration",
      this.rsvpFunction,
    );
    const none = new apigatewayv2.HttpNoneAuthorizer();
    const jwt = new ExistingJwtAuthorizer(props.jwtAuthorizer);
    const { GET, POST, PUT, DELETE } = apigatewayv2.HttpMethod;

    const publicRoutes: [string, HttpMethod, integrations.HttpLambdaIntegration][] = [
      ["/api/events", GET, publicIntegration],
      ["/api/events/{id}", GET, publicIntegration],
      ["/api/events/{id}/rsvps", POST, rsvpIntegration],
      ["/api/rsvps/cancel", POST, rsvpIntegration],
    ];
    for (const [path, method, integration] of publicRoutes) {
      for (const route of httpApi.addRoutes({
        path,
        methods: [method],
        integration,
        authorizer: none,
      })) {
        NagSuppressions.addResourceSuppressions(
          route,
          [
            {
              id: "AwsSolutions-APIG4",
              reason: `${method} ${path} is explicitly public under C-02 (resident browse, detail, RSVP, and token cancellation without sign-in). Protected routes use the C1 Cognito JWT authorizer. ${REVIEW}`,
            },
          ],
          true,
        );
      }
    }

    const protectedRoutes: [string, HttpMethod][] = [
      ["/api/events", POST],
      ["/api/events/{id}", PUT],
      ["/api/events/{id}", DELETE],
      ["/api/events/{id}/banner-upload", POST],
      ["/api/organizer/events", GET],
      ["/api/admin/events", GET],
    ];
    for (const [path, method] of protectedRoutes) {
      httpApi.addRoutes({
        path,
        methods: [method],
        integration: managementIntegration,
        authorizer: jwt,
      });
    }
  }
}
