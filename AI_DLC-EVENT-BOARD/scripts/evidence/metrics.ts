// NFR7 / NFR8 evaluation. The thresholds are constants and are never configurable,
// so a run cannot be made to pass by loosening them.

export const THRESHOLDS = {
  /** NFR8: p95 API latency stays under one second (strictly). */
  p95LatencyMs: 1000,
  /** NFR7: combined HTTP 5xx and network-error rate stays under 1% (strictly). */
  errorRate: 0.01,
  /** NFR7: Lambda throttles are zero. */
  lambdaThrottles: 0,
} as const;

export interface RequestTotals {
  totalRequests: number;
  /** Latency of every completed request, in milliseconds. */
  latenciesMs: readonly number[];
  serverErrors: number;
  networkErrors: number;
}

/** CloudWatch values for the exact test window; null means "no data returned". */
export interface CloudWatchEvidence {
  apiLatencyP95Ms: number | null;
  api5xxCount: number | null;
  lambdaThrottles: number | null;
}

export interface CapacityEvidence {
  capacity: number;
  confirmedRsvpCount: number;
  /** RSVP responses reporting `waitlisted` during the run. */
  waitlistedResponses: number;
}

export interface Criterion {
  id: string;
  label: string;
  observed: string;
  threshold: string;
  pass: boolean;
}

export interface Evaluation {
  pass: boolean;
  criteria: Criterion[];
}

/** Nearest-rank percentile (p in (0, 100]) of unsorted values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new Error("Cannot compute a percentile of an empty sample.");
  }
  if (!(p > 0 && p <= 100)) {
    throw new Error("The percentile must be in (0, 100].");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1];
}

/** Combined 5xx plus network-error rate; zero requests is an error, not a pass. */
export function errorRate(totals: RequestTotals): number {
  if (totals.totalRequests <= 0) {
    throw new Error("No requests were made; the error rate is undefined.");
  }
  return (totals.serverErrors + totals.networkErrors) / totals.totalRequests;
}

function formatMs(value: number | null): string {
  return value === null ? "no data" : `${value.toFixed(0)} ms`;
}

export function evaluateLoadTest(
  totals: RequestTotals,
  cloudWatch: CloudWatchEvidence,
  capacity: CapacityEvidence,
): Evaluation {
  const clientP95 = totals.latenciesMs.length > 0 ? percentile(totals.latenciesMs, 95) : null;
  const rate = totals.totalRequests > 0 ? errorRate(totals) : null;
  const cwRate =
    cloudWatch.api5xxCount !== null && totals.totalRequests > 0
      ? cloudWatch.api5xxCount / totals.totalRequests
      : null;

  const criteria: Criterion[] = [
    {
      id: "client-p95",
      label: "Client-observed p95 latency",
      observed: formatMs(clientP95),
      threshold: `< ${THRESHOLDS.p95LatencyMs} ms`,
      pass: clientP95 !== null && clientP95 < THRESHOLDS.p95LatencyMs,
    },
    {
      id: "api-p95",
      label: "API Gateway p95 latency (CloudWatch, worst 1-minute period)",
      observed: formatMs(cloudWatch.apiLatencyP95Ms),
      threshold: `< ${THRESHOLDS.p95LatencyMs} ms`,
      pass:
        cloudWatch.apiLatencyP95Ms !== null && cloudWatch.apiLatencyP95Ms < THRESHOLDS.p95LatencyMs,
    },
    {
      id: "error-rate",
      label: "Combined 5xx and network-error rate",
      observed: rate === null ? "no requests" : `${(rate * 100).toFixed(3)}%`,
      threshold: `< ${THRESHOLDS.errorRate * 100}%`,
      pass: rate !== null && rate < THRESHOLDS.errorRate,
    },
    {
      id: "api-5xx",
      label: "API Gateway 5xx rate (CloudWatch)",
      observed:
        cloudWatch.api5xxCount === null
          ? "no data"
          : `${cloudWatch.api5xxCount} responses (${((cwRate ?? 0) * 100).toFixed(3)}%)`,
      threshold: `< ${THRESHOLDS.errorRate * 100}%`,
      pass: cwRate !== null && cwRate < THRESHOLDS.errorRate,
    },
    {
      id: "lambda-throttles",
      label: "Lambda throttles (CloudWatch)",
      observed:
        cloudWatch.lambdaThrottles === null ? "no data" : String(cloudWatch.lambdaThrottles),
      threshold: `= ${THRESHOLDS.lambdaThrottles}`,
      pass: cloudWatch.lambdaThrottles === THRESHOLDS.lambdaThrottles,
    },
    {
      id: "capacity",
      label: "Confirmed RSVPs never exceed event capacity",
      observed: `${capacity.confirmedRsvpCount} confirmed of ${capacity.capacity}`,
      threshold: `<= ${capacity.capacity}`,
      pass: capacity.confirmedRsvpCount <= capacity.capacity,
    },
    {
      id: "waitlist-overflow",
      label: "Excess RSVPs moved to the waitlist",
      observed: `${capacity.waitlistedResponses} waitlisted responses`,
      threshold: "> 0",
      pass: capacity.waitlistedResponses > 0,
    },
  ];
  return { pass: criteria.every((criterion) => criterion.pass), criteria };
}
