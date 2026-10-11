// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { findProhibited, isCandidate } from "../../../scripts/prohibited-token-policy.js";
import { FoundationStack } from "../../../src/infrastructure/foundation-stack.js";
import {
  SPA_REWRITE_FUNCTION_NAME,
  SPA_REWRITE_FUNCTION_SOURCE,
} from "../../../src/infrastructure/spa-rewrite.js";
import { buildWebUi } from "../../../src/infrastructure/web-ui.js";

let cached: Template | undefined;

function template(): Template {
  if (!cached) {
    const app = new App();
    const stack = new FoundationStack(app, "team32-ceb-foundation", {
      env: { region: "us-east-1" },
    });
    cached = Template.fromStack(stack);
  }
  return cached;
}

interface Behavior {
  PathPattern?: string;
  FunctionAssociations?: { EventType: string; FunctionARN: unknown }[];
}

function distributionConfig(): {
  DefaultCacheBehavior: Behavior;
  CacheBehaviors: Behavior[];
  CustomErrorResponses?: unknown;
} {
  const distributions = Object.values(
    template().findResources("AWS::CloudFront::Distribution"),
  ) as {
    Properties: {
      DistributionConfig: ReturnType<typeof distributionConfig>;
    };
  }[];
  expect(distributions).toHaveLength(1);
  return distributions[0].Properties.DistributionConfig;
}

describe("C4 web UI delivery infrastructure", () => {
  it("associates exactly one viewer-request function with the default behavior only", () => {
    const functions = template().findResources("AWS::CloudFront::Function");
    const [logicalId] = Object.keys(functions);
    expect(Object.keys(functions)).toHaveLength(1);
    const config = distributionConfig();
    expect(config.DefaultCacheBehavior.FunctionAssociations).toEqual([
      { EventType: "viewer-request", FunctionARN: { "Fn::GetAtt": [logicalId, "FunctionARN"] } },
    ]);
    const additional = Object.fromEntries(
      config.CacheBehaviors.map((behavior) => [
        behavior.PathPattern,
        behavior.FunctionAssociations,
      ]),
    );
    expect(Object.keys(additional).sort()).toEqual(["api/*", "banners/*"]);
    expect(additional["api/*"]).toBeUndefined();
    expect(additional["banners/*"]).toBeUndefined();
  });

  it("deploys the tested rewrite source as team32-ceb-spa-rewrite on cloudfront-js-2.0", () => {
    template().hasResourceProperties("AWS::CloudFront::Function", {
      Name: SPA_REWRITE_FUNCTION_NAME,
      AutoPublish: true,
      FunctionCode: SPA_REWRITE_FUNCTION_SOURCE,
      FunctionConfig: {
        Runtime: "cloudfront-js-2.0",
        Comment: Match.stringLikeRegexp("^team32-ceb"),
      },
    });
  });

  it("adds no custom error responses, so /api/* keeps its JSON 403/404 bodies", () => {
    expect(distributionConfig().CustomErrorResponses).toBeUndefined();
  });

  it("keeps the foundation outputs exactly the C-01 foundation set", () => {
    const outputs = Object.keys(template().toJSON().Outputs as Record<string, unknown>).sort();
    expect(outputs).toEqual([
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
  });

  it("builds index.html, app.js, and styles.css with no prohibited token", () => {
    const outDir = buildWebUi({ outDir: mkdtempSync(join(tmpdir(), "team32-ceb-web-ui-")) });
    for (const file of ["index.html", "app.js", "styles.css"]) {
      expect(existsSync(join(outDir, file)), file).toBe(true);
    }
    const bundle = readFileSync(join(outDir, "app.js"), "utf8");
    expect(bundle.length).toBeGreaterThan(1000);
    // Same case-insensitive rule as the CI prohibited-token check.
    expect(findProhibited(bundle)).toEqual([]);
    expect(findProhibited(readFileSync(join(outDir, "index.html"), "utf8"))).toEqual([]);
    expect(findProhibited(readFileSync(join(outDir, "styles.css"), "utf8"))).toEqual([]);
    expect(bundle).not.toContain("innerHTML");
    expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain('src="/app.js"');
  });

  it("produces identical output for identical sources (stable asset hash)", () => {
    const first = buildWebUi({ outDir: mkdtempSync(join(tmpdir(), "team32-ceb-web-ui-")) });
    const second = buildWebUi({ outDir: mkdtempSync(join(tmpdir(), "team32-ceb-web-ui-")) });
    expect(readFileSync(join(first, "app.js"), "utf8")).toBe(
      readFileSync(join(second, "app.js"), "utf8"),
    );
  });

  it("fails loudly with esbuild's message when the UI does not compile", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "team32-ceb-web-ui-src-"));
    mkdirSync(join(sourceDir, "src"));
    writeFileSync(
      join(sourceDir, "src", "main.ts"),
      "import { missing } from './nowhere.js';\nconsole.log(missing);\n",
    );
    writeFileSync(join(sourceDir, "index.html"), "<!doctype html>");
    writeFileSync(join(sourceDir, "styles.css"), "body{}");
    expect(() =>
      buildWebUi({ sourceDir, outDir: mkdtempSync(join(tmpdir(), "team32-ceb-web-ui-")) }),
    ).toThrow(/nowhere/);
  });
});

type CfnResource = {
  Type: string;
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
};

function resourcesOfType(type: string): [string, CfnResource][] {
  return Object.entries(template().findResources(type)) as [string, CfnResource][];
}

