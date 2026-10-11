// Debug-sandbox load test (NFR7, NFR8). Run explicitly: LOAD_TEST=true npm run evidence:load-test
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { readFoundationOutputs, requireHttpsSiteUrl } from "../c5/outputs.js";
import {
  createHttpPort,
  createRealClock,
  readCloudWatchEvidence,
  requireEnvironmentCredentials,
  signInSeededOrganizer,
} from "./aws-ports.js";
import { assertNotPipeline, assertOptIn, runCli } from "./guards.js";
import { createFixtureEvent, runLoad, verifyCapacity } from "./load-runner.js";
import { evaluateLoadTest } from "./metrics.js";
import { seededRandom } from "./profile.js";
import { renderLoadTest } from "./render-load-test.js";

const OUTPUT_PATH = "docs/load-test.md";
const FIXTURE_CAPACITY = 20;
const THINK_TIME_MS = Number(process.env.LOAD_TEST_THINK_TIME_MS ?? "1000");
// CloudWatch needs a few minutes before the last datapoints are queryable.
const SETTLE_SECONDS = Number(process.env.LOAD_TEST_METRIC_SETTLE_SECONDS ?? "300");

async function main(): Promise<void> {
  // Guards run before any credential check or AWS client.
  assertOptIn(process.env, "LOAD_TEST", "The 500-user load test");
  assertNotPipeline(process.env);
  const { region } = requireEnvironmentCredentials();
  const outputs = await readFoundationOutputs([
    "SiteUrl",
    "UserPoolId",
    "UserPoolClientId",
    "DemoCredentialsSecretArn",
  ] as const);
  const siteUrl = requireHttpsSiteUrl(outputs.SiteUrl);
  const http = createHttpPort(siteUrl);
  const clock = createRealClock();
  const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);

  const idToken = await signInSeededOrganizer({
    region,
    userPoolId: outputs.UserPoolId,
    clientId: outputs.UserPoolClientId,
    secretArn: outputs.DemoCredentialsSecretArn,
  });
  const fixtureEventId = await createFixtureEvent(http, idToken, {
    runId,
    capacity: FIXTURE_CAPACITY,
    nowMs: Date.now(),
  });

  const list = await http.send({ method: "GET", path: "/api/events" });
  const events = (list.body as { events?: Array<{ eventId?: unknown }> } | null)?.events ?? [];
  const readEventIds = events
    .map((event) => event.eventId)
    .filter((id): id is string => typeof id === "string")
    .slice(0, 10);

  console.info(`Starting the 10-minute load test (run ${runId}).`);
  const startedAt = new Date();
  const result = await runLoad(
    { fixtureEventId, readEventIds, runId, random: seededRandom(32), thinkTimeMs: THINK_TIME_MS },
    http,
    clock,
  );
  const endedAt = new Date();
  console.info(`Load run finished with ${result.totalRequests} requests; waiting for CloudWatch.`);

  await delay(SETTLE_SECONDS * 1000);
  const cloudWatch = await readCloudWatchEvidence(
    region,
    { start: startedAt, end: new Date(endedAt.getTime() + 60_000) },
    process.env.LOAD_TEST_API_ID,
  );
  const capacity = await verifyCapacity(http, fixtureEventId, result.rsvpOutcomes.waitlisted);

  const markdown = renderLoadTest({
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    region,
    thinkTimeMs: THINK_TIME_MS,
    result,
    cloudWatch,
    capacity,
  });
  await writeFile(OUTPUT_PATH, markdown, "utf8");
  const evaluation = evaluateLoadTest(result, cloudWatch, capacity);
  console.info(`Wrote ${OUTPUT_PATH}: ${evaluation.pass ? "PASS" : "FAIL"}.`);
  if (!evaluation.pass) {
    throw new Error("The load test did not meet NFR7/NFR8; see docs/load-test.md.");
  }
}

runCli("Load test", main);
