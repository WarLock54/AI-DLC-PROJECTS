import { describe, expect, it } from "vitest";
import {
  createFixtureEvent,
  runLoad,
  verifyCapacity,
  type HttpPort,
  type HttpRequest,
  type HttpResponse,
  type RunnerConfig,
} from "../../../scripts/evidence/load-runner.js";
import { evaluateLoadTest } from "../../../scripts/evidence/metrics.js";
import { LOAD_PROFILE, seededRandom } from "../../../scripts/evidence/profile.js";
import { FakeClock } from "./fakes.js";

const config = (overrides: Partial<RunnerConfig> = {}): RunnerConfig => ({
  fixtureEventId: "fixture-event",
  readEventIds: ["seed-event-a", "seed-event-b"],
  runId: "run1",
  random: seededRandom(7),
  thinkTimeMs: 10_000,
  ...overrides,
});

/** Fake API: first `capacity` RSVPs are confirmed, the rest are waitlisted. */
class FakeApi implements HttpPort {
  requests: HttpRequest[] = [];
  confirmed = 0;
  constructor(
    private readonly capacity: number,
    private readonly failEvery = 0,
    private readonly overbook = false,
  ) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    if (this.failEvery > 0 && this.requests.length % this.failEvery === 0) {
      throw new Error("connect ECONNRESET host.example.com");
    }
    if (request.method === "POST" && request.path.endsWith("/rsvps")) {
      const confirmed = this.overbook || this.confirmed < this.capacity;
      if (confirmed) {
        this.confirmed += 1;
      }
      return {
        status: 201,
        body: {
          status: confirmed ? "confirmed" : "waitlisted",
          cancelToken: "secret-cancel-token",
        },
        latencyMs: 40,
      };
    }
    if (request.method === "GET" && request.path === "/api/events/fixture-event") {
      return {
        status: 200,
        body: { capacity: this.capacity, confirmedRsvpCount: this.confirmed },
        latencyMs: 30,
      };
    }
    return { status: 200, body: { ok: true }, latencyMs: 20 };
  }
}

describe("runLoad", () => {
  it("follows the approved profile: 500 concurrent VUs after the ramp, ending at 600 s", async () => {
    const clock = new FakeClock();
    const api = new FakeApi(20);
    const result = await (async () => {
      const promise = runLoad(config(), api, clock);
      await clock.runUntilIdle();
      return promise;
    })();
    expect(result.peakConcurrentVus).toBe(LOAD_PROFILE.virtualUsers);
    expect(clock.now).toBeLessThanOrEqual((LOAD_PROFILE.totalSeconds + 10) * 1000);
    expect(result.totalRequests).toBe(api.requests.length);
    expect(result.latenciesMs).toHaveLength(result.totalRequests);
  });

  it("produces roughly the 70/20/10 flow mix", async () => {
    const clock = new FakeClock();
    const promise = runLoad(config(), new FakeApi(20), clock);
    await clock.runUntilIdle();
    const result = await promise;
    const total = result.totalRequests;
    expect(result.flowCounts.read / total).toBeCloseTo(0.7, 1);
    expect(result.flowCounts.rsvp / total).toBeCloseTo(0.2, 1);
    expect(result.flowCounts.other / total).toBeCloseTo(0.1, 1);
  });

  it("counts network errors and 5xx responses as errors and drops error text", async () => {
    const clock = new FakeClock();
    const promise = runLoad(
      config({ profile: { virtualUsers: 5, rampSeconds: 5, totalSeconds: 60 } }),
      new FakeApi(20, 4),
      clock,
    );
    await clock.runUntilIdle();
    const result = await promise;
    expect(result.networkErrors).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("ECONNRESET");
    expect(result.latenciesMs.length + result.networkErrors).toBe(result.totalRequests);
  });

  it("never stores response bodies or cancellation tokens", async () => {
    const clock = new FakeClock();
    const promise = runLoad(
      config({ thinkTimeMs: 1000, profile: { virtualUsers: 3, rampSeconds: 3, totalSeconds: 30 } }),
      new FakeApi(2),
      clock,
    );
    await clock.runUntilIdle();
    const result = await promise;
    expect(JSON.stringify(result)).not.toContain("secret-cancel-token");
    expect(result.rsvpOutcomes.waitlisted).toBeGreaterThan(0);
  });

  it("uses unique synthetic example.com addresses for RSVPs", async () => {
    const clock = new FakeClock();
    const api = new FakeApi(2);
    const promise = runLoad(
      config({ thinkTimeMs: 1000, profile: { virtualUsers: 3, rampSeconds: 3, totalSeconds: 60 } }),
      api,
      clock,
    );
    await clock.runUntilIdle();
    await promise;
    const emails = api.requests
      .filter((request) => request.method === "POST")
      .map((request) => (request.body as { email: string }).email);
    expect(emails.length).toBeGreaterThan(1);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.every((email) => email.endsWith("@example.com"))).toBe(true);
  });

  it("rejects a non-positive think time", async () => {
    await expect(
      runLoad(config({ thinkTimeMs: 0 }), new FakeApi(1), new FakeClock()),
    ).rejects.toThrow(/thinkTimeMs/);
  });
});

