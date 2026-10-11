import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { FoundationStack } from "../../../src/infrastructure/foundation-stack.js";
import { createSeedFixtures } from "../../../src/seed/fixtures.js";

let cachedTemplate: Template | undefined;

function createTemplate(): Template {
  if (cachedTemplate) {
    return cachedTemplate;
  }
  const app = new App();
  const stack = new FoundationStack(app, "team32-ceb-foundation", {
    env: { region: "us-east-1" },
  });
  cachedTemplate = Template.fromStack(stack);
  return cachedTemplate;
}

describe("C1 foundation CDK contract", () => {
  it("uses the approved team32-ceb prefix for the single-table resource", () => {
    createTemplate().hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "team32-ceb-events",
    });
  });

  it("defines the C-03 physical partition and sort keys", () => {
    createTemplate().hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    });
  });

  it("encrypts the table and enables point-in-time recovery", () => {
    createTemplate().hasResourceProperties("AWS::DynamoDB::Table", {
      SSESpecification: { SSEEnabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it("uses on-demand capacity rather than provisioned throughput", () => {
    createTemplate().hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("provisions all seven C-03 indexes without adding non-contract indexes", () => {
    const template = createTemplate();
    const tables = template.findResources("AWS::DynamoDB::Table");
    const table = Object.values(tables)[0] as {
      Properties: { GlobalSecondaryIndexes: { IndexName: string }[] };
    };
    expect(
      table.Properties.GlobalSecondaryIndexes.map(({ IndexName }) => IndexName).sort(),
    ).toEqual(["GSI1", "GSI2", "GSI3", "GSI4", "GSI5", "GSI6", "GSI7"]);
  });

  it("blocks public S3 access and enables server-side encryption on every C1 bucket", () => {
    const template = createTemplate();
    template.resourceCountIs("AWS::S3::Bucket", 3);
    template.allResourcesProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
  });

  it("limits web-bucket reads to CloudFront Origin Access Control", () => {
    const template = createTemplate();
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        Origins: Match.arrayWith([
          Match.objectLike({
            S3OriginConfig: { OriginAccessIdentity: "" },
            OriginAccessControlId: Match.anyValue(),
          }),
        ]),
      },
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Condition: {
              StringEquals: {
                "AWS:SourceArn": Match.anyValue(),
              },
            },
          }),
        ]),
      },
    });
  });

  it("creates exact Cognito groups and a non-secret public-client application", () => {
    const template = createTemplate();
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_SRP_AUTH"]),
    });
    const groups = template.findResources("AWS::Cognito::UserPoolGroup");
    expect(
      Object.values(groups)
        .map((group) => (group as { Properties: { GroupName: string } }).Properties.GroupName)
        .sort(),
    ).toEqual(["admin", "organizer"]);
  });

  it("keeps health public and provisions a Cognito JWT authorizer capability", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /api/health",
      AuthorizationType: "NONE",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      Name: "team32-ceb-cognito-jwt",
      AuthorizerType: "JWT",
      IdentitySource: ["$request.header.Authorization"],
    });
    // C3 attaches its own routes to this API; C1 owns exactly the health route.
    const routeKeys = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
      (route) => (route as { Properties: { RouteKey: string } }).Properties.RouteKey,
    );
    expect(routeKeys.filter((key) => key === "GET /api/health")).toHaveLength(1);
    template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 1);
  });

  it("binds the JWT authorizer to the stack's own Cognito issuer and app client", () => {
    const template = createTemplate();
    const userPoolIds = Object.keys(template.findResources("AWS::Cognito::UserPool"));
    const clientIds = Object.keys(template.findResources("AWS::Cognito::UserPoolClient"));
    expect(userPoolIds).toHaveLength(1);
    expect(clientIds).toHaveLength(1);
    const authorizers = Object.values(template.findResources("AWS::ApiGatewayV2::Authorizer")) as {
      Properties: { JwtConfiguration: { Audience: unknown; Issuer: unknown } };
    }[];
    expect(authorizers).toHaveLength(1);
    expect(authorizers[0].Properties.JwtConfiguration.Issuer).toEqual({
      "Fn::Join": ["", ["https://cognito-idp.us-east-1.amazonaws.com/", { Ref: userPoolIds[0] }]],
    });
    expect(authorizers[0].Properties.JwtConfiguration.Audience).toEqual([{ Ref: clientIds[0] }]);
  });

  it("runs every Lambda function on Node.js 22.x", () => {
    const template = createTemplate();
    const functions = Object.values(template.findResources("AWS::Lambda::Function")) as {
      Properties: { Runtime: string };
    }[];
    expect(functions.length).toBeGreaterThan(0);
    for (const fn of functions) {
      expect(fn.Properties.Runtime).toBe("nodejs22.x");
    }
  });

  it("sets project=team32-ceb on every resource with Tags and on the User Pool's UserPoolTags", () => {
    const template = createTemplate();
    const userPools = Object.values(template.findResources("AWS::Cognito::UserPool")) as {
      Properties: { UserPoolTags?: Record<string, unknown> };
    }[];
    expect(userPools).toHaveLength(1);
    expect(userPools[0].Properties.UserPoolTags?.project).toBe("team32-ceb");
    const resources = Object.entries(template.toJSON().Resources) as [
      string,
      { Properties?: { Tags?: unknown } },
    ][];
    const tagged = resources.filter(([, resource]) => resource.Properties?.Tags !== undefined);
    expect(tagged.length).toBeGreaterThan(0);
    for (const [logicalId, resource] of tagged) {
      const tags = resource.Properties?.Tags;
      const projectTag = Array.isArray(tags)
        ? (tags as { Key: string; Value: unknown }[]).find(({ Key }) => Key === "project")?.Value
        : (tags as Record<string, unknown>).project;
      expect({ logicalId, projectTag }).toEqual({ logicalId, projectTag: "team32-ceb" });
    }
  });

  it("emits only approved request ID, route, status, and latency API log fields", () => {
    const stages = Object.values(createTemplate().findResources("AWS::ApiGatewayV2::Stage")) as {
      Properties: { AccessLogSettings: { Format: string } };
    }[];
    expect(stages).toHaveLength(1);
    expect(JSON.parse(stages[0].Properties.AccessLogSettings.Format)).toEqual({
      requestId: "$context.requestId",
      routeKey: "$context.routeKey",
      status: "$context.status",
      responseLatency: "$context.responseLatency",
    });
  });

  it("routes the CloudFront API behavior to HTTPS API Gateway without caching", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
        },
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: "api/*",
            ViewerProtocolPolicy: "redirect-to-https",
            CachePolicyId: Match.anyValue(),
            TargetOriginId: Match.anyValue(),
          }),
        ]),
      },
    });
  });

  it("sets 14-day retention for each C1-owned log group and tags solution resources", () => {
    const template = createTemplate();
    // C3 adds its own log groups; C1 owns these two.
    for (const logGroupName of ["team32-ceb-http-api-access", "team32-ceb-health"]) {
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: logGroupName,
        RetentionInDays: 14,
      });
    }
    template.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([Match.objectLike({ Key: "project", Value: "team32-ceb" })]),
    });
  });

  it("scopes seed initialization to GetItem and PutItem on the foundation table only", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "team32-ceb-seed-runtime",
    });
    const policies = Object.values(template.findResources("AWS::IAM::Policy")) as {
      Properties: {
        Roles: { Ref: string }[];
        PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] };
      };
    }[];
    const seedPolicy = policies.find((policy) =>
      policy.Properties.Roles[0].Ref.includes("SeedRuntimeRole"),
    );
    expect(seedPolicy).toBeDefined();
    const statements = seedPolicy?.Properties.PolicyDocument.Statement ?? [];
    const dynamoStatements = statements.filter((statement) =>
      [statement.Action].flat().some((action) => action.startsWith("dynamodb:")),
    );
    expect(dynamoStatements).toHaveLength(1);
    expect(dynamoStatements[0].Action).toEqual(["dynamodb:GetItem", "dynamodb:PutItem"]);
    expect(dynamoStatements[0].Resource).toEqual({
      "Fn::GetAtt": [expect.stringContaining("EventsTable"), "Arn"],
    });
    expect(JSON.stringify(statements)).not.toMatch(/dynamodb:\*|Resource":\s*"\*"/);
    expect(JSON.stringify(statements)).toContain("secretsmanager:GetSecretValue");
    expect(JSON.stringify(statements)).toContain("cognito-idp:AdminCreateUser");
  });

  it("limits health runtime logging to its named C1 log group", () => {
    const template = createTemplate();
    const policies = Object.values(template.findResources("AWS::IAM::Policy")) as {
      Properties: {
        Roles: { Ref: string }[];
        PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] };
      };
    }[];
    const healthPolicy = policies.find((policy) =>
      policy.Properties.Roles[0].Ref.includes("HealthRuntimeRole"),
    );
    expect(healthPolicy).toBeDefined();
    const statements = healthPolicy?.Properties.PolicyDocument.Statement ?? [];
    const healthLogGroup = Object.entries(template.findResources("AWS::Logs::LogGroup")).find(
      ([, resource]) =>
        (resource as { Properties: { LogGroupName: string } }).Properties.LogGroupName ===
        "team32-ceb-health",
    );
    expect(healthLogGroup).toBeDefined();
    expect(statements[0]?.Resource).toEqual({
      "Fn::GetAtt": [healthLogGroup?.[0], "Arn"],
    });
    expect(JSON.stringify(statements)).not.toContain('"Resource":"*"');
  });

  it("emits only C1-owned C-01 outputs and asserts final verification Region", () => {
    const template = createTemplate();
    const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(Object.keys(outputs).sort()).toEqual([
      "ApiBaseUrl",
      "ArchiveBucketName",
      // C5 (C-06): the archival function name the pipeline invokes.
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
    expect(outputs.Region.Value).toBe("us-east-1");
    expect(outputs.ApiBaseUrl.Value).toEqual(outputs.SiteUrl.Value);
    expect(JSON.stringify(outputs)).not.toMatch(/password|secretstring|token/i);
  });

  it("does not provision queue, DLQ, reminder schedule, or alarm resources owned by C6", () => {
    const template = createTemplate();
    template.resourceCountIs("AWS::SQS::Queue", 0);
    // The only schedule here is C5's daily archival schedule (Q1 A); the
    // 15-minute reminder schedule belongs to the C6 stack.
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "team32-ceb-archival-daily",
    });
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });
});

