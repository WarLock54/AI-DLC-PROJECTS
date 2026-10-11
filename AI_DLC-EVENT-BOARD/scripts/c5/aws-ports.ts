// Real AWS and HTTP adapters for the C5 post-deploy scripts. Credentials come
// only from the CI environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
// AWS_DEFAULT_REGION); nothing here prints a secret, password, or token.
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { fromEnv } from "@aws-sdk/credential-providers";
import { AuthenticationDetails, CognitoUser, CognitoUserPool } from "amazon-cognito-identity-js";
import { resolveRegion } from "../../src/config/region.js";
import type { ArchiveInvokePorts, HttpResult } from "./archive-evidence.js";
import type { StatsCheckPorts } from "./stats-comparison.js";

const TIMEOUT_MS = 15_000;

function requireEnvironmentCredentials(): { region: string } {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in the environment.");
  }
  if (process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE) {
    throw new Error("AWS profile configuration is prohibited; supply environment credentials.");
  }
  return { region: resolveRegion() };
}

async function getJson(url: URL, headers: Record<string, string> = {}): Promise<HttpResult> {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export function createArchiveInvokePorts(): ArchiveInvokePorts {
  const { region } = requireEnvironmentCredentials();
  const lambda = new LambdaClient({ region, credentials: fromEnv() });
  const s3 = new S3Client({ region, credentials: fromEnv() });
  return {
    invokeArchival: async (functionName, payload) => {
      const result = await lambda.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: "RequestResponse",
          Payload: new TextEncoder().encode(JSON.stringify(payload)),
        }),
      );
      if (result.FunctionError) {
        // Only the error kind is reported; the payload may carry stack detail.
        throw new Error(`The archival function failed (${result.FunctionError}).`);
      }
      const text = new TextDecoder().decode(result.Payload ?? new Uint8Array());
      return JSON.parse(text) as unknown;
    },
    readObject: async (bucket, key) => {
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await result.Body?.transformToString("utf8");
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey") {
          return undefined;
        }
        throw error;
      }
    },
    getJson: (url) => getJson(url),
    log: (line) => console.info(line),
  };
}

export function createStatsCheckPorts(): StatsCheckPorts {
  const { region } = requireEnvironmentCredentials();
  const secrets = new SecretsManagerClient({ region, credentials: fromEnv() });
  return {
    readAdminPassword: async (secretArn) => {
      const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.SecretString ?? "");
      } catch {
        throw new Error("The demo credential secret is not valid JSON.");
      }
      const password = (parsed as { adminPassword?: unknown } | null)?.adminPassword;
      if (typeof password !== "string" || password === "") {
        throw new Error("The demo credential secret has no admin password; run the seed first.");
      }
      return password;
    },
    signIn: ({ userPoolId, clientId, username, password }) =>
      new Promise((resolve, reject) => {
        const pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
        const user = new CognitoUser({ Username: username, Pool: pool });
        const fail = (reason: string) => () =>
          reject(new Error(`Admin sign-in did not complete: ${reason}.`));
        user.authenticateUser(
          new AuthenticationDetails({ Username: username, Password: password }),
          {
            onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
            onFailure: (error: unknown) => {
              const name =
                (error as { code?: unknown; name?: unknown } | null)?.code ??
                (error as { name?: unknown } | null)?.name;
              reject(
                new Error(`Admin sign-in failed (${typeof name === "string" ? name : "error"}).`),
              );
            },
            newPasswordRequired: fail("a new password is required"),
            mfaRequired: fail("MFA is required"),
            totpRequired: fail("TOTP is required"),
            customChallenge: fail("a custom challenge is required"),
            mfaSetup: fail("MFA setup is required"),
            selectMFAType: fail("an MFA type must be selected"),
          },
        );
      }),
    getStats: (url, idToken) => getJson(url, { authorization: `Bearer ${idToken}` }),
    log: (line) => console.info(line),
  };
}
