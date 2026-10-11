// NFR7 virtual-user loop. All I/O goes through injected ports so the profile,
// flow mix, and verification logic are unit-testable without a network.
import type { CapacityEvidence, RequestTotals } from "./metrics.js";
import { LOAD_PROFILE, selectFlow, type Flow } from "./profile.js";

export interface HttpRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** `latencyMs` is measured by the adapter. A network failure is a thrown error. */
export interface HttpResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export interface HttpPort {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export interface ClockPort {
  nowMs(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface RunnerProfile {
  virtualUsers: number;
  rampSeconds: number;
  totalSeconds: number;
}

export interface RunnerConfig {
  /** Event that receives the RSVP traffic; created small so traffic overflows. */
  fixtureEventId: string;
  /** Event identifiers used for detail reads. */
  readEventIds: readonly string[];
  runId: string;
  random: () => number;
  thinkTimeMs: number;
  profile?: RunnerProfile;
}

export interface RunResult extends RequestTotals {
  statusCounts: Record<string, number>;
  flowCounts: Record<Flow, number>;
  rsvpOutcomes: { confirmed: number; waitlisted: number; other: number };
  peakConcurrentVus: number;
}

const DEFAULT_PROFILE: RunnerProfile = {
  virtualUsers: LOAD_PROFILE.virtualUsers,
  rampSeconds: LOAD_PROFILE.rampSeconds,
  totalSeconds: LOAD_PROFILE.totalSeconds,
};

function requestFor(flow: Flow, config: RunnerConfig, sequence: number): HttpRequest {
  if (flow === "read") {
    if (config.random() < 0.5 || config.readEventIds.length === 0) {
      return { method: "GET", path: "/api/events" };
    }
    const id = config.readEventIds[Math.floor(config.random() * config.readEventIds.length)];
    return { method: "GET", path: `/api/events/${encodeURIComponent(id)}` };
  }
  if (flow === "rsvp") {
    return {
      method: "POST",
      path: `/api/events/${encodeURIComponent(config.fixtureEventId)}/rsvps`,
      body: {
        displayName: `Load Test ${sequence}`,
        email: `load-${config.runId}-${sequence}@example.com`,
      },
    };
  }
  return config.random() < 0.5
    ? { method: "GET", path: "/api/health" }
    : { method: "GET", path: "/api/events?category=Community" };
}

function rsvpStatus(body: unknown): "confirmed" | "waitlisted" | "other" {
  const status = (body as { status?: unknown } | null)?.status;
  return status === "confirmed" || status === "waitlisted" ? status : "other";
}

/**
 * Runs the virtual users. Response bodies and cancellation tokens are inspected
 * only for the RSVP status and then dropped; they are never stored.
 */
export async function runLoad(
  config: RunnerConfig,
  http: HttpPort,
  clock: ClockPort,
): Promise<RunResult> {
  const profile = config.profile ?? DEFAULT_PROFILE;
  if (!(config.thinkTimeMs > 0)) {
    throw new Error("thinkTimeMs must be greater than zero.");
  }
  const latenciesMs: number[] = [];
  const result: RunResult = {
    totalRequests: 0,
    latenciesMs,
    serverErrors: 0,
    networkErrors: 0,
    statusCounts: {},
    flowCounts: { read: 0, rsvp: 0, other: 0 },
    rsvpOutcomes: { confirmed: 0, waitlisted: 0, other: 0 },
    peakConcurrentVus: 0,
  };
  const startMs = clock.nowMs();
  const endMs = startMs + profile.totalSeconds * 1000;
  let active = 0;
  let sequence = 0;

  const virtualUser = async (index: number): Promise<void> => {
    const startOffsetMs = (index * profile.rampSeconds * 1000) / profile.virtualUsers;
    if (startOffsetMs > 0) {
      await clock.sleep(startOffsetMs);
    }
    active += 1;
    result.peakConcurrentVus = Math.max(result.peakConcurrentVus, active);
    while (clock.nowMs() < endMs) {
      const flow = selectFlow(config.random());
      sequence += 1;
      result.flowCounts[flow] += 1;
      result.totalRequests += 1;
      try {
        const response = await http.send(requestFor(flow, config, sequence));
        latenciesMs.push(response.latencyMs);
        const key = String(response.status);
        result.statusCounts[key] = (result.statusCounts[key] ?? 0) + 1;
        if (response.status >= 500) {
          result.serverErrors += 1;
        }
        if (flow === "rsvp" && response.status === 201) {
          result.rsvpOutcomes[rsvpStatus(response.body)] += 1;
        }
      } catch {
        // The error text is dropped on purpose: it may embed a URL or host detail.
        result.networkErrors += 1;
      }
      await clock.sleep(config.thinkTimeMs);
    }
    active -= 1;
  };

  await Promise.all(Array.from({ length: profile.virtualUsers }, (_, index) => virtualUser(index)));
  return result;
}

/** Creates the small-capacity fixture event through the organizer API. */
export async function createFixtureEvent(
  http: HttpPort,
  organizerIdToken: string,
  options: { runId: string; capacity: number; nowMs: number },
): Promise<string> {
  const response = await http.send({
    method: "POST",
    path: "/api/events",
    headers: { authorization: `Bearer ${organizerIdToken}` },
    body: {
      title: `Load test ${options.runId}`,
      description: "Synthetic fixture event for the debug-sandbox load test.",
      startsAt: new Date(options.nowMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
      location: "Community Hall",
      category: "Community",
      capacity: options.capacity,
    },
  });
  const eventId = (response.body as { eventId?: unknown } | null)?.eventId;
  if (response.status !== 201 || typeof eventId !== "string" || eventId === "") {
    throw new Error(`Creating the load-test fixture event failed (HTTP ${response.status}).`);
  }
  return eventId;
}

/** Reads the fixture event back and returns the capacity evidence (NFR7). */
export async function verifyCapacity(
  http: HttpPort,
  eventId: string,
  waitlistedResponses: number,
): Promise<CapacityEvidence> {
  const response = await http.send({
    method: "GET",
    path: `/api/events/${encodeURIComponent(eventId)}`,
  });
  const body = response.body as { capacity?: unknown; confirmedRsvpCount?: unknown } | null;
  if (
    response.status !== 200 ||
    !Number.isInteger(body?.capacity) ||
    !Number.isInteger(body?.confirmedRsvpCount)
  ) {
    throw new Error(`Reading the fixture event failed or was malformed (HTTP ${response.status}).`);
  }
  return {
    capacity: body?.capacity as number,
    confirmedRsvpCount: body?.confirmedRsvpCount as number,
    waitlistedResponses,
  };
}
