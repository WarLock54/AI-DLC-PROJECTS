// In-memory C-02 API used as a fetch stub. Events are built from the
// deterministic seed shapes in src/seed/fixtures.ts plus two synthetic events
// with other categories/locations so filters have something to derive.
import { vi } from "vitest";
import { createSeedFixtures } from "../../../../src/seed/fixtures.js";
import type { ManagementEvent } from "../../../../ui/src/api/types.js";
import { ORGANIZER_SUB } from "./jwt.js";

export const FIXED_NOW = new Date("2030-01-15T12:00:00.000Z");

export interface RecordedRequest {
  method: string;
  url: URL;
  path: string;
  headers: Headers;
  body: unknown;
}

export interface FakeResponse {
  status: number;
  body?: unknown;
  text?: string;
  contentType?: string;
}

export type FakeHandler = (
  request: RecordedRequest,
  match: RegExpExecArray,
) => FakeResponse | "network-error" | Promise<FakeResponse | "network-error">;

interface Route {
  method: string;
  pattern: RegExp;
  handler: FakeHandler;
}

export function seedEvents(): ManagementEvent[] {
  const fixtures = createSeedFixtures({ organizerSubject: ORGANIZER_SUB, clock: () => FIXED_NOW });
  const seeded = fixtures
    .filter((item) => item.sk === "META")
    .map(
      (item): ManagementEvent => ({
        eventId: String(item.eventId),
        title: String(item.title),
        description: String(item.description),
        startsAt: String(item.startsAt),
        location: String(item.location),
        category: String(item.category),
        capacity: Number(item.capacity),
        confirmedRsvpCount: Number(item.confirmedRsvpCount),
        bannerReference: null,
        organizerSubject: String(item.organizerSubject),
        lifecycleStatus: "active",
      }),
    );
  return [
    ...seeded,
    {
      eventId: "synthetic-event-river-cleanup",
      title: "Riverside Cleanup",
      description: "Synthetic volunteer event.",
      startsAt: "2030-02-01T09:00:00.000Z",
      location: "Riverside Park",
      category: "Volunteer",
      capacity: 2,
      confirmedRsvpCount: 2,
      bannerReference: "banners/synthetic-event-river-cleanup/banner-1.png",
      organizerSubject: ORGANIZER_SUB,
      lifecycleStatus: "active",
    },
    {
      eventId: "synthetic-event-food-market",
      title: "Friday Food Market",
      description: "Synthetic food market event.",
      startsAt: "2030-02-07T18:00:00.000Z",
      location: "Town Square",
      category: "Food",
      capacity: 40,
      confirmedRsvpCount: 3,
      bannerReference: null,
      organizerSubject: "33333333-3333-4333-8333-333333333333",
      lifecycleStatus: "active",
    },
  ];
}

export function errorBody(code: string, field: string | null = null): FakeResponse["body"] {
  return { code, message: `Synthetic ${code} message`, field };
}

function toPublic(event: ManagementEvent): Record<string, unknown> {
  const { organizerSubject: _owner, lifecycleStatus: _status, ...rest } = event;
  void _owner;
  void _status;
  return rest;
}

export class FakeApi {
  readonly requests: RecordedRequest[] = [];
  events: ManagementEvent[] = seedEvents();
  readonly fetch = vi.fn(this.handle.bind(this));
  private readonly routes: Route[] = [];
  private nextId = 1;

  constructor() {
    this.defaultRoutes();
  }

  /** Overrides (or adds) a route; later registrations win. */
  on(method: string, pattern: RegExp, handler: FakeHandler): this {
    this.routes.unshift({ method, pattern, handler });
    return this;
  }

  install(): this {
    vi.stubGlobal("fetch", this.fetch);
    return this;
  }

  requestsTo(method: string, path: string | RegExp): RecordedRequest[] {
    return this.requests.filter(
      (request) =>
        request.method === method &&
        (typeof path === "string" ? request.path === path : path.test(request.path)),
    );
  }

