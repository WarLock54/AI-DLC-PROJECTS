// Thin AWS SDK and HTTP adapters for the debug-sandbox evidence CLIs. They contain
// no decision logic and are exercised only in the debug sandbox. Credentials come
// from the environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, optional debug
// AWS_SESSION_TOKEN); nothing here prints a secret, password, or token.
import {
  CloudWatchClient,
  GetMetricDataCommand,
  ListMetricsCommand,
  type MetricDataQuery,
} from "@aws-sdk/client-cloudwatch";
import { CloudFormationClient, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetEmailIdentityCommand, SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { fromEnv } from "@aws-sdk/credential-providers";
import { AuthenticationDetails, CognitoUser, CognitoUserPool } from "amazon-cognito-identity-js";
import { resolveRegion } from "../../src/config/region.js";
import type { CloudWatchEvidence } from "./metrics.js";
import type { ClockPort, HttpPort, HttpRequest, HttpResponse } from "./load-runner.js";
import type { SesProofPorts } from "./ses-proof.js";

const HTTP_TIMEOUT_MS = 15_000;
const STACK_PREFIX = "team32-ceb-";
const PROJECT_TAG_KEY = "project";
const PROJECT_TAG_VALUE = "team32-ceb";
const ORGANIZER_USERNAME = "organizer@example.com";
const HTTP_API_STAGE = "$default";

export function requireEnvironmentCredentials(): { region: string } {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in the environment.");
  }
  if (process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE) {
    throw new Error("AWS profile configuration is prohibited; supply environment credentials.");
  }
  return { region: resolveRegion() };
}

export function createRealClock(): ClockPort {
  return {
    nowMs: () => performance.now() + performance.timeOrigin,
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
  };
}

