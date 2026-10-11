import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Tags,
  CfnOutput,
  Fn,
  Aws,
} from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { EventApi } from "./event-api.js";
import { StatisticsAndArchival } from "./reminders-statistics-archival.js";
import { createSpaRewriteFunction, WebUi } from "./web-ui.js";
/**
 * SSM parameter holding the HTTP API id. Other stacks (C6 monitoring) read it by
 * name instead of a CloudFormation export, so the API can change without an
 * "export in use" lock.
 */
export const HTTP_API_ID_PARAMETER_NAME = "team32-ceb-http-api-id";

export class FoundationStack extends Stack {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly cognitoJwtAuthorizer: apigatewayv2.CfnAuthorizer;
  public readonly table: dynamodb.Table;
  public readonly bannerBucket: s3.Bucket;
  public readonly archiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    Tags.of(this).add("project", "team32-ceb");

    const { userPool, client } = this.createIdentity();
    const table = this.createTable();
    this.table = table;
    const buckets = this.createBuckets();
    this.bannerBucket = buckets.banner;
    this.archiveBucket = buckets.archive;
    const credentialsSecret = this.createCredentialsSecret();
    this.createSeedRuntimeRole(table, userPool, credentialsSecret);
    const apiAccessLogs = new logs.LogGroup(this, "ApiAccessLogs", {
      logGroupName: "team32-ceb-http-api-access",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const healthLogs = new logs.LogGroup(this, "HealthFunctionLogs", {
      logGroupName: "team32-ceb-health",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const healthRole = new iam.Role(this, "HealthRuntimeRole", {
      roleName: "team32-ceb-health-runtime",
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Runtime role for the stateless public health endpoint.",
    });
    healthLogs.grantWrite(healthRole);
    const healthFunction = new nodejs.NodejsFunction(this, "HealthFunction", {
      functionName: "team32-ceb-health",
      entry: "src/lambda/health/handler.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(5),
      memorySize: 128,
      role: healthRole,
      logGroup: healthLogs,
      bundling: {
        minify: true,
        sourceMap: false,
      },
      environment: {
        POWERTOOLS_SERVICE_NAME: "team32-ceb-health",
      },
    });
    const apiFoundation = this.createApi(userPool, client, healthFunction, apiAccessLogs);
    this.httpApi = apiFoundation.api;
    this.cognitoJwtAuthorizer = apiFoundation.jwtAuthorizer;

    new ssm.StringParameter(this, "HttpApiIdParameter", {
      parameterName: HTTP_API_ID_PARAMETER_NAME,
      stringValue: this.httpApi.apiId,
      description: "HTTP API id for stacks that monitor the API (read by name, not exported).",
    });

    // C3 Event APIs attach their routes to the shared HTTP API and authorizer.
    new EventApi(this, "EventApi", {
      httpApi: this.httpApi,
      jwtAuthorizer: this.cognitoJwtAuthorizer,
      table,
      bannerBucket: buckets.banner,
    });
    // C5 (Q1 A): admin statistics route, archival function, and its daily schedule.
    const operations = new StatisticsAndArchival(this, "StatisticsAndArchival", {
      httpApi: this.httpApi,
      jwtAuthorizer: this.cognitoJwtAuthorizer,
      table,
      archiveBucket: buckets.archive,
    });
    // C4 (D4): created before the distribution so the default behavior can use it.
    const spaRewrite = createSpaRewriteFunction(this);
    const distribution = this.createDistribution(
      buckets.web,
      buckets.banner,
      this.httpApi,
      spaRewrite,
    );
    // C4 (D3): publishes the built UI and config.json into the web bucket.
    new WebUi(this, "WebUi", {
      webBucket: buckets.web,
      distribution,
      userPool,
      userPoolClient: client,
    });

    this.addC1Outputs(userPool, client, buckets, table, distribution, credentialsSecret);
    // C-01/C-06: the archival function the pipeline invokes after deploy.
    new CfnOutput(this, "ArchiveFunctionName", {
      value: operations.archivalFunction.functionName,
    });
    NagSuppressions.addResourceSuppressions(
      userPool,
      [
        {
          id: "AwsSolutions-COG2",
          reason:
            "Synthetic demo identities are intentionally usable without a second factor for MVP verification; re-evaluate before production identity onboarding. Owner: Onur. Review by 2027-01-03.",
        },
        {
          id: "AwsSolutions-COG3",
          reason:
            "Advanced threat protection is not required by the approved synthetic-user C1 slice and adds an unmeasured usage cost. Reassess with production identity requirements. Owner: Onur. Review by 2027-01-03.",
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      credentialsSecret,
      [
        {
          id: "AwsSolutions-SMG4",
          reason:
            "Rotating this secret independently would desynchronize the stored demo passwords from Cognito. Seed loading reuses secret values and updates Cognito idempotently; coordinated rotation requires a separately designed workflow. Owner: Onur. Review by 2027-01-03.",
        },
      ],
      true,
    );
    for (const bucket of Object.values(buckets)) {
      NagSuppressions.addResourceSuppressions(
        bucket,
        [
          {
            id: "AwsSolutions-S1",
            reason:
              "S3 server access logs would record requester metadata and are not required by the C1 contract. Public access is blocked and API access logs capture the approved request fields. Owner: Onur. Review by 2027-01-03.",
          },
        ],
        true,
      );
    }
    NagSuppressions.addResourceSuppressions(
      healthFunction,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "Node.js 22.x is explicitly locked by the approved C1 runtime contract. Re-evaluate before AWS deprecation. Owner: Onur. Review by 2027-01-03.",
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      healthRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CloudWatch Logs requires a log-stream wildcard for Lambda writes; the permission is bounded to the single team32-ceb-health log group. Owner: Onur. Review by 2027-01-03.",
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      distribution,
      [
        {
          id: "AwsSolutions-CFR1",
          reason:
            "The public community-event board has no approved country allow/deny boundary; Geo restriction would block valid global verification. Owner: Onur. Review by 2027-01-03.",
        },
        {
          id: "AwsSolutions-CFR2",
          reason:
            "A WAF is not an approved C1 resource and has ongoing cost; add only through a separately approved security scope. Owner: Onur. Review by 2027-01-03.",
        },
        {
          id: "AwsSolutions-CFR3",
          reason:
            "CloudFront viewer logs contain requester metadata not required by C1. API Gateway logs record status, route, request ID, and latency; no cookies are logged. Owner: Onur. Review by 2027-01-03.",
        },
        {
          id: "AwsSolutions-CFR4",
          reason:
            "The approved contract uses the CloudFront default hostname and provides no custom domain/ACM certificate; the AWS-managed viewer certificate policy cannot be customized. HTTPS redirection remains enabled. Owner: Onur. Review by 2027-01-03.",
        },
      ],
      true,
    );
  }

  private createIdentity(): { userPool: cognito.UserPool; client: cognito.UserPoolClient } {
    const pool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "team32-ceb-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 14,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const client = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: pool,
      userPoolClientName: "team32-ceb-web-client",
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
    });
    new cognito.CfnUserPoolGroup(this, "OrganizerGroup", {
      userPoolId: pool.userPoolId,
      groupName: "organizer",
      description: "Community event organizers.",
    });
    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: pool.userPoolId,
      groupName: "admin",
      description: "Community event administrators.",
    });

    return { userPool: pool, client };
  }

  private createTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, "EventsTable", {
      tableName: "team32-ceb-events",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const indexes = [
      ["GSI1", "gsi1pk", "gsi1sk"],
      ["GSI2", "gsi2pk", "gsi2sk"],
      ["GSI3", "gsi3pk", "gsi3sk"],
      ["GSI4", "gsi4pk", "gsi4sk"],
      ["GSI5", "gsi5pk", "gsi5sk"],
      ["GSI6", "gsi6pk", "gsi6sk"],
      ["GSI7", "gsi7pk", "gsi7sk"],
    ] as const;

    for (const [indexName, partitionKey, sortKey] of indexes) {
      table.addGlobalSecondaryIndex({
        indexName,
        partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING },
        sortKey: { name: sortKey, type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }

    return table;
  }

  private createSeedRuntimeRole(
    table: dynamodb.Table,
    userPool: cognito.UserPool,
    credentialsSecret: secretsmanager.Secret,
  ): iam.Role {
    const role = new iam.Role(this, "SeedRuntimeRole", {
      roleName: "team32-ceb-seed-runtime",
      assumedBy: new iam.AccountPrincipal(Aws.ACCOUNT_ID),
      description: "Allows the authorized seed runner to write deterministic C1 fixtures.",
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [table.tableArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"],
        resources: [credentialsSecret.secretArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminSetUserPassword",
        ],
        resources: [userPool.userPoolArn],
      }),
    );
    return role;
  }

  private createBuckets(): { web: s3.Bucket; banner: s3.Bucket; archive: s3.Bucket } {
    const common = {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    };
    const suffix = `${Aws.ACCOUNT_ID}-${Aws.REGION}`;

    return {
      web: new s3.Bucket(this, "WebBucket", {
        ...common,
        bucketName: `team32-ceb-web-${suffix}`,
      }),
      banner: new s3.Bucket(this, "BannerBucket", {
        ...common,
        bucketName: `team32-ceb-banner-${suffix}`,
        // C3 (Q2, D13): lets the browser POST presigned uploads. The exact
        // distribution domain would create a dependency cycle because the
        // distribution uses this bucket as an origin; the signed POST policy,
        // not CORS, is the access boundary.
        cors: [
          {
            allowedMethods: [s3.HttpMethods.POST],
            allowedOrigins: ["https://*.cloudfront.net"],
            allowedHeaders: ["*"],
            maxAge: 3000,
          },
        ],
      }),
      archive: new s3.Bucket(this, "ArchiveBucket", {
        ...common,
        bucketName: `team32-ceb-archive-${suffix}`,
      }),
    };
  }

  private createCredentialsSecret(): secretsmanager.Secret {
    return new secretsmanager.Secret(this, "DemoCredentialsSecret", {
      secretName: "team32-ceb-demo-credentials",
      description: "Generated demo credential material; value is never exposed as a stack output.",
      generateSecretString: {
        secretStringTemplate: "{}",
        generateStringKey: "bootstrap",
        passwordLength: 32,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  private createApi(
    userPool: cognito.UserPool,
    client: cognito.UserPoolClient,
    healthFunction: lambda.IFunction,
    accessLogs: logs.LogGroup,
  ): { api: apigatewayv2.HttpApi; jwtAuthorizer: apigatewayv2.CfnAuthorizer } {
    const api = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: "team32-ceb-http-api",
      description: "Community Event Board HTTP API.",
      createDefaultStage: false,
    });

    // Keep the JWT capability in the shared API stack without claiming any
    // protected route owned by another Unit. Those Units attach their routes.
    const jwtAuthorizer = new apigatewayv2.CfnAuthorizer(this, "CognitoJwtAuthorizer", {
      apiId: api.apiId,
      authorizerType: "JWT",
      name: "team32-ceb-cognito-jwt",
      identitySource: ["$request.header.Authorization"],
      jwtConfiguration: {
        audience: [client.userPoolClientId],
        issuer: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      },
    });
    api.addRoutes({
      path: "/api/health",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("HealthIntegration", healthFunction),
      authorizer: new apigatewayv2.HttpNoneAuthorizer(),
    });
    const healthRoute = api.node.tryFindChild("GET--api--health");
    if (healthRoute) {
      NagSuppressions.addResourceSuppressions(
        healthRoute,
        [
          {
            id: "AwsSolutions-APIG4",
            reason:
              "GET /api/health is explicitly public under C-02 and returns only deterministic service status. Protected routes remain the responsibility of their owning Units. Owner: Onur. Review by 2027-01-03.",
          },
        ],
        true,
      );
    }
    accessLogs.grantWrite(new iam.ServicePrincipal("apigateway.amazonaws.com"));
    new apigatewayv2.CfnStage(this, "HttpApiDefaultStage", {
      apiId: api.apiId,
      stageName: "$default",
      autoDeploy: true,
      accessLogSettings: {
        destinationArn: accessLogs.logGroupArn,
        format: JSON.stringify({
          requestId: "$context.requestId",
          routeKey: "$context.routeKey",
          status: "$context.status",
          responseLatency: "$context.responseLatency",
        }),
      },
    });
    return { api, jwtAuthorizer };
  }

  private createDistribution(
    webBucket: s3.Bucket,
    bannerBucket: s3.Bucket,
    api: apigatewayv2.HttpApi,
    spaRewrite: cloudfront.IFunction,
  ): cloudfront.Distribution {
    const apiDomain = Fn.select(2, Fn.split("/", api.apiEndpoint));
    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      readTimeout: Duration.seconds(30),
    });
    const webOac = new cloudfront.CfnOriginAccessControl(this, "WebOriginAccessControl", {
      originAccessControlConfig: {
        name: "team32-ceb-web-oac",
        originAccessControlOriginType: "s3",
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });
    const webOrigin = origins.S3BucketOrigin.withOriginAccessControl(webBucket, {
      originAccessControl: webOac,
    });
    // C3 (D13): read-only banner serving. The same OAC signing configuration
    // grants CloudFront s3:GetObject on the banner bucket; browsers never
    // receive write credentials.
    const bannerOrigin = origins.S3BucketOrigin.withOriginAccessControl(bannerBucket, {
      originAccessControl: webOac,
      originAccessLevels: [cloudfront.AccessLevel.READ],
    });

    return new cloudfront.Distribution(this, "Distribution", {
      comment: "team32-ceb shared web and API distribution",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: webOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // C4 (D4): client-side routes resolve to index.html. The api/* and
        // banners/* behaviors below have no function association.
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        "api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
        "banners/*": {
          origin: bannerOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
      },
      enableIpv6: true,
    });
  }

  private addC1Outputs(
    userPool: cognito.UserPool,
    client: cognito.UserPoolClient,
    buckets: { web: s3.Bucket; banner: s3.Bucket; archive: s3.Bucket },
    table: dynamodb.Table,
    distribution: cloudfront.Distribution,
    secret: secretsmanager.Secret,
  ): void {
    const siteUrl = `https://${distribution.distributionDomainName}`;
    const outputs: Record<string, string> = {
      SiteUrl: siteUrl,
      ApiBaseUrl: siteUrl,
      UserPoolId: userPool.userPoolId,
      UserPoolClientId: client.userPoolClientId,
      WebBucketName: buckets.web.bucketName,
      DistributionId: distribution.distributionId,
      BannerBucketName: buckets.banner.bucketName,
      TableName: table.tableName,
      ArchiveBucketName: buckets.archive.bucketName,
      DemoCredentialsSecretArn: secret.secretArn,
      Region: this.region,
    };

    for (const [name, value] of Object.entries(outputs)) {
      new CfnOutput(this, name, { value });
    }
  }
}
