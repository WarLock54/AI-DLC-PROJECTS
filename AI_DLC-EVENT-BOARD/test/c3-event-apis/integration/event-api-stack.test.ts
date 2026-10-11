import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { resourcesOfType, synthesizeFoundation } from "./stack.js";

const C3_FUNCTIONS = ["team32-ceb-events-manage", "team32-ceb-events-public", "team32-ceb-rsvp"];

const PUBLIC_ROUTES = [
  "GET /api/events",
  "GET /api/events/{id}",
  "POST /api/events/{id}/rsvps",
  "POST /api/rsvps/cancel",
];
const PROTECTED_ROUTES = [
  "POST /api/events",
  "PUT /api/events/{id}",
  "DELETE /api/events/{id}",
  "POST /api/events/{id}/banner-upload",
  "GET /api/organizer/events",
  "GET /api/admin/events",
];

describe("C3 EventApi CDK contract", () => {
  it("adds three Node.js 22.x functions named with the team32-ceb- prefix", () => {
    const { template } = synthesizeFoundation();
    const functions = resourcesOfType(template, "AWS::Lambda::Function").map(
      ([, resource]) => resource.Properties,
    );
    const c3 = functions.filter((props) => C3_FUNCTIONS.includes(String(props.FunctionName)));
    expect(c3.map((props) => props.FunctionName).sort()).toEqual(C3_FUNCTIONS);
    for (const props of c3) {
      expect(props.Runtime).toBe("nodejs22.x");
      expect(Object.keys((props.Environment as { Variables: object }).Variables).sort()).toEqual(
        props.FunctionName === "team32-ceb-events-manage"
          ? ["BANNER_BUCKET_NAME", "TABLE_NAME"]
          : ["TABLE_NAME"],
      );
    }
  });

  it("gives every C3 function its own 14-day log group and runtime role", () => {
    const { template } = synthesizeFoundation();
    for (const name of C3_FUNCTIONS) {
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: name,
        RetentionInDays: 14,
      });
      template.hasResourceProperties("AWS::IAM::Role", { RoleName: `${name}-runtime` });
    }
    template.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
  });

  it("attaches public routes without an authorizer and protected routes to C1's JWT authorizer", () => {
    const { template } = synthesizeFoundation();
    const [authorizerId] = resourcesOfType(template, "AWS::ApiGatewayV2::Authorizer").map(
      ([logicalId]) => logicalId,
    );
    const routes = new Map(
      resourcesOfType(template, "AWS::ApiGatewayV2::Route").map(([, resource]) => [
        String(resource.Properties.RouteKey),
        resource.Properties,
      ]),
    );
    for (const key of PUBLIC_ROUTES) {
      expect({ key, type: routes.get(key)?.AuthorizationType }).toEqual({ key, type: "NONE" });
      expect(routes.get(key)?.AuthorizerId).toBeUndefined();
    }
    for (const key of PROTECTED_ROUTES) {
      expect({ key, props: routes.get(key) }).toMatchObject({
        key,
        props: { AuthorizationType: "JWT", AuthorizerId: { Ref: authorizerId } },
      });
    }
    template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 1);
  });

  it("adds only the C3 routes and no C-01 output (C5 owns the statistics route)", () => {
    const { template } = synthesizeFoundation();
    const routeKeys = resourcesOfType(template, "AWS::ApiGatewayV2::Route").map(([, resource]) =>
      String(resource.Properties.RouteKey),
    );
    // GET /api/admin/stats is attached by the C5 StatisticsAndArchival construct.
    expect(routeKeys.sort()).toEqual(
      ["GET /api/health", ...PUBLIC_ROUTES, ...PROTECTED_ROUTES, "GET /api/admin/stats"].sort(),
    );
    const outputs = Object.keys(template.toJSON().Outputs as object);
    // The eleven C1 outputs plus C5's ArchiveFunctionName; none from C3.
    expect(outputs).toHaveLength(12);
  });

  it("scopes IAM to the table, named index ARNs, and the banners/ prefix only", () => {
    const { template } = synthesizeFoundation();
    const policies = resourcesOfType(template, "AWS::IAM::Policy").filter(([logicalId]) =>
      logicalId.startsWith("EventApi"),
    );
    expect(policies).toHaveLength(3);
    const indexesByPolicy: Record<string, string[]> = {};
    for (const [logicalId, policy] of policies) {
      const statements = (
        policy.Properties.PolicyDocument as { Statement: Record<string, unknown>[] }
      ).Statement;
      const text = JSON.stringify(statements);
      expect(text).not.toMatch(/"Action":"[a-z0-9]+:\*"|"Resource":"\*"/);
      expect(text).not.toMatch(/dynamodb:(Scan|DeleteItem|BatchWriteItem|\*)/);
      indexesByPolicy[logicalId] = [...text.matchAll(/\/index\/(GSI\d)/g)].map((match) => match[1]);
      for (const statement of statements) {
        const actions = [statement.Action].flat() as string[];
        if (actions.some((action) => /dynamodb:(GetItem|PutItem|UpdateItem)/.test(action))) {
          expect(statement.Resource).toEqual({
            "Fn::GetAtt": [expect.stringContaining("EventsTable"), "Arn"],
          });
          expect(statement.Condition).toEqual({
            "ForAllValues:StringLike": {
              "dynamodb:LeadingKeys": [expect.stringMatching(/^(EVENT|VIEW)#\*$/)],
            },
          });
        }
        if (actions.includes("s3:PutObject")) {
          expect(statement.Resource).toEqual({
            "Fn::Join": [
              "",
              [{ "Fn::GetAtt": [expect.stringContaining("BannerBucket"), "Arn"] }, "/banners/*"],
            ],
          });
        }
      }
    }
    const byRole = Object.fromEntries(
      Object.entries(indexesByPolicy).map(([id, indexes]) => [
        id.replace(/RuntimeRole.*/, ""),
        indexes,
      ]),
    );
    expect(byRole).toEqual({
      EventApiEventPublic: ["GSI1", "GSI2", "GSI3"],
      EventApiEventManagement: ["GSI4", "GSI7"],
      EventApiRsvp: ["GSI5", "GSI6"],
    });
  });

  it("allows browser POST uploads to the banner bucket through a CORS rule", () => {
    const { template } = synthesizeFoundation();
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: Match.objectLike({
        "Fn::Join": Match.arrayWith([Match.arrayWith(["team32-ceb-banner-"])]),
      }),
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedMethods: ["POST"],
            AllowedOrigins: ["https://*.cloudfront.net"],
            AllowedHeaders: ["*"],
            MaxAge: 3000,
          },
        ],
      },
    });
    template.resourceCountIs("AWS::S3::Bucket", 3);
  });

  it("serves banners/* read-only (GET/HEAD) through CloudFront Origin Access Control", () => {
    const { template } = synthesizeFoundation();
    const [, distribution] = resourcesOfType(template, "AWS::CloudFront::Distribution")[0];
    const config = distribution.Properties.DistributionConfig as {
      CacheBehaviors: Record<string, unknown>[];
      Origins: { Id: string; OriginAccessControlId?: unknown; DomainName: unknown }[];
    };
    const behavior = config.CacheBehaviors.find((entry) => entry.PathPattern === "banners/*");
    expect(behavior).toMatchObject({
      AllowedMethods: ["GET", "HEAD"],
      ViewerProtocolPolicy: "redirect-to-https",
    });
    const origin = config.Origins.find((entry) => entry.Id === behavior?.TargetOriginId);
    expect(origin?.OriginAccessControlId).toBeDefined();
    expect(JSON.stringify(origin?.DomainName)).toContain("BannerBucket");
    const bannerPolicy = resourcesOfType(template, "AWS::S3::BucketPolicy").find(([, policy]) =>
      JSON.stringify(policy.Properties.Bucket).includes("BannerBucket"),
    );
    const statements = JSON.stringify(bannerPolicy?.[1].Properties.PolicyDocument);
    expect(statements).toContain('"Service":"cloudfront.amazonaws.com"');
    expect(statements).toContain('"Action":"s3:GetObject"');
    expect(statements).not.toMatch(/s3:PutObject|s3:DeleteObject/);
  });

  it("tags every taggable resource, including C3 resources, with project=team32-ceb", () => {
    const { template } = synthesizeFoundation();
    const resources = Object.entries(template.toJSON().Resources) as [
      string,
      { Properties?: { Tags?: unknown } },
    ][];
    const c3Tagged = resources.filter(
      ([logicalId, resource]) => logicalId.startsWith("EventApi") && resource.Properties?.Tags,
    );
    expect(c3Tagged.length).toBeGreaterThanOrEqual(9);
    for (const [logicalId, resource] of resources.filter(([, r]) => r.Properties?.Tags)) {
      const tags = resource.Properties?.Tags;
      const project = Array.isArray(tags)
        ? (tags as { Key: string; Value: unknown }[]).find(({ Key }) => Key === "project")?.Value
        : (tags as Record<string, unknown>).project;
      expect({ logicalId, project }).toEqual({ logicalId, project: "team32-ceb" });
    }
  });
});
