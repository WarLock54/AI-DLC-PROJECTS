import { describe, expect, it } from "vitest";
import {
  THRESHOLDS,
  errorRate,
  evaluateLoadTest,
  percentile,
  type CapacityEvidence,
  type CloudWatchEvidence,
  type RequestTotals,
} from "../../../scripts/evidence/metrics.js";

const goodTotals: RequestTotals = {
  totalRequests: 1000,
  latenciesMs: Array.from({ length: 1000 }, (_, index) => 100 + (index % 50)),
  serverErrors: 0,
  networkErrors: 0,
};
const goodCloudWatch: CloudWatchEvidence = {
  apiLatencyP95Ms: 320,
  api5xxCount: 0,
  lambdaThrottles: 0,
};
const goodCapacity: CapacityEvidence = {
  capacity: 20,
  confirmedRsvpCount: 20,
  waitlistedResponses: 150,
};

function failing(result: ReturnType<typeof evaluateLoadTest>): string[] {
  return result.criteria.filter((criterion) => !criterion.pass).map((criterion) => criterion.id);
}

describe("percentile and error rate", () => {
  it("uses the nearest-rank method", () => {
    const values = [15, 20, 35, 40, 50];
    expect(percentile(values, 30)).toBe(20);
    expect(percentile(values, 100)).toBe(50);
    expect(percentile([7], 95)).toBe(7);
    expect(
      percentile(
        Array.from({ length: 100 }, (_, i) => 100 - i),
        95,
      ),
    ).toBe(95);
  });

  it("rejects an empty sample and an invalid percentile", () => {
    expect(() => percentile([], 95)).toThrow(/empty/);
    expect(() => percentile([1], 0)).toThrow(/percentile/);
    expect(() => percentile([1], 101)).toThrow(/percentile/);
  });

  it("combines 5xx and network errors and refuses zero requests", () => {
    expect(errorRate({ ...goodTotals, serverErrors: 3, networkErrors: 2 })).toBeCloseTo(0.005);
    expect(() => errorRate({ ...goodTotals, totalRequests: 0 })).toThrow(/undefined/);
  });
});

describe("load-test evaluation (NFR7, NFR8)", () => {
  it("keeps the approved thresholds fixed", () => {
    expect(THRESHOLDS).toEqual({ p95LatencyMs: 1000, errorRate: 0.01, lambdaThrottles: 0 });
  });

  it("passes when every criterion holds", () => {
    const result = evaluateLoadTest(goodTotals, goodCloudWatch, goodCapacity);
    expect(result.pass).toBe(true);
    expect(failing(result)).toEqual([]);
  });

  it("fails on client p95 at exactly one second", () => {
    const totals = { ...goodTotals, latenciesMs: Array.from({ length: 100 }, () => 1000) };
    expect(failing(evaluateLoadTest(totals, goodCloudWatch, goodCapacity))).toEqual(["client-p95"]);
  });

  it("fails on CloudWatch p95 and on missing CloudWatch data", () => {
    expect(
      failing(
        evaluateLoadTest(goodTotals, { ...goodCloudWatch, apiLatencyP95Ms: 1200 }, goodCapacity),
      ),
    ).toEqual(["api-p95"]);
    expect(
      failing(
        evaluateLoadTest(
          goodTotals,
          { apiLatencyP95Ms: null, api5xxCount: null, lambdaThrottles: null },
          goodCapacity,
        ),
      ),
    ).toEqual(["api-p95", "api-5xx", "lambda-throttles"]);
  });

  it("fails when the combined error rate reaches 1%", () => {
    const totals = { ...goodTotals, serverErrors: 5, networkErrors: 5 };
    expect(failing(evaluateLoadTest(totals, goodCloudWatch, goodCapacity))).toEqual(["error-rate"]);
  });

  it("fails on API Gateway 5xx responses at or above 1% of requests", () => {
    expect(
      failing(evaluateLoadTest(goodTotals, { ...goodCloudWatch, api5xxCount: 10 }, goodCapacity)),
    ).toEqual(["api-5xx"]);
  });

  it("fails on any Lambda throttle", () => {
    expect(
      failing(
        evaluateLoadTest(goodTotals, { ...goodCloudWatch, lambdaThrottles: 1 }, goodCapacity),
      ),
    ).toEqual(["lambda-throttles"]);
  });

  it("fails when confirmed RSVPs exceed capacity", () => {
    expect(
      failing(
        evaluateLoadTest(goodTotals, goodCloudWatch, { ...goodCapacity, confirmedRsvpCount: 21 }),
      ),
    ).toEqual(["capacity"]);
  });

  it("fails when no RSVP overflowed to the waitlist", () => {
    expect(
      failing(
        evaluateLoadTest(goodTotals, goodCloudWatch, { ...goodCapacity, waitlistedResponses: 0 }),
      ),
    ).toEqual(["waitlist-overflow"]);
  });

  it("fails honestly when there were no requests", () => {
    const empty: RequestTotals = {
      totalRequests: 0,
      latenciesMs: [],
      serverErrors: 0,
      networkErrors: 0,
    };
    const result = evaluateLoadTest(empty, goodCloudWatch, goodCapacity);
    expect(result.pass).toBe(false);
    expect(failing(result)).toEqual(["client-p95", "error-rate", "api-5xx"]);
  });
});