describe("seed persistence boundary contract", () => {
  it("uses table primary keys and indexes required by the approved C-03 fixture shapes", () => {
    const template = createTemplate();
    const dynamoTable = Object.values(template.findResources("AWS::DynamoDB::Table"))[0] as {
      Properties: { AttributeDefinitions: { AttributeName: string }[] };
    };
    const attributes = new Set(
      dynamoTable.Properties.AttributeDefinitions.map(({ AttributeName }) => AttributeName),
    );
    expect(attributes.size).toBe(16);
    for (const key of [
      "pk",
      "sk",
      "gsi1pk",
      "gsi1sk",
      "gsi5pk",
      "gsi5sk",
      "gsi6pk",
      "gsi6sk",
      "gsi7pk",
      "gsi7sk",
    ]) {
      expect(attributes.has(key)).toBe(true);
    }
    const fixtures = createSeedFixtures({
      organizerSubject: "11111111-1111-4111-8111-111111111111",
      clock: () => new Date("2030-01-15T12:00:00.000Z"),
    });
    expect(fixtures.every((item) => item.pk && item.sk)).toBe(true);
    expect(fixtures[2].pk).toMatch(/^EVENT#seed-event-/);
    expect(fixtures[2].sk).toBe("REG#resident.one@example.com");
  });
});
