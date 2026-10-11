import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, NetworkError } from "../../../ui/src/api/client.js";
import { ERROR_CODES } from "../../../ui/src/api/types.js";
import { ERROR_COPY, messageForCode, messageForError } from "../../../ui/src/copy.js";
import { errorBody, FakeApi } from "./support/fake-api.js";

function client(api: FakeApi, token: string | null = "synthetic-id-token") {
  const onUnauthorized = vi.fn();
  const getIdToken = vi.fn(async () => token);
  return {
    client: new ApiClient({ getIdToken, onUnauthorized, fetchImpl: api.fetch }),
    onUnauthorized,
    getIdToken,
  };
}

describe("API client (D7)", () => {
  it("maps a JSON error body to ApiError with status, code, and field", async () => {
    const api = new FakeApi().on("POST", /^\/api\/events\/[^/]+\/rsvps$/, () => ({
      status: 400,
      body: errorBody("VALIDATION_ERROR", "email"),
    }));
    const error = await client(api)
      .client.createRsvp("seed-event-community-market", { displayName: "A", email: "bad" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "VALIDATION_ERROR", field: "email" });
  });

  it("maps API Gateway's plain 401 body to AUTHENTICATION_REQUIRED", async () => {
    const api = new FakeApi().on("GET", /^\/api\/organizer\/events$/, () => ({
      status: 401,
      body: { message: "Unauthorized" },
    }));
    const error = await client(api)
      .client.listOrganizerEvents()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED", field: null });
  });

  it("turns a failed request into a NetworkError", async () => {
    const api = new FakeApi().on("GET", /^\/api\/events$/, () => "network-error");
    await expect(client(api).client.listEvents()).rejects.toBeInstanceOf(NetworkError);
    expect(messageForError(new NetworkError())).toMatch(/couldn't reach the service/);
  });

  it("sends the Bearer ID token only on protected calls", async () => {
    const api = new FakeApi();
    const { client: apiClient } = client(api, "synthetic-id-token");
    await apiClient.listEvents({ category: "Community" });
    await apiClient.listOrganizerEvents();
    const [publicRequest, protectedRequest] = api.requests;
    expect(publicRequest.headers.get("authorization")).toBeNull();
    expect(publicRequest.url.search).toBe("?category=Community");
    expect(protectedRequest.headers.get("authorization")).toBe("Bearer synthetic-id-token");
  });

  it("signals the session handler on a protected 401 so it can clear and redirect", async () => {
    const api = new FakeApi().on("GET", /^\/api\/admin\/events$/, () => ({
      status: 401,
      body: { message: "Unauthorized" },
    }));
    const { client: apiClient, onUnauthorized } = client(api);
    await expect(apiClient.listAdminEvents()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not call the API on a protected route without a session", async () => {
    const api = new FakeApi();
    const { client: apiClient, onUnauthorized } = client(api, null);
    await expect(apiClient.getAdminStats()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(api.requests).toHaveLength(0);
  });

  it("returns no body for 204 responses", async () => {
    const api = new FakeApi();
    const { client: apiClient } = client(api);
    const response = await apiClient.request("DELETE", "/api/events/seed-event-community-market", {
      auth: true,
    });
    expect(response).toEqual({ status: 204, data: undefined });
  });

  it("gives every C-02 error code user copy that never shows the raw code", () => {
    for (const code of ERROR_CODES) {
      const message = messageForCode(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain(code);
      expect(messageForError(new ApiError(400, code, "raw", null))).toBe(message);
    }
    expect(messageForCode("SOMETHING_NEW")).toBe(ERROR_COPY.INTERNAL_ERROR);
  });
});
