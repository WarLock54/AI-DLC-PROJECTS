import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../../../src/event-api/http/request.js";
import {
  buildEventManagementDependencies,
  createEventManagementRouter,
  handler as managementHandler,
} from "../../../src/lambda/event-management/handler.js";
import {
  buildEventPublicDependencies,
  createEventPublicRouter,
  handler as publicHandler,
} from "../../../src/lambda/event-public/handler.js";
import {
  buildRsvpDependencies,
  createRsvpRouter,
  handler as rsvpHandler,
} from "../../../src/lambda/rsvp/handler.js";
import { awsError } from "../support/fake-dynamodb.js";
import {
  fakeWithSeed,
  ORGANIZER,
  OTHER_ORGANIZER,
  SEED_EVENT_ID,
  TABLE_NAME,
} from "../support/fixtures.js";
import { buildServices, recordingLogger } from "../support/services.js";

const ENV = { TABLE_NAME, BANNER_BUCKET_NAME: "team32-ceb-banner-test" };

function request(
  routeKey: string,
  options: {
    id?: string;
    body?: unknown;
    rawBody?: string;
    query?: Record<string, string>;
    claims?: Record<string, unknown>;
    base64?: boolean;
  } = {},
): HttpRequest {
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return {
    routeKey,
    body: options.base64 && body ? Buffer.from(body).toString("base64") : body,
    isBase64Encoded: options.base64 ?? false,
    pathParameters: options.id ? { id: options.id } : undefined,
    queryStringParameters: options.query,
    requestContext: {
      requestId: "req-1",
      authorizer: options.claims ? { jwt: { claims: options.claims } } : undefined,
    },
  };
}

function setup() {
  const fake = fakeWithSeed();
  const services = buildServices(fake);
  const logger = recordingLogger();
  return {
    fake,
    logger,
    publicRoute: createEventPublicRouter({ discovery: services.discovery, logger }),
    manage: createEventManagementRouter({
      events: services.events,
      banner: services.banner,
      logger,
    }),
    rsvp: createRsvpRouter({ rsvp: services.rsvp, logger }),
  };
}

const organizer = { sub: ORGANIZER, "cognito:groups": "[organizer]" };
const EVENT = {
  title: "Park Cleanup",
  description: "Synthetic cleanup event.",
  startsAt: "2030-02-01T10:00:00.000Z",
  location: "Riverside Park",
  category: "Volunteering",
  capacity: 2,
};

