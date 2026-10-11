import { fromEnv } from "@aws-sdk/credential-providers";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { resolveRegion } from "../src/config/region.js";

export async function requireDeploymentEnvironment(): Promise<{
  region: string;
  account: string;
}> {
  const region = resolveRegion();
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in the environment.");
  }
  if (process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE) {
    throw new Error("AWS profile configuration is prohibited; supply environment credentials.");
  }

  const identity = await new STSClient({ region, credentials: fromEnv() }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!identity.Account) {
    throw new Error("AWS credentials did not return an account identity.");
  }
  return { region, account: identity.Account };
}