describe("capacity verification", () => {
  it("accepts overflow to the waitlist", async () => {
    const api = new FakeApi(2);
    for (let index = 0; index < 5; index++) {
      await api.send({ method: "POST", path: "/api/events/fixture-event/rsvps" });
    }
    const evidence = await verifyCapacity(api, "fixture-event", 3);
    expect(evidence).toEqual({ capacity: 2, confirmedRsvpCount: 2, waitlistedResponses: 3 });
    const evaluation = evaluateLoadTest(
      { totalRequests: 10, latenciesMs: [10], serverErrors: 0, networkErrors: 0 },
      { apiLatencyP95Ms: 10, api5xxCount: 0, lambdaThrottles: 0 },
      evidence,
    );
    expect(evaluation.pass).toBe(true);
  });

  it("flags a confirmed count above capacity", async () => {
    const api = new FakeApi(2, 0, true);
    for (let index = 0; index < 3; index++) {
      await api.send({ method: "POST", path: "/api/events/fixture-event/rsvps" });
    }
    const evidence = await verifyCapacity(api, "fixture-event", 1);
    expect(evidence.confirmedRsvpCount).toBe(3);
    const evaluation = evaluateLoadTest(
      { totalRequests: 10, latenciesMs: [10], serverErrors: 0, networkErrors: 0 },
      { apiLatencyP95Ms: 10, api5xxCount: 0, lambdaThrottles: 0 },
      evidence,
    );
    expect(evaluation.criteria.find((criterion) => criterion.id === "capacity")?.pass).toBe(false);
    expect(evaluation.pass).toBe(false);
  });

  it("fails loudly when the event cannot be read", async () => {
    const http: HttpPort = { send: async () => ({ status: 404, body: null, latencyMs: 1 }) };
    await expect(verifyCapacity(http, "missing", 0)).rejects.toThrow(/HTTP 404/);
  });
});

describe("createFixtureEvent", () => {
  it("creates a future small-capacity event with the organizer token", async () => {
    let seen: HttpRequest | undefined;
    const http: HttpPort = {
      send: async (request) => {
        seen = request;
        return { status: 201, body: { eventId: "evt-1" }, latencyMs: 5 };
      },
    };
    const id = await createFixtureEvent(http, "id-token-value", {
      runId: "r1",
      capacity: 20,
      nowMs: Date.UTC(2026, 9, 1),
    });
    expect(id).toBe("evt-1");
    expect(seen?.headers?.authorization).toBe("Bearer id-token-value");
    const body = seen?.body as { startsAt: string; capacity: number };
    expect(body.capacity).toBe(20);
    expect(new Date(body.startsAt).getTime()).toBeGreaterThan(Date.UTC(2026, 9, 1));
  });

  it("fails when the event is not created", async () => {
    const http: HttpPort = { send: async () => ({ status: 403, body: {}, latencyMs: 5 }) };
    await expect(
      createFixtureEvent(http, "t", { runId: "r", capacity: 1, nowMs: 0 }),
    ).rejects.toThrow(/HTTP 403/);
  });
});
