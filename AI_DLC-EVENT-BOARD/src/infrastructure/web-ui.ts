// C4 web UI delivery (owner: Onur).
//
// - buildWebUi (D2): bundles ui/src/main.ts with the pinned esbuild together
//   with index.html and styles.css. A build error throws with esbuild's
//   message, so synthesis can never pass with a broken UI.
// - createSpaRewriteFunction (D4): viewer-request CloudFront Function that
//   serves index.html for client-side routes on the default behavior.
// - WebUi (D3): publishes the build into the web bucket through a Node.js 22.x
//   custom resource. Human decision (Onur, 2026-10-06): CDK BucketDeployment's
//   helper runs Python 3.13, conflicting with NFR3 and the C1 Node.js 22.x
//   test, so it is replaced by this custom resource. The handler is the
//   service token itself; no Provider framework Lambda is added.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Aws, CustomResource, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { buildSync } from "esbuild";
import { SPA_REWRITE_FUNCTION_NAME, SPA_REWRITE_FUNCTION_SOURCE } from "./spa-rewrite.js";

export const WEB_UI_BUILD_ROOT = join("cdk.out", ".team32-ceb-web-ui");
export const WEB_UI_FILES = ["index.html", "app.js", "styles.css"] as const;
export const WEB_UI_INVALIDATION_PATHS = ["/index.html", "/config.json", "/app.js", "/styles.css"];
export const WEB_DEPLOY_FUNCTION_NAME = "team32-ceb-web-deploy";
export const WEB_DEPLOY_LOG_GROUP_NAME = "team32-ceb-web-deployment";
export const WEB_DEPLOY_RESOURCE_TYPE = "Custom::Team32CebWebDeployment";

const REVIEW = "Owner: Onur. Review by 2027-01-03.";

export interface WebUiBuildOptions {
  /** Directory holding index.html, styles.css, and src/main.ts. */
  sourceDir?: string;
  outDir?: string;
}

let defaultBuild: string | undefined;

export function buildWebUi(options: WebUiBuildOptions = {}): string {
  const sourceDir = options.sourceDir ?? "ui";
  // One directory per process, so parallel test workers that synthesize the
  // stack never write the same files at the same time.
  const outDir = options.outDir ?? join(WEB_UI_BUILD_ROOT, String(process.pid));
  mkdirSync(outDir, { recursive: true });
  buildSync({
    entryPoints: [join(sourceDir, "src", "main.ts")],
    outfile: join(outDir, "app.js"),
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    logLevel: "silent",
  });
  for (const file of ["index.html", "styles.css"]) {
    copyFileSync(join(sourceDir, file), join(outDir, file));
  }
  return outDir;
}

/** The default build runs once per process; the output is deterministic. */
function defaultWebUiBuild(): string {
  defaultBuild ??= buildWebUi();
  return defaultBuild;
}

export function createSpaRewriteFunction(scope: Construct): cloudfront.Function {
  return new cloudfront.Function(scope, "SpaRewriteFunction", {
    functionName: SPA_REWRITE_FUNCTION_NAME,
    comment: "team32-ceb: serve index.html for client-side routes",
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(SPA_REWRITE_FUNCTION_SOURCE),
  });
}

export interface WebUiProps {
  webBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

export class WebUi extends Construct {
  public readonly deployFunction: nodejs.NodejsFunction;
  public readonly deployment: CustomResource;

  constructor(scope: Construct, id: string, props: WebUiProps) {
    super(scope, id);
    const buildDir = defaultWebUiBuild();
    const assets = WEB_UI_FILES.map(
      (file) =>
        [
          file,
          new s3assets.Asset(this, `${file.replace(/\W/g, "")}Asset`, {
            path: join(buildDir, file),
          }),
        ] as const,
    );

    const logGroup = new logs.LogGroup(this, "WebDeploymentLogs", {
      logGroupName: WEB_DEPLOY_LOG_GROUP_NAME,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const role = new iam.Role(this, "WebDeployRuntimeRole", {
      roleName: `${WEB_DEPLOY_FUNCTION_NAME}-runtime`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Runtime role for the C4 web UI deployment custom resource.",
    });
    logGroup.grantWrite(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: assets.map(
          ([, asset]) => `arn:${Aws.PARTITION}:s3:::${asset.s3BucketName}/${asset.s3ObjectKey}`,
        ),
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:DeleteObject"],
        resources: [props.webBucket.arnForObjects("*")],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
        resources: [
          `arn:${Aws.PARTITION}:cloudfront::${Aws.ACCOUNT_ID}:distribution/${props.distribution.distributionId}`,
        ],
      }),
    );

    this.deployFunction = new nodejs.NodejsFunction(this, "WebDeployFunction", {
      functionName: WEB_DEPLOY_FUNCTION_NAME,
      description: "Publishes the C4 web UI and config.json into the web bucket.",
      entry: "src/lambda/web-deploy/handler.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      // The handler waits up to 5 minutes for the CloudFront invalidation.
      timeout: Duration.minutes(10),
      memorySize: 256,
      role,
      logGroup,
      bundling: {
        minify: true,
        sourceMap: false,
        // Bundle the pinned AWS SDK v3 packages, like the C3 functions.
        externalModules: [],
      },
    });

    this.deployment = new CustomResource(this, "WebDeployment", {
      serviceToken: this.deployFunction.functionArn,
      resourceType: WEB_DEPLOY_RESOURCE_TYPE,
      properties: {
        DestinationBucket: props.webBucket.bucketName,
        DistributionId: props.distribution.distributionId,
        Files: assets.map(([file, asset]) => ({
          Key: file,
          SourceBucket: asset.s3BucketName,
          SourceKey: asset.s3ObjectKey,
        })),
        Config: {
          Region: Stack.of(this).region,
          UserPoolId: props.userPool.userPoolId,
          UserPoolClientId: props.userPoolClient.userPoolClientId,
        },
        InvalidationPaths: WEB_UI_INVALIDATION_PATHS,
      },
    });
    // Run only after the role's policy exists.
    this.deployment.node.addDependency(role);

    NagSuppressions.addResourceSuppressions(
      this.deployFunction,
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
          reason: `CloudWatch Logs requires the log-stream wildcard for Lambda writes; it is bounded to the single ${WEB_DEPLOY_LOG_GROUP_NAME} log group. The web bucket object wildcard lets the deployment publish the UI and prune objects it wrote before; the bucket holds only these UI files. ${REVIEW}`,
          appliesTo: [
            { regex: "/^Resource::<.*WebDeploymentLogs[A-F0-9]+\\.Arn>:\\*$/g" },
            { regex: "/^Resource::<WebBucket[A-F0-9]+\\.Arn>\\/\\*$/g" },
          ],
        },
      ],
      true,
    );
  }
}
