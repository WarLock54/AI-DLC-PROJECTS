// NFR9: deterministic monthly cost model. Every figure is a named constant or a
// scenario input, so the estimate is reproducible and reviewable. Prices are
// assumed us-east-1 list prices without any free tier (conservative); they are
// inputs to be re-checked in the AWS Pricing Calculator, not measurements.
import { redact } from "./redact.js";

export const COST_TARGET_USD = 30;
/** Safety margin applied on top of the line-item subtotal. */
export const CONTINGENCY_RATE = 0.25;

export const PRICES = {
  lambdaPerMillionRequests: 0.2,
  lambdaPerGbSecond: 0.0000166667,
  httpApiPerMillionRequests: 1.0,
  dynamoPerMillionWriteUnits: 0.625,
  dynamoPerMillionReadUnits: 0.125,
  dynamoStoragePerGbMonth: 0.25,
  dynamoPitrPerGbMonth: 0.2,
  s3StoragePerGbMonth: 0.023,
  s3PerThousandGets: 0.0004,
  s3PerThousandPuts: 0.005,
  cloudFrontPerGbTransfer: 0.085,
  cloudFrontPerTenThousandHttpsRequests: 0.01,
  sqsPerMillionRequests: 0.4,
  logsIngestPerGb: 0.5,
  logsStoragePerGbMonth: 0.03,
  alarmPerMonth: 0.1,
  secretPerMonth: 0.4,
  secretsPer10kApiCalls: 0.05,
  schedulerPerMillionInvocations: 1.0,
  snsPerMillionPublishes: 0.5,
  cognitoPerMonthlyActiveUser: 0.015,
  sesPerThousandEmails: 0.1,
} as const;

export interface CostScenario {
  name: string;
  apiRequestsPerMonth: number;
  lambdaMemoryGb: number;
  lambdaAverageSeconds: number;
  backgroundLambdaInvocations: number;
  dynamoWriteUnits: number;
  dynamoReadUnits: number;
  dynamoStorageGb: number;
  s3StorageGb: number;
  s3GetRequests: number;
  s3PutRequests: number;
  cloudFrontTransferGb: number;
  cloudFrontHttpsRequests: number;
  reminderMessages: number;
  logIngestGb: number;
  alarms: number;
  secrets: number;
  secretApiCalls: number;
  schedulerInvocations: number;
  alarmNotifications: number;
  monthlyActiveUsers: number;
  /** Real SES sends happen in the debug sandbox only; the final sandbox logs reminders. */
  sesEmails: number;
}

/** Expected traffic: a small community site, about 200 000 API requests a month. */
export const EXPECTED_TRAFFIC: CostScenario = {
  name: "Expected community traffic",
  apiRequestsPerMonth: 200_000,
  lambdaMemoryGb: 0.25,
  lambdaAverageSeconds: 0.15,
  backgroundLambdaInvocations: 3_000,
  dynamoWriteUnits: 40_000,
  dynamoReadUnits: 400_000,
  dynamoStorageGb: 1,
  s3StorageGb: 5,
  s3GetRequests: 150_000,
  s3PutRequests: 1_000,
  cloudFrontTransferGb: 20,
  cloudFrontHttpsRequests: 400_000,
  reminderMessages: 2_000,
  logIngestGb: 3,
  alarms: 7,
  secrets: 1,
  secretApiCalls: 5_000,
  schedulerInvocations: 2_900,
  alarmNotifications: 100,
  monthlyActiveUsers: 500,
  sesEmails: 0,
};

export interface CostLineItem {
  id: string;
  label: string;
  basis: string;
  justification: string;
  monthlyUsd: number;
}

export interface CostEstimate {
  scenario: CostScenario;
  lineItems: CostLineItem[];
  subtotalUsd: number;
  contingencyUsd: number;
  totalUsd: number;
  targetUsd: number;
  withinTarget: boolean;
}

const perMillion = (count: number, price: number): number => (count / 1_000_000) * price;

