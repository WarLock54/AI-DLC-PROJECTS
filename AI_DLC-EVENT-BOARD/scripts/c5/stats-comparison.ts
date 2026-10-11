// FR8.5 post-deploy statistics smoke test (Q4 A, working Group C decision):
// RSVP-derived fields must equal docs/expected-stats.json exactly; view counts
// must be integers at or above the documented lower bound. Prints status and
// counts only, never the password or the token.
import type { HttpResult } from "./archive-evidence.js";
import { requireHttpsSiteUrl } from "./outputs.js";

export const ADMIN_USERNAME = "admin@example.com";

export interface ExpectedStats {
  exact: {
    totalRsvps: number;
    popularCategories: { category: string; count: number }[];
  };
  lowerBound: { pageViews: number; detailViews: number };
}

export interface StatsCheckPorts {
  /** The seeded admin password from the demo-credentials secret. Never logged. */
  readAdminPassword(secretArn: string): Promise<string>;
  /** Cognito SRP sign-in; returns the ID token. Never logged. */
  signIn(input: {
    userPoolId: string;
    clientId: string;
    username: string;
    password: string;
  }): Promise<string>;
  getStats(url: URL, idToken: string): Promise<HttpResult>;
  log(line: string): void;
}

export interface StatsCheckOutputs {
  SiteUrl: string;
  UserPoolId: string;
  UserPoolClientId: string;
  DemoCredentialsSecretArn: string;
}

const STATS_FIELDS = ["detailViews", "pageViews", "popularCategories", "totalRsvps"];

export function parseExpectedStats(text: string): ExpectedStats {
  const parsed = JSON.parse(text) as Partial<ExpectedStats>;
  const exact = parsed.exact;
  const lowerBound = parsed.lowerBound;
  if (
    !exact ||
    !Number.isSafeInteger(exact.totalRsvps) ||
    !Array.isArray(exact.popularCategories) ||
    !lowerBound ||
    !Number.isSafeInteger(lowerBound.pageViews) ||
    !Number.isSafeInteger(lowerBound.detailViews)
  ) {
    throw new Error("docs/expected-stats.json does not have the exact/lowerBound shape.");
  }
  return { exact, lowerBound };
}

/** Returns every mismatch; an empty list means the response matches. */
export function compareStats(actual: unknown, expected: ExpectedStats): string[] {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return ["The statistics response is not a JSON object."];
  }
  const stats = actual as Record<string, unknown>;
  const problems: string[] = [];
  if (Object.keys(stats).sort().join(",") !== STATS_FIELDS.join(",")) {
    problems.push("The statistics response does not have exactly the C-02 AdminStats fields.");
  }
  if (stats.totalRsvps !== expected.exact.totalRsvps) {
    problems.push(
      `totalRsvps is ${String(stats.totalRsvps)}, expected ${expected.exact.totalRsvps}.`,
    );
  }
  if (
    JSON.stringify(stats.popularCategories) !== JSON.stringify(expected.exact.popularCategories)
  ) {
    problems.push("popularCategories does not match the expected values exactly.");
  }
  for (const field of ["pageViews", "detailViews"] as const) {
    const value = stats[field];
    const minimum = expected.lowerBound[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
      problems.push(`${field} must be an integer of at least ${minimum}.`);
    }
  }
  return problems;
}

export async function runStatsCheck(
  outputs: StatsCheckOutputs,
  expected: ExpectedStats,
  ports: StatsCheckPorts,
): Promise<void> {
  const siteUrl = requireHttpsSiteUrl(outputs.SiteUrl);
  const password = await ports.readAdminPassword(outputs.DemoCredentialsSecretArn);
  const idToken = await ports.signIn({
    userPoolId: outputs.UserPoolId,
    clientId: outputs.UserPoolClientId,
    username: ADMIN_USERNAME,
    password,
  });
  const response = await ports.getStats(new URL("/api/admin/stats", siteUrl), idToken);
  if (response.status !== 200) {
    throw new Error(`GET /api/admin/stats returned HTTP ${response.status}.`);
  }
  const problems = compareStats(response.body, expected);
  if (problems.length > 0) {
    throw new Error(
      `Admin statistics do not match docs/expected-stats.json: ${problems.join(" ")}`,
    );
  }
  const stats = response.body as { pageViews: number; detailViews: number; totalRsvps: number };
  ports.log(
    `Admin statistics match the expected values: totalRsvps=${stats.totalRsvps} ` +
      `pageViews=${stats.pageViews} detailViews=${stats.detailViews}`,
  );
}