/** HTTP adapter over global fetch. A network failure or timeout rejects. */
export function createHttpPort(baseUrl: URL): HttpPort {
  return {
    send: async (request: HttpRequest): Promise<HttpResponse> => {
      const started = performance.now();
      const response = await fetch(new URL(request.path, baseUrl), {
        method: request.method,
        headers: {
          accept: "application/json",
          ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          ...request.headers,
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const text = await response.text();
      const latencyMs = performance.now() - started;
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: response.status, body, latencyMs };
    },
  };
}

/** Signs in the seeded organizer; the password is read from Secrets Manager and never printed. */
export async function signInSeededOrganizer(options: {
  region: string;
  userPoolId: string;
  clientId: string;
  secretArn: string;
}): Promise<string> {
  const secrets = new SecretsManagerClient({ region: options.region, credentials: fromEnv() });
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: options.secretArn }));
  let password: unknown;
  try {
    password = (JSON.parse(secret.SecretString ?? "") as { organizerPassword?: unknown })
      .organizerPassword;
  } catch {
    throw new Error("The demo credential secret is not valid JSON.");
  }
  if (typeof password !== "string" || password === "") {
    throw new Error("The demo credential secret has no organizer password; run the seed first.");
  }
  const pool = new CognitoUserPool({ UserPoolId: options.userPoolId, ClientId: options.clientId });
  const user = new CognitoUser({ Username: ORGANIZER_USERNAME, Pool: pool });
  return new Promise<string>((resolve, reject) => {
    const fail = (reason: string) => () =>
      reject(new Error(`Organizer sign-in did not complete: ${reason}.`));
    user.authenticateUser(
      new AuthenticationDetails({ Username: ORGANIZER_USERNAME, Password: password as string }),
      {
        onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
        onFailure: (error: unknown) => {
          const name =
            (error as { code?: unknown } | null)?.code ??
            (error as { name?: unknown } | null)?.name;
          reject(
            new Error(`Organizer sign-in failed (${typeof name === "string" ? name : "error"}).`),
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
  });
}

export interface CloudWatchWindow {
  start: Date;
  end: Date;
}

/** Reads API Gateway latency p95, API Gateway 5xx, and Lambda throttles for the test window. */
export async function readCloudWatchEvidence(
  region: string,
  window: CloudWatchWindow,
  apiIdOverride: string | undefined,
): Promise<CloudWatchEvidence> {
  const client = new CloudWatchClient({ region, credentials: fromEnv() });
  const apiId = apiIdOverride ?? (await discoverApiId(client));
  const dimensions = [
    { Name: "ApiId", Value: apiId },
    { Name: "Stage", Value: HTTP_API_STAGE },
  ];
  const queries: MetricDataQuery[] = [
    {
      Id: "latency",
      MetricStat: {
        Metric: { Namespace: "AWS/ApiGateway", MetricName: "Latency", Dimensions: dimensions },
        Period: 60,
        Stat: "p95",
      },
    },
    {
      Id: "errors5xx",
      MetricStat: {
        Metric: { Namespace: "AWS/ApiGateway", MetricName: "5xx", Dimensions: dimensions },
        Period: 60,
        Stat: "Sum",
      },
    },
    {
      Id: "throttles",
      MetricStat: {
        // No dimensions: the aggregate covers every solution Lambda (as the C6 alarm does).
        Metric: { Namespace: "AWS/Lambda", MetricName: "Throttles" },
        Period: 60,
        Stat: "Sum",
      },
    },
  ];
  const values: Record<string, number[]> = { latency: [], errors5xx: [], throttles: [] };
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: window.start,
        EndTime: window.end,
        NextToken: nextToken,
      }),
    );
    for (const result of page.MetricDataResults ?? []) {
      if (result.Id && result.Id in values) {
        values[result.Id].push(...(result.Values ?? []));
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);

  const sum = (list: number[]): number => list.reduce((total, value) => total + value, 0);
  return {
    apiLatencyP95Ms: values.latency.length > 0 ? Math.max(...values.latency) : null,
    api5xxCount: values.errors5xx.length > 0 ? sum(values.errors5xx) : 0,
    // Lambda publishes no datapoint when nothing was throttled; that is zero throttles
    // only if the function did run, which the load test guarantees.
    lambdaThrottles: sum(values.throttles),
  };
}

async function discoverApiId(client: CloudWatchClient): Promise<string> {
  const ids = new Set<string>();
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListMetricsCommand({
        Namespace: "AWS/ApiGateway",
        MetricName: "Latency",
        Dimensions: [{ Name: "Stage", Value: HTTP_API_STAGE }],
        NextToken: nextToken,
      }),
    );
    for (const metric of page.Metrics ?? []) {
      const id = metric.Dimensions?.find((dimension) => dimension.Name === "ApiId")?.Value;
      if (id) {
        ids.add(id);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);
  if (ids.size !== 1) {
    throw new Error(
      `Found ${ids.size} HTTP APIs with Latency metrics; set LOAD_TEST_API_ID to the solution API id.`,
    );
  }
  return [...ids][0];
}

export function createSesPorts(options: {
  region: string;
  selectorFunctionName?: string;
}): SesProofPorts {
  const ses = new SESv2Client({ region: options.region, credentials: fromEnv() });
  const lambda = new LambdaClient({ region: options.region, credentials: fromEnv() });

  const verified = async (identity: string): Promise<boolean> => {
    try {
      const result = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: identity }));
      return result.VerifiedForSendingStatus === true;
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundException") {
        return false;
      }
      throw error;
    }
  };

  return {
    isIdentityVerified: async (address) => {
      if (await verified(address)) {
        return true;
      }
      // A verified domain identity also covers the address.
      return verified(address.slice(address.indexOf("@") + 1));
    },
    sendReminderEmail: async ({ sender, recipient }) => {
      const result = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: sender,
          Destination: { ToAddresses: [recipient] },
          Content: {
            Simple: {
              Subject: { Data: "Reminder: your Community Event Board event starts soon" },
              Body: {
                Text: {
                  Data: "This is a debug-sandbox proof that reminder email delivery works. No action is needed.",
                },
              },
            },
          },
        }),
      );
      if (!result.MessageId) {
        throw new Error("SES did not return a message ID.");
      }
      return { messageId: result.MessageId };
    },
    invokeReminderSelector: options.selectorFunctionName
      ? async () => {
          const result = await lambda.send(
            new InvokeCommand({
              FunctionName: options.selectorFunctionName,
              InvocationType: "RequestResponse",
              Payload: new TextEncoder().encode("{}"),
            }),
          );
          if (result.FunctionError) {
            throw new Error(`The reminder selector failed (${result.FunctionError}).`);
          }
        }
      : undefined,
    nowIso: () => new Date().toISOString(),
  };
}

/** Independent post-teardown inventory: remaining stacks and tagged resources (NFR30). */
export async function readLiveCleanupState(
  region: string,
): Promise<{ remainingStacks: string[]; taggedResourceCount: number }> {
  const cloudFormation = new CloudFormationClient({ region, credentials: fromEnv() });
  const tagging = new ResourceGroupsTaggingAPIClient({ region, credentials: fromEnv() });
  const stacks: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await cloudFormation.send(new ListStacksCommand({ NextToken: nextToken }));
    for (const summary of page.StackSummaries ?? []) {
      if (
        summary.StackName?.startsWith(STACK_PREFIX) &&
        summary.StackStatus !== "DELETE_COMPLETE"
      ) {
        stacks.push(summary.StackName);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);

  let count = 0;
  let paginationToken: string | undefined;
  do {
    const page = await tagging.send(
      new GetResourcesCommand({
        TagFilters: [{ Key: PROJECT_TAG_KEY, Values: [PROJECT_TAG_VALUE] }],
        PaginationToken: paginationToken || undefined,
      }),
    );
    count += page.ResourceTagMappingList?.length ?? 0;
    paginationToken = page.PaginationToken;
  } while (paginationToken);
  return { remainingStacks: stacks, taggedResourceCount: count };
}
