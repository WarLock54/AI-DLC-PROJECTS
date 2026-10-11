import { describe, expect, it } from "vitest";
import type { RunResult } from "../../../scripts/evidence/load-runner.js";
import {
  isPending,
  pendingDocument,
  PENDING_MARKER,
} from "../../../scripts/evidence/placeholder.js";
import { renderLoadTest, type LoadTestReport } from "../../../scripts/evidence/render-load-test.js";

const result: RunResult = {
  totalRequests: 1000,
  latenciesMs: Array.from({ length: 1000 }, (_, index) => 100 + (index % 100)),
  serverErrors: 0,
  networkErrors: 0,
  statusCounts: { "200": 800, "201": 200 },
  flowCounts: { read: 700, rsvp: 200, other: 100 },
  rsvpOutcomes: { confirmed: 20, waitlisted: 180, other: 0 },
  peakConcurrentVus: 500,
};

const report: LoadTestReport = {
  runId: "run1",
  startedAt: "2026-10-05T10:00:00.000Z",
  endedAt: "2026-10-05T10:10:00.000Z",
  region: "us-east-1",
  thinkTimeMs: 1000,
  result,
  cloudWatch: { apiLatencyP95Ms: 250, api5xxCount: 0, lambdaThrottles: 0 },
  capacity: { capacity: 20, confirmedRsvpCount: 20, waitlistedResponses: 180 },
};

describe("renderLoadTest", () => {
  it("renders every required evidence field for a passing run", () => {
    const markdown = renderLoadTest(report);
    expect(markdown).toContain("**Verdict: PASS**");
    for (const text of [
      "500 virtual users",
      "120 s ramp-up",
      "480 s steady state",
      "API Gateway Latency p95 (worst 1-minute period)",
      "API Gateway 5xx (sum)",
      "Lambda Throttles (sum)",
      "Client p95 latency",
      "20 confirmed RSVPs for capacity 20",
      "| 201 | 200 |",
    ]) {
      expect(markdown).toContain(text);
    }
  });

  it("renders a failing run honestly, even if the caller expects a pass", () => {
    const markdown = renderLoadTest({
      ...report,
      cloudWatch: { apiLatencyP95Ms: 1500, api5xxCount: 0, lambdaThrottles: 2 },
    });
    expect(markdown).toContain("**Verdict: FAIL**");
    expect(markdown).not.toContain("**Verdict: PASS**");
    expect(markdown).toContain("FAIL |");
  });

  it("reports missing CloudWatch data as a failure", () => {
    const markdown = renderLoadTest({
      ...report,
      cloudWatch: { apiLatencyP95Ms: null, api5xxCount: null, lambdaThrottles: null },
    });
    expect(markdown).toContain("no data");
    expect(markdown).toContain("**Verdict: FAIL**");
  });

  it("applies redaction to the rendered document", () => {
    const account = ["1234", "5678", "9012"].join("");
    const markdown = renderLoadTest({ ...report, runId: `run-${account}` });
    expect(markdown).not.toContain(account);
  });
});

describe("pending placeholders", () => {
  it("are clearly marked and never contain a verdict", () => {
    const markdown = pendingDocument({
      title: "Load test evidence",
      requirement: "NFR7",
      command: "npm run evidence:load-test",
      environment: "LOAD_TEST=true",
    });
    expect(markdown).toContain(PENDING_MARKER);
    expect(markdown).not.toContain("Verdict");
    expect(isPending(markdown)).toBe(true);
    expect(isPending(renderLoadTest(report))).toBe(false);
  });
});