  private async handle(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input instanceof Request ? input.url : input), "https://site.test");
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    let body: unknown = init.body;
    if (typeof init.body === "string") {
      body = JSON.parse(init.body);
    }
    const request: RecordedRequest = { method, url, path: url.pathname, headers, body };
    this.requests.push(request);
    for (const route of this.routes) {
      const match = route.method === method ? route.pattern.exec(url.pathname) : null;
      if (match) {
        const result = await route.handler(request, match);
        if (result === "network-error") {
          throw new TypeError("Failed to fetch");
        }
        return toResponse(result);
      }
    }
    return toResponse({ status: 404, body: errorBody("NOT_FOUND") });
  }

  private defaultRoutes(): void {
    this.routes.push(
      {
        method: "GET",
        pattern: /^\/api\/events$/,
        handler: (request) => {
          const { searchParams } = request.url;
          const events = this.events.filter(
            (event) =>
              event.lifecycleStatus === "active" &&
              (!searchParams.get("category") || event.category === searchParams.get("category")) &&
              (!searchParams.get("location") || event.location === searchParams.get("location")) &&
              (!searchParams.get("date") ||
                event.startsAt.startsWith(String(searchParams.get("date")))),
          );
          return { status: 200, body: { events: events.map(toPublic) } };
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/events\/([^/]+)$/,
        handler: (_request, match) => {
          const event = this.find(decodeURIComponent(match[1]));
          return event
            ? { status: 200, body: toPublic(event) }
            : { status: 404, body: errorBody("NOT_FOUND") };
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/events\/([^/]+)\/rsvps$/,
        handler: (_request, match) => {
          const event = this.find(decodeURIComponent(match[1]));
          if (!event) {
            return { status: 404, body: errorBody("NOT_FOUND") };
          }
          const status = event.confirmedRsvpCount < event.capacity ? "confirmed" : "waitlisted";
          return { status: 201, body: { status, cancelToken: "synthetic-cancel-token-0001" } };
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/rsvps\/cancel$/,
        handler: () => ({ status: 200, body: { status: "cancelled" } }),
      },
      {
        method: "GET",
        pattern: /^\/api\/organizer\/events$/,
        handler: () => ({
          status: 200,
          body: { events: this.events.filter((event) => event.organizerSubject === ORGANIZER_SUB) },
        }),
      },
      {
        method: "GET",
        pattern: /^\/api\/admin\/events$/,
        handler: (request) => {
          const status = request.url.searchParams.get("status") ?? "active";
          return {
            status: 200,
            body: { events: this.events.filter((event) => event.lifecycleStatus === status) },
          };
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/events$/,
        handler: (request) => {
          const write = request.body as Omit<ManagementEvent, "eventId">;
          const created: ManagementEvent = {
            ...write,
            eventId: `created-event-${this.nextId++}`,
            confirmedRsvpCount: 0,
            bannerReference: null,
            organizerSubject: ORGANIZER_SUB,
            lifecycleStatus: "active",
          };
          this.events.push(created);
          return { status: 201, body: created };
        },
      },
      {
        method: "PUT",
        pattern: /^\/api\/events\/([^/]+)$/,
        handler: (request, match) => {
          const event = this.find(decodeURIComponent(match[1]));
          if (!event) {
            return { status: 404, body: errorBody("NOT_FOUND") };
          }
          Object.assign(event, request.body as object);
          return { status: 200, body: event };
        },
      },
      {
        method: "DELETE",
        pattern: /^\/api\/events\/([^/]+)$/,
        handler: (_request, match) => {
          const id = decodeURIComponent(match[1]);
          if (!this.find(id)) {
            return { status: 404, body: errorBody("NOT_FOUND") };
          }
          this.events = this.events.filter((event) => event.eventId !== id);
          return { status: 204 };
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/events\/([^/]+)\/banner-upload$/,
        handler: (_request, match) => ({
          status: 200,
          body: {
            url: "https://upload.test/",
            fields: {
              key: `banners/${match[1]}/upload-1.png`,
              "Content-Type": "image/png",
              Policy: "synthetic-policy",
              "X-Amz-Signature": "synthetic-signature",
            },
            bannerReference: `banners/${match[1]}/upload-1.png`,
          },
        }),
      },
      {
        method: "POST",
        pattern: /^\/$/,
        handler: () => ({ status: 204 }),
      },
    );
  }

  private find(eventId: string): ManagementEvent | undefined {
    return this.events.find(
      (event) => event.eventId === eventId && event.lifecycleStatus === "active",
    );
  }
}

export function toResponse(result: FakeResponse): Response {
  if (result.status === 204) {
    return new Response(null, { status: 204 });
  }
  if (result.text !== undefined) {
    return new Response(result.text, {
      status: result.status,
      headers: { "content-type": result.contentType ?? "text/plain" },
    });
  }
  return new Response(JSON.stringify(result.body ?? {}), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}

/** Lets pending promise chains settle. */
export async function flush(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
