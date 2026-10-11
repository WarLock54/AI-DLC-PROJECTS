// D7: same-origin C-02 API client. Errors are surfaced as typed ApiError or
// NetworkError values; nothing is swallowed.
import type {
  AdminStats,
  ErrorCode,
  EventDetail,
  EventFilters,
  EventSummary,
  EventWrite,
  LifecycleStatus,
  ManagementEvent,
  PresignedPost,
  RsvpCreatedResponse,
  RsvpExistingResponse,
} from "./types.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly field: string | null;

  constructor(status: number, code: ErrorCode | string, message: string, field: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export class NetworkError extends Error {
  constructor() {
    super("The request could not reach the service.");
    this.name = "NetworkError";
  }
}

export interface ApiClientOptions {
  getIdToken: () => Promise<string | null>;
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

interface RequestOptions {
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | undefined>;
}

const FALLBACK_CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "AUTHENTICATION_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
};

export class ApiClient {
  private readonly options: ApiClientOptions;

  constructor(options: ApiClientOptions) {
    this.options = options;
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (options.auth) {
      const token = await this.options.getIdToken();
      if (!token) {
        this.options.onUnauthorized();
        throw new ApiError(401, "AUTHENTICATION_REQUIRED", "No active session.", null);
      }
      headers.authorization = `Bearer ${token}`;
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(withQuery(path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new NetworkError();
    }
    if (response.status === 401 && options.auth) {
      this.options.onUnauthorized();
    }
    if (!response.ok) {
      throw await toApiError(response);
    }
    if (response.status === 204) {
      return { status: 204, data: undefined as T };
    }
    return { status: response.status, data: (await response.json()) as T };
  }

  async listEvents(filters: EventFilters = {}): Promise<EventSummary[]> {
    const { data } = await this.request<{ events: EventSummary[] }>("GET", "/api/events", {
      query: { date: filters.date, category: filters.category, location: filters.location },
    });
    return data.events;
  }

  async getEvent(eventId: string): Promise<EventDetail> {
    return (await this.request<EventDetail>("GET", `/api/events/${encodeURIComponent(eventId)}`))
      .data;
  }

  createRsvp(
    eventId: string,
    body: { displayName: string; email: string },
  ): Promise<ApiResponse<RsvpCreatedResponse | RsvpExistingResponse>> {
    return this.request("POST", `/api/events/${encodeURIComponent(eventId)}/rsvps`, { body });
  }

  async cancelRsvp(cancelToken: string): Promise<void> {
    await this.request("POST", "/api/rsvps/cancel", { body: { cancelToken } });
  }

  async listOrganizerEvents(): Promise<ManagementEvent[]> {
    return (
      await this.request<{ events: ManagementEvent[] }>("GET", "/api/organizer/events", {
        auth: true,
      })
    ).data.events;
  }

  async listAdminEvents(status: LifecycleStatus = "active"): Promise<ManagementEvent[]> {
    return (
      await this.request<{ events: ManagementEvent[] }>("GET", "/api/admin/events", {
        auth: true,
        query: { status },
      })
    ).data.events;
  }

  async createEvent(body: EventWrite): Promise<EventDetail> {
    return (await this.request<EventDetail>("POST", "/api/events", { auth: true, body })).data;
  }

  async updateEvent(eventId: string, body: EventWrite): Promise<EventDetail> {
    return (
      await this.request<EventDetail>("PUT", `/api/events/${encodeURIComponent(eventId)}`, {
        auth: true,
        body,
      })
    ).data;
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request("DELETE", `/api/events/${encodeURIComponent(eventId)}`, { auth: true });
  }

  async createBannerUpload(eventId: string, contentType: string): Promise<PresignedPost> {
    return (
      await this.request<PresignedPost>(
        "POST",
        `/api/events/${encodeURIComponent(eventId)}/banner-upload`,
        { auth: true, body: { contentType } },
      )
    ).data;
  }

  async getAdminStats(): Promise<AdminStats> {
    return (await this.request<AdminStats>("GET", "/api/admin/stats", { auth: true })).data;
  }
}

function withQuery(path: string, query: Record<string, string | undefined> | undefined): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") {
      params.set(name, value);
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (isErrorBody(body)) {
    return new ApiError(response.status, body.code, body.message, body.field ?? null);
  }
  // API Gateway's own JWT rejection body is {"message":"Unauthorized"} (C3 D1).
  const code = FALLBACK_CODE_BY_STATUS[response.status] ?? "INTERNAL_ERROR";
  return new ApiError(response.status, code, `HTTP ${response.status}`, null);
}

function isErrorBody(
  body: unknown,
): body is { code: string; message: string; field?: string | null } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string" &&
    typeof (body as { message?: unknown }).message === "string"
  );
}
