// Renders docs/load-test.md (NFR7, NFR8). The verdict is recomputed from the inputs,
// so a document can never claim a pass that the numbers do not support.
import {
  evaluateLoadTest,
  percentile,
  type CapacityEvidence,
  type CloudWatchEvidence,
} from "./metrics.js";
import { LOAD_PROFILE } from "./profile.js";
import { redact } from "./redact.js";
import type { RunResult } from "./load-runner.js";

export interface LoadTestReport {
  runId: string;
  startedAt: string;
  endedAt: string;
  region: string;
  thinkTimeMs: number;
  result: RunResult;
  cloudWatch: CloudWatchEvidence;
  capacity: CapacityEvidence;
}

function table(rows: ReadonlyArray<readonly string[]>): string[] {
  const [header, ...body] = rows;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
}

function percentileText(values: readonly number[], p: number): string {
  return values.length === 0 ? "no data" : `${percentile(values, p).toFixed(0)} ms`;
}

export function renderLoadTest(report: LoadTestReport): string {
  const { result } = report;
  const evaluation = evaluateLoadTest(result, report.cloudWatch, report.capacity);
  const statuses = Object.entries(result.statusCounts).sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    "# Load test evidence (debug sandbox)",
    "",
    `**Verdict: ${evaluation.pass ? "PASS" : "FAIL"}**`,
    "",
    "Debug-sandbox run only. The final verification pipeline never runs this test (NFR7).",
    "",
    "## Run",
    "",
    ...table([
      ["Field", "Value"],
      ["Run ID", report.runId],
      ["Window start (UTC)", report.startedAt],
      ["Window end (UTC)", report.endedAt],
      ["Region", report.region],
      [
        "Profile",
        `${LOAD_PROFILE.virtualUsers} virtual users, ${LOAD_PROFILE.rampSeconds} s ramp-up, ${LOAD_PROFILE.steadySeconds} s steady state, ${LOAD_PROFILE.totalSeconds} s total`,
      ],
      ["Think time", `${report.thinkTimeMs} ms`],
      ["Flow mix target", "70% event list/detail GET, 20% RSVP POST, 10% other public GETs"],
      ["Peak concurrent virtual users", String(result.peakConcurrentVus)],
    ]),
    "",
    "## Load-test summary",
    "",
    ...table([
      ["Metric", "Value"],
      ["Total requests", String(result.totalRequests)],
      [
        "Flows (read / rsvp / other)",
        `${result.flowCounts.read} / ${result.flowCounts.rsvp} / ${result.flowCounts.other}`,
      ],
      ["HTTP 5xx responses", String(result.serverErrors)],
      ["Network errors", String(result.networkErrors)],
      ["Client p50 latency", percentileText(result.latenciesMs, 50)],
      ["Client p95 latency", percentileText(result.latenciesMs, 95)],
      ["Client p99 latency", percentileText(result.latenciesMs, 99)],
      [
        "RSVP outcomes (confirmed / waitlisted / other)",
        `${result.rsvpOutcomes.confirmed} / ${result.rsvpOutcomes.waitlisted} / ${result.rsvpOutcomes.other}`,
      ],
    ]),
    "",
    "Responses by HTTP status:",
    "",
    ...table([["Status", "Count"], ...statuses.map(([status, count]) => [status, String(count)])]),
    "",
    "## CloudWatch metrics for the test window",
    "",
    ...table([
      ["Metric", "Value"],
      [
        "API Gateway Latency p95 (worst 1-minute period)",
        report.cloudWatch.apiLatencyP95Ms === null
          ? "no data"
          : `${report.cloudWatch.apiLatencyP95Ms.toFixed(0)} ms`,
      ],
      [
        "API Gateway 5xx (sum)",
        report.cloudWatch.api5xxCount === null ? "no data" : String(report.cloudWatch.api5xxCount),
      ],
      [
        "Lambda Throttles (sum)",
        report.cloudWatch.lambdaThrottles === null
          ? "no data"
          : String(report.cloudWatch.lambdaThrottles),
      ],
    ]),
    "",
    "## Capacity proof",
    "",
    `The run created its own small-capacity fixture event, so RSVP traffic had to overflow to the waitlist. After the run the event detail reported ${report.capacity.confirmedRsvpCount} confirmed RSVPs for capacity ${report.capacity.capacity}; ${report.capacity.waitlistedResponses} RSVP responses reported \`waitlisted\`.`,
    "",
    "## Pass criteria",
    "",
    ...table([
      ["Criterion", "Observed", "Threshold", "Result"],
      ...evaluation.criteria.map((criterion) => [
        criterion.label,
        criterion.observed,
        criterion.threshold,
        criterion.pass ? "pass" : "FAIL",
      ]),
    ]),
    "",
    "Response bodies, cancellation tokens, credentials, and email addresses are never recorded in this file.",
    "",
  ];
  return redact(lines.join("\n"));
}