function parse(response: { body: string }) {
  return response.body ? (JSON.parse(response.body) as Record<string, unknown>) : undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Lambda handlers against the C-02 contract", () => {
  it("serves public list and detail routes with JSON bodies", async () => {
    const { publicRoute } = setup();
    const list = await publicRoute(
      request("GET /api/events", { query: { category: "Community" } }),
    );
    expect(list.statusCode).toBe(200);
    expect(list.headers["content-type"]).toContain("application/json");
    expect(parse(list)?.events).toHaveLength(1);
    const detail = await publicRoute(request("GET /api/events/{id}", { id: SEED_EVENT_ID }));
    expect(detail.statusCode).toBe(200);
    expect(parse(detail)).toMatchObject({
      eventId: SEED_EVENT_ID,
      description: expect.any(String),
    });
    const missing = await publicRoute(request("GET /api/events/{id}", { id: "nope" }));
    expect(missing.statusCode).toBe(404);
    expect(parse(missing)).toEqual({ code: "NOT_FOUND", message: "Event not found.", field: "id" });
  });

  it("covers the management lifecycle: create 201, update 200, banner 200, lists, delete 204", async () => {
    const { manage } = setup();
    const created = await manage(request("POST /api/events", { body: EVENT, claims: organizer }));
    expect(created.statusCode).toBe(201);
    const eventId = String(parse(created)?.eventId);
    const updated = await manage(
      request("PUT /api/events/{id}", {
        id: eventId,
        body: { ...EVENT, capacity: 3 },
        claims: organizer,
      }),
    );
    expect(updated.statusCode).toBe(200);
    expect(parse(updated)?.capacity).toBe(3);
    const banner = await manage(
      request("POST /api/events/{id}/banner-upload", {
        id: eventId,
        body: { contentType: "image/png" },
        claims: organizer,
        base64: true,
      }),
    );
    expect(banner.statusCode).toBe(200);
    expect(parse(banner)).toMatchObject({ url: expect.any(String), fields: expect.any(Object) });
    const mine = await manage(request("GET /api/organizer/events", { claims: organizer }));
    expect((parse(mine)?.events as unknown[]).length).toBeGreaterThan(0);
    const admin = await manage(
      request("GET /api/admin/events", {
        claims: { sub: "a", "cognito:groups": ["admin"] },
        query: { status: "active" },
      }),
    );
    expect(admin.statusCode).toBe(200);
    const removed = await manage(
      request("DELETE /api/events/{id}", { id: eventId, claims: organizer }),
    );
    expect(removed).toMatchObject({ statusCode: 204, body: "" });
  });

  it("returns 400 {code, message, field} for malformed or missing JSON bodies", async () => {
    const { manage, rsvp } = setup();
    const malformed = await manage(
      request("POST /api/events", { rawBody: "{not json", claims: organizer }),
    );
    expect(malformed.statusCode).toBe(400);
    expect(parse(malformed)).toEqual({
      code: "VALIDATION_ERROR",
      message: "The request body must be valid JSON.",
      field: "body",
    });
    const empty = await rsvp(request("POST /api/rsvps/cancel"));
    expect(parse(empty)).toMatchObject({ code: "VALIDATION_ERROR", field: "body" });
    const huge = await rsvp(request("POST /api/rsvps/cancel", { rawBody: "x".repeat(70_000) }));
    expect(parse(huge)).toMatchObject({ code: "VALIDATION_ERROR", field: "body" });
  });

  it("returns 404 NOT_FOUND for unknown routes", async () => {
    const { publicRoute } = setup();
    const response = await publicRoute(request("PATCH /api/events/{id}", { id: "x" }));
    expect(response.statusCode).toBe(404);
    expect(parse(response)).toEqual({
      code: "NOT_FOUND",
      message: "Route not found.",
      field: null,
    });
    const prototypeKey = await publicRoute(request("constructor"));
    expect(prototypeKey.statusCode).toBe(404);
  });

  it("returns 403 for a wrong group or owner and 401 when the sub claim is missing", async () => {
    const { manage } = setup();
    const otherOwner = await manage(
      request("PUT /api/events/{id}", {
        id: SEED_EVENT_ID,
        body: EVENT,
        claims: { sub: OTHER_ORGANIZER, "cognito:groups": "[organizer]" },
      }),
    );
    expect(otherOwner.statusCode).toBe(403);
    expect(parse(otherOwner)).toMatchObject({ code: "FORBIDDEN", field: null });
    const notAdmin = await manage(request("GET /api/admin/events", { claims: organizer }));
    expect(notAdmin.statusCode).toBe(403);
    const noSub = await manage(request("GET /api/organizer/events"));
    expect(noSub.statusCode).toBe(401);
    expect(parse(noSub)).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("returns the cancel token only on a 201 RSVP, never on the 200 duplicate", async () => {
    const { rsvp } = setup();
    const body = { displayName: "Resident", email: "resident.two@example.com" };
    const first = await rsvp(request("POST /api/events/{id}/rsvps", { id: SEED_EVENT_ID, body }));
    expect(first.statusCode).toBe(201);
    const created = parse(first) as { status: string; cancelToken: string };
    expect(created).toMatchObject({ status: "confirmed", cancelToken: expect.any(String) });
    const second = await rsvp(request("POST /api/events/{id}/rsvps", { id: SEED_EVENT_ID, body }));
    expect(second.statusCode).toBe(200);
    expect(parse(second)).toEqual({ status: "confirmed" });
    const cancelled = await rsvp(
      request("POST /api/rsvps/cancel", { body: { cancelToken: created.cancelToken } }),
    );
    expect(cancelled.statusCode).toBe(200);
    expect(parse(cancelled)).toEqual({ status: "cancelled" });
    const reused = await rsvp(
      request("POST /api/rsvps/cancel", { body: { cancelToken: created.cancelToken } }),
    );
    expect(reused.statusCode).toBe(409);
  });

  it("returns 500 INTERNAL_ERROR without internal detail and logs only safe fields", async () => {
    const { fake, publicRoute, logger } = setup();
    fake.failNext("GetCommand", awsError("InternalServerError", "secret internals at line 42"));
    const response = await publicRoute(request("GET /api/events/{id}", { id: SEED_EVENT_ID }));
    expect(response.statusCode).toBe(500);
    expect(parse(response)).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      field: null,
    });
    expect(response.body).not.toMatch(/secret internals|at line|stack/i);
    expect(logger.entries).toEqual([
      {
        level: "error",
        event: "UNHANDLED_ERROR",
        errorName: "InternalServerError",
        routeKey: "GET /api/events/{id}",
        requestId: "req-1",
      },
    ]);
  });

  it("fails loudly when a required environment variable is missing", async () => {
    const client = fakeWithSeed().asClient();
    expect(() => buildEventPublicDependencies({}, client)).toThrow(
      "Missing required environment variable TABLE_NAME.",
    );
    expect(() => buildRsvpDependencies({ TABLE_NAME: " " }, client)).toThrow(/TABLE_NAME/);
    expect(() => buildEventManagementDependencies({ TABLE_NAME }, client)).toThrow(
      "Missing required environment variable BANNER_BUCKET_NAME.",
    );
    expect(buildEventManagementDependencies(ENV, client).banner).toBeDefined();
    expect(buildEventPublicDependencies(ENV).discovery).toBeDefined();
    vi.stubEnv("TABLE_NAME", "");
    vi.stubEnv("BANNER_BUCKET_NAME", "");
    await expect(publicHandler(request("GET /api/events"))).rejects.toThrow(/TABLE_NAME/);
    await expect(rsvpHandler(request("POST /api/rsvps/cancel"))).rejects.toThrow(/TABLE_NAME/);
    await expect(managementHandler(request("GET /api/admin/events"))).rejects.toThrow(/TABLE_NAME/);
  });
});
