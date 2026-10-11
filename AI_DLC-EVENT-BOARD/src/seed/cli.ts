import { fromEnv } from "@aws-sdk/credential-providers";
import { DescribeStacksCommand, CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { AwsSeedAdapter } from "./aws-adapter.js";
import { resolveRegion } from "../config/region.js";
import { seedDemoUsers } from "./demo-users.js";
import { createSeedFixtures, validateSeedFixtures } from "./fixtures.js";
import { loadSeedFixtures } from "./loader.js";

async function main(): Promise<void> {
  const region = resolveRegion();
  requireEnvironmentCredentials();
  const stackName = process.env.C1_STACK_NAME ?? "team32-ceb-foundation";
  const cloudFormation = new CloudFormationClient({ region, credentials: fromEnv() });
  const stacks = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
  const creationTime = stacks.Stacks?.[0]?.CreationTime;
  const referenceTime = resolveSeedReferenceTime(process.env.SEED_REFERENCE_TIME, creationTime);
  const tableName = stacks.Stacks?.[0]?.Outputs?.find(
    (output) => output.OutputKey === "TableName",
  )?.OutputValue;
  const secretArn = stacks.Stacks?.[0]?.Outputs?.find(
    (output) => output.OutputKey === "DemoCredentialsSecretArn",
  )?.OutputValue;
  const userPoolId = stacks.Stacks?.[0]?.Outputs?.find(
    (output) => output.OutputKey === "UserPoolId",
  )?.OutputValue;
  if (!tableName || !secretArn || !userPoolId) {
    throw new Error(`Stack '${stackName}' is missing an approved C1 seed output.`);
  }

  const sts = new STSClient({ region, credentials: fromEnv() });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Account) {
    throw new Error("AWS credentials did not return an account identity.");
  }
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${identity.Account}:role/team32-ceb-seed-runtime`,
      RoleSessionName: "team32-ceb-seed",
    }),
  );
  if (
    !assumed.Credentials?.AccessKeyId ||
    !assumed.Credentials.SecretAccessKey ||
    !assumed.Credentials.SessionToken
  ) {
    throw new Error("The scoped seed runtime role did not return temporary credentials.");
  }

  const dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region,
      credentials: {
        accessKeyId: assumed.Credentials.AccessKeyId,
        secretAccessKey: assumed.Credentials.SecretAccessKey,
        sessionToken: assumed.Credentials.SessionToken,
      },
    }),
  );
  const assumedCredentials = {
    accessKeyId: assumed.Credentials.AccessKeyId,
    secretAccessKey: assumed.Credentials.SecretAccessKey,
    sessionToken: assumed.Credentials.SessionToken,
  };
  const secrets = new SecretsManagerClient({ region, credentials: assumedCredentials });
  const cognito = new CognitoIdentityProviderClient({ region, credentials: assumedCredentials });
  const { count: demoUserCount, organizerSubject } = await seedDemoUsers(
    new AwsSeedAdapter(secrets, cognito, secretArn, userPoolId),
  );
  const fixtures = createSeedFixtures({ organizerSubject, clock: () => referenceTime });
  validateSeedFixtures(fixtures);
  const count = await loadSeedFixtures({
    tableName,
    items: fixtures,
    client: dynamo,
  });
  console.info(JSON.stringify({ message: "Seed completed.", itemCount: count, demoUserCount }));
}

export function resolveSeedReferenceTime(
  value: string | undefined,
  creationTime: Date | undefined,
): Date {
  if (value === undefined) {
    if (!creationTime || !Number.isFinite(creationTime.getTime())) {
      throw new Error(
        "Seed reference time is missing; provide SEED_REFERENCE_TIME or a stack CreationTime.",
      );
    }
    return creationTime;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("SEED_REFERENCE_TIME must be a canonical millisecond UTC timestamp.");
  }
  return parsed;
}

function requireEnvironmentCredentials(): void {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for seed loading.");
  }
  if (process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE) {
    throw new Error("AWS profile configuration is not supported; use environment credentials.");
  }
}

const entrypoint = process.argv[1]?.replaceAll("\\", "/");
if (entrypoint?.endsWith("/src/seed/cli.ts") || entrypoint?.endsWith("/src/seed/cli.js")) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown seed loading failure.";
    console.error(`Seed loading failed: ${message}`);
    process.exitCode = 1;
  });
}