export function estimateMonthlyCost(
  scenario: CostScenario,
  prices: typeof PRICES = PRICES,
): CostEstimate {
  for (const [key, value] of Object.entries(scenario)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Scenario value ${key} must be a non-negative finite number.`);
    }
  }
  const invocations = scenario.apiRequestsPerMonth + scenario.backgroundLambdaInvocations;
  const gbSeconds = invocations * scenario.lambdaMemoryGb * scenario.lambdaAverageSeconds;
  const logStorageGb = scenario.logIngestGb * (14 / 30);
  const items: CostLineItem[] = [
    {
      id: "lambda",
      label: "AWS Lambda",
      basis: `${invocations} invocations, ${gbSeconds.toFixed(0)} GB-seconds`,
      justification: "Pay per request and idle at zero; no servers to size or patch.",
      monthlyUsd:
        perMillion(invocations, prices.lambdaPerMillionRequests) +
        gbSeconds * prices.lambdaPerGbSecond,
    },
    {
      id: "api-gateway",
      label: "API Gateway HTTP API",
      basis: `${scenario.apiRequestsPerMonth} requests`,
      justification: "HTTP API costs about a third of REST API and includes the JWT authorizer.",
      monthlyUsd: perMillion(scenario.apiRequestsPerMonth, prices.httpApiPerMillionRequests),
    },
    {
      id: "dynamodb",
      label: "DynamoDB on-demand",
      basis: `${scenario.dynamoWriteUnits} write units, ${scenario.dynamoReadUnits} read units, ${scenario.dynamoStorageGb} GB with point-in-time recovery`,
      justification: "On-demand billing avoids provisioned capacity for a spiky, low-volume table.",
      monthlyUsd:
        perMillion(scenario.dynamoWriteUnits, prices.dynamoPerMillionWriteUnits) +
        perMillion(scenario.dynamoReadUnits, prices.dynamoPerMillionReadUnits) +
        scenario.dynamoStorageGb * (prices.dynamoStoragePerGbMonth + prices.dynamoPitrPerGbMonth),
    },
    {
      id: "s3",
      label: "Amazon S3",
      basis: `${scenario.s3StorageGb} GB, ${scenario.s3GetRequests} GET, ${scenario.s3PutRequests} PUT`,
      justification: "Static UI, banners, and archive objects are cheap object storage.",
      monthlyUsd:
        scenario.s3StorageGb * prices.s3StoragePerGbMonth +
        (scenario.s3GetRequests / 1000) * prices.s3PerThousandGets +
        (scenario.s3PutRequests / 1000) * prices.s3PerThousandPuts,
    },
    {
      id: "cloudfront",
      label: "Amazon CloudFront",
      basis: `${scenario.cloudFrontTransferGb} GB transfer, ${scenario.cloudFrontHttpsRequests} HTTPS requests`,
      justification: "One HTTPS origin for UI and API; caching keeps origin traffic low.",
      monthlyUsd:
        scenario.cloudFrontTransferGb * prices.cloudFrontPerGbTransfer +
        (scenario.cloudFrontHttpsRequests / 10_000) * prices.cloudFrontPerTenThousandHttpsRequests,
    },
    {
      id: "sqs",
      label: "Amazon SQS",
      basis: `${scenario.reminderMessages} reminder messages (send, receive, delete)`,
      justification: "Decouples reminder delivery with retries and a dead-letter queue.",
      monthlyUsd: perMillion(scenario.reminderMessages * 3, prices.sqsPerMillionRequests),
    },
    {
      id: "cloudwatch",
      label: "CloudWatch Logs and alarms",
      basis: `${scenario.logIngestGb} GB ingested, 14-day retention, ${scenario.alarms} alarms`,
      justification:
        "14-day retention (NFR31) bounds log storage; seven alarms cover the approved signals.",
      monthlyUsd:
        scenario.logIngestGb * prices.logsIngestPerGb +
        logStorageGb * prices.logsStoragePerGbMonth +
        scenario.alarms * prices.alarmPerMonth,
    },
    {
      id: "secrets-manager",
      label: "AWS Secrets Manager",
      basis: `${scenario.secrets} secret, ${scenario.secretApiCalls} API calls`,
      justification: "Holds generated demo credentials so none are committed or printed.",
      monthlyUsd:
        scenario.secrets * prices.secretPerMonth +
        (scenario.secretApiCalls / 10_000) * prices.secretsPer10kApiCalls,
    },
    {
      id: "scheduler",
      label: "EventBridge Scheduler",
      basis: `${scenario.schedulerInvocations} invocations (15-minute reminders, daily archival)`,
      justification: "Managed schedules replace an always-on scheduler.",
      monthlyUsd: perMillion(scenario.schedulerInvocations, prices.schedulerPerMillionInvocations),
    },
    {
      id: "sns",
      label: "Amazon SNS",
      basis: `${scenario.alarmNotifications} alarm notifications`,
      justification: "Alarm fan-out; email delivery is free at this volume.",
      monthlyUsd: perMillion(scenario.alarmNotifications, prices.snsPerMillionPublishes),
    },
    {
      id: "cognito",
      label: "Amazon Cognito",
      basis: `${scenario.monthlyActiveUsers} monthly active users (no free tier assumed)`,
      justification: "Managed organizer and admin sign-in without running an identity service.",
      monthlyUsd: scenario.monthlyActiveUsers * prices.cognitoPerMonthlyActiveUser,
    },
    {
      id: "ses",
      label: "Amazon SES",
      basis: `${scenario.sesEmails} emails (final sandbox logs reminders; SES is a debug-sandbox proof)`,
      justification: "Used only for the debug-sandbox delivery proof.",
      monthlyUsd: (scenario.sesEmails / 1000) * prices.sesPerThousandEmails,
    },
  ];
  const subtotalUsd = items.reduce((sum, item) => sum + item.monthlyUsd, 0);
  const contingencyUsd = subtotalUsd * CONTINGENCY_RATE;
  const totalUsd = subtotalUsd + contingencyUsd;
  return {
    scenario,
    lineItems: items,
    subtotalUsd,
    contingencyUsd,
    totalUsd,
    targetUsd: COST_TARGET_USD,
    withinTarget: totalUsd < COST_TARGET_USD,
  };
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

export function renderCostNotes(estimate: CostEstimate): string {
  const lines = [
    "# Cost notes",
    "",
    `**Estimate: ${usd(estimate.totalUsd)} per month against a target of under ${usd(estimate.targetUsd)} (${estimate.withinTarget ? "within target" : "TARGET BREACHED"}).**`,
    "",
    `Scenario: ${estimate.scenario.name}. Generated by \`npm run evidence:cost-notes\` from \`scripts/evidence/cost-model.ts\`; edit the model, not this file (NFR9).`,
    "",
    "## Assumptions",
    "",
    "- Region `us-east-1`; assumed list prices without any free tier, so the estimate is conservative. The prices are named constants in the model and should be re-checked in the AWS Pricing Calculator.",
    `- A ${CONTINGENCY_RATE * 100}% contingency margin is added to the line-item subtotal.`,
    "- The final sandbox runs in `EMAIL_MODE=log`; real SES delivery is a debug-sandbox proof only.",
    "- Load tests and teardown are debug-sandbox activities and are not part of the monthly run cost.",
    "- No NAT gateway, no always-on compute, no provisioned capacity, and no WAF are used.",
    "",
    "## Monthly line items",
    "",
    "| Service | Basis | Why it is cost-conscious | Monthly |",
    "| --- | --- | --- | --- |",
    ...estimate.lineItems.map(
      (item) =>
        `| ${item.label} | ${item.basis} | ${item.justification} | ${usd(item.monthlyUsd)} |`,
    ),
    `| Subtotal | | | ${usd(estimate.subtotalUsd)} |`,
    `| Contingency (${CONTINGENCY_RATE * 100}%) | | | ${usd(estimate.contingencyUsd)} |`,
    `| **Total** | | | **${usd(estimate.totalUsd)}** |`,
    "",
  ];
  return redact(lines.join("\n"));
}