function logicalId(type: string, match: (id: string) => boolean): string {
  const ids = Object.keys(template().findResources(type)).filter(match);
  expect(ids, type).toHaveLength(1);
  return ids[0];
}

describe("C4 web deployment custom resource (D3)", () => {
  it("publishes to the web bucket and distribution with config from the pool and client tokens", () => {
    const [deployments, bucketDeployments] = [
      resourcesOfType("Custom::Team32CebWebDeployment"),
      resourcesOfType("Custom::CDKBucketDeployment"),
    ];
    expect(bucketDeployments).toHaveLength(0);
    expect(deployments).toHaveLength(1);
    const properties = deployments[0][1].Properties;
    expect(properties.ServiceToken).toEqual({
      "Fn::GetAtt": [
        logicalId("AWS::Lambda::Function", (id) => id.includes("WebDeployFunction")),
        "Arn",
      ],
    });
    expect(properties.DestinationBucket).toEqual({
      Ref: logicalId("AWS::S3::Bucket", (id) => id.startsWith("WebBucket")),
    });
    expect(properties.DistributionId).toEqual({
      Ref: logicalId("AWS::CloudFront::Distribution", () => true),
    });
    expect(properties.Config).toEqual({
      Region: "us-east-1",
      UserPoolId: { Ref: logicalId("AWS::Cognito::UserPool", () => true) },
      UserPoolClientId: { Ref: logicalId("AWS::Cognito::UserPoolClient", () => true) },
    });
    expect((properties.Files as { Key: string }[]).map((file) => file.Key)).toEqual([
      "index.html",
      "app.js",
      "styles.css",
    ]);
    expect(properties.InvalidationPaths).toEqual([
      "/index.html",
      "/config.json",
      "/app.js",
      "/styles.css",
    ]);
  });

  it("runs the handler on Node.js 22.x with its own 14-day retained log group", () => {
    template().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "team32-ceb-web-deploy",
      Runtime: "nodejs22.x",
      Timeout: 600,
      LoggingConfig: {
        LogGroup: {
          Ref: logicalId("AWS::Logs::LogGroup", (id) => id.includes("WebDeploymentLogs")),
        },
      },
    });
    const [, logGroup] = resourcesOfType("AWS::Logs::LogGroup").find(
      ([, resource]) => resource.Properties.LogGroupName === "team32-ceb-web-deployment",
    ) ?? ["", undefined];
    expect(logGroup?.Properties.RetentionInDays).toBe(14);
    expect(logGroup?.DeletionPolicy).toBe("Retain");
    // No Lambda in the stack, including CDK helpers, may run anything but Node.js 22.x.
    for (const [id, fn] of resourcesOfType("AWS::Lambda::Function")) {
      expect({ id, runtime: fn.Properties.Runtime }).toEqual({ id, runtime: "nodejs22.x" });
    }
  });

  it("grants least-privilege access: exact asset objects, web bucket objects, one distribution", () => {
    const roleId = logicalId("AWS::IAM::Role", (id) => id.includes("WebDeployRuntimeRole"));
    template().hasResourceProperties("AWS::IAM::Role", {
      RoleName: "team32-ceb-web-deploy-runtime",
    });
    const [, policy] = resourcesOfType("AWS::IAM::Policy").find(([, resource]) =>
      JSON.stringify(resource.Properties.Roles).includes(roleId),
    ) ?? ["", undefined];
    const statements = (
      policy?.Properties.PolicyDocument as { Statement: { Action: unknown; Resource: unknown }[] }
    ).Statement;
    const byAction = (action: string) =>
      statements.find((statement) => [statement.Action].flat().includes(action));
    expect(byAction("s3:GetObject")?.Resource).toHaveLength(3);
    expect(JSON.stringify(byAction("s3:GetObject")?.Resource)).not.toContain('/*"');
    expect(byAction("s3:PutObject")?.Action).toEqual(["s3:PutObject", "s3:DeleteObject"]);
    expect(JSON.stringify(byAction("s3:PutObject")?.Resource)).toContain("WebBucket");
    expect(byAction("cloudfront:CreateInvalidation")?.Action).toEqual([
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]);
    expect(JSON.stringify(byAction("cloudfront:CreateInvalidation")?.Resource)).toContain(
      ":distribution/",
    );
    const flattened = JSON.stringify(statements);
    expect(flattened).not.toMatch(/"Resource":"\*"|"s3:\*"|"cloudfront:\*"/);
  });

  it("tags every new C4 resource with project=team32-ceb", () => {
    const c4 = Object.entries(template().toJSON().Resources as Record<string, CfnResource>).filter(
      ([id]) => id.startsWith("WebUi"),
    );
    const tagged = c4.filter(([, resource]) => resource.Properties?.Tags !== undefined);
    expect(tagged.map(([, resource]) => resource.Type).sort()).toEqual([
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Logs::LogGroup",
    ]);
    for (const [id, resource] of tagged) {
      const tags = resource.Properties.Tags as { Key: string; Value: string }[];
      expect({ id, tag: tags.find(({ Key }) => Key === "project")?.Value }).toEqual({
        id,
        tag: "team32-ceb",
      });
    }
  });

  it("puts ui/ sources in the prohibited-token scan scope", () => {
    expect(isCandidate("ui/src/main.ts")).toBe(true);
    expect(isCandidate("ui/styles.css")).toBe(true);
    expect(isCandidate("ui/index.html")).toBe(true);
  });
});
