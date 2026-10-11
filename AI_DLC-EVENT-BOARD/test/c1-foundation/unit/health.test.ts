import { describe, expect, it, vi } from "vitest";
import { createHealthResponse, handler } from "../../../src/lambda/health/handler.js";

describe("health response", () => {
  it("returns the deterministic C-02 success response", () => {
    expect(createHealthResponse()).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: '{"status":"ok"}',
    });
  });

  it("returns an unavailable response for an unsuccessful health probe", () => {
    expect(createHealthResponse(() => false)).toMatchObject({
      statusCode: 503,
      body: '{"status":"unavailable"}',
    });
  });

  it("maps probe exceptions to a deterministic safe error", () => {
    const result = createHealthResponse(() => {
      throw new Error("sensitive backend detail");
    });
    expect(result).toMatchObject({
      statusCode: 500,
      body: '{"status":"error","code":"HEALTH_CHECK_FAILED"}',
    });
    expect(result.body).not.toContain("sensitive backend detail");
  });

  it("does not leak an exception message through response headers", () => {
    const result = createHealthResponse(() => {
      throw new Error("secret-value");
    });
    expect(JSON.stringify(result.headers)).not.toContain("secret-value");
  });

  it("calls the provided health probe once", () => {
    const probe = vi.fn(() => true);
    createHealthResponse(probe);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("exposes the Lambda handler with the healthy response", async () => {
    await expect(handler()).resolves.toMatchObject({
      statusCode: 200,
      body: '{"status":"ok"}',
    });
  });
});
