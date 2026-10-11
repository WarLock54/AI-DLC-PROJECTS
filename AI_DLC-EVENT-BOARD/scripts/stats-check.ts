// C5 post-deploy statistics smoke test (FR8.5, Q4 A). Runs in the
// health-check job after the health check; exits non-zero on any mismatch.
import { readFile } from "node:fs/promises";
import { createStatsCheckPorts } from "./c5/aws-ports.js";
import { readFoundationOutputs } from "./c5/outputs.js";
import { parseExpectedStats, runStatsCheck } from "./c5/stats-comparison.js";

const EXPECTED_STATS_PATH = "docs/expected-stats.json";

async function main(): Promise<void> {
  const outputs = await readFoundationOutputs([
    "SiteUrl",
    "UserPoolId",
    "UserPoolClientId",
    "DemoCredentialsSecretArn",
  ] as const);
  const expected = parseExpectedStats(await readFile(EXPECTED_STATS_PATH, "utf8"));
  await runStatsCheck(outputs, expected, createStatsCheckPorts());
  console.info("Admin statistics smoke test succeeded.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown statistics check failure.";
  console.error(`Statistics check failed: ${message}`);
  process.exitCode = 1;
});
