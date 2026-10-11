import { requireDeploymentEnvironment } from "./aws-environment.js";
import { runCdk } from "./cdk-cli.js";

const FOUNDATION_STACK = "team32-ceb-foundation";
const ASYNC_MONITORING_STACK = "team32-ceb-async-monitoring";
const OUTPUTS_FILE = "cdk-outputs.json";

// C-01: the exact output set each stack owns. Order is the deployment order.
const STACK_OUTPUTS: ReadonlyArray<{ stack: string; unit: string; outputs: ReadonlySet<string> }> =
  [
    {
      stack: FOUNDATION_STACK,
      unit: "C1",
      outputs: new Set([
        "SiteUrl",
        "ApiBaseUrl",
        "UserPoolId",
        "UserPoolClientId",
        "WebBucketName",
        "DistributionId",
        "BannerBucketName",
        "TableName",
        "ArchiveBucketName",
        // C5 (C-06): the archival function the pipeline invokes after deploy.
        "ArchiveFunctionName",
        "DemoCredentialsSecretArn",
        "Region",
      ]),
    },
    {
      stack: ASYNC_MONITORING_STACK,
      unit: "C6",
      outputs: new Set(["ReminderQueueUrl", "AlarmTopicArn"]),
    },
  ];

// CDK adds `ExportsOutput*` outputs for cross-stack references (for example the
// HTTP API id the C6 alarms import). They are not part of the C-01 contract.
const CDK_CROSS_STACK_EXPORT_PREFIX = "ExportsOutput";

async function deploy(): Promise<void> {
  const { account, region } = await requireDeploymentEnvironment();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CDK_DEFAULT_ACCOUNT: account,
    CDK_DEFAULT_REGION: region,
  };
  delete environment.AWS_PROFILE;
  delete environment.AWS_DEFAULT_PROFILE;

  runCdk(["bootstrap", `aws://${account}/${region}`], environment);
  // CDK deploys the foundation first because the C6 stack depends on it.
  runCdk(
    [
      "deploy",
      ...STACK_OUTPUTS.map(({ stack }) => stack),
      "--require-approval",
      "never",
      "--outputs-file",
      OUTPUTS_FILE,
    ],
    environment,
  );
  const { readFile } = await import("node:fs/promises");
  const allOutputs = JSON.parse(await readFile(OUTPUTS_FILE, "utf8")) as Record<
    string,
    Record<string, string> | undefined
  >;
  for (const { stack, unit, outputs } of STACK_OUTPUTS) {
    verifyOutputSet(stack, unit, outputs, allOutputs[stack]);
  }
  const foundation = allOutputs[FOUNDATION_STACK] as Record<string, string>;
  if (
    foundation.Region !== region ||
    !foundation.SiteUrl ||
    foundation.ApiBaseUrl !== foundation.SiteUrl
  ) {
    throw new Error("Deployed C-01 region or CloudFront URL outputs are inconsistent.");
  }
  console.info(
    "C1 foundation and C6 async-monitoring deployment and output verification succeeded.",
  );
}

function verifyOutputSet(
  stack: string,
  unit: string,
  expected: ReadonlySet<string>,
  output: Record<string, string> | undefined,
): void {
  if (!output) {
    throw new Error(`Deployment did not produce outputs for ${stack}.`);
  }
  const actualKeys = Object.keys(output)
    .filter((key) => !key.startsWith(CDK_CROSS_STACK_EXPORT_PREFIX))
    .sort();
  const expectedKeys = [...expected].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `Deployed ${unit} output names do not match the approved ${unit}-owned C-01 output set.`,
    );
  }
  const emptyKeys = expectedKeys.filter((key) => !output[key]);
  if (emptyKeys.length > 0) {
    throw new Error(`Deployed ${unit} outputs are empty: ${emptyKeys.join(", ")}.`);
  }
}

deploy().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown deployment failure.";
  console.error(`Deployment failed: ${message}`);
  process.exitCode = 1;
});
