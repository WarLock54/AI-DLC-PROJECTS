import { describe, expect, it } from "vitest";
import {
  SPA_REWRITE_FUNCTION_NAME,
  SPA_REWRITE_FUNCTION_SOURCE,
} from "../../../src/infrastructure/spa-rewrite.js";

interface CloudFrontRequest {
  uri: string;
  querystring: Record<string, { value: string }>;
}

// Evaluates the exact deployed source to obtain its handler.
const handler = new Function(`${SPA_REWRITE_FUNCTION_SOURCE}\nreturn handler;`)() as (event: {
  request: CloudFrontRequest;
}) => CloudFrontRequest;

function rewrite(
  uri: string,
  querystring: CloudFrontRequest["querystring"] = {},
): CloudFrontRequest {
  return handler({ request: { uri, querystring } });
}

describe("CloudFront SPA rewrite function (D4)", () => {
  it("is named with the team32-ceb- prefix", () => {
    expect(SPA_REWRITE_FUNCTION_NAME).toBe("team32-ceb-spa-rewrite");
  });

  it("rewrites / to /index.html", () => {
    expect(rewrite("/").uri).toBe("/index.html");
  });

  it("rewrites event list and detail deep links", () => {
    expect(rewrite("/events").uri).toBe("/index.html");
    expect(rewrite("/events/abc-123").uri).toBe("/index.html");
    expect(rewrite("/rsvp/cancel").uri).toBe("/index.html");
  });

  it("rewrites protected client routes", () => {
    expect(rewrite("/admin/stats").uri).toBe("/index.html");
    expect(rewrite("/organizer/events").uri).toBe("/index.html");
    expect(rewrite("/sign-in").uri).toBe("/index.html");
  });

  it("leaves file requests unchanged", () => {
    expect(rewrite("/app.js").uri).toBe("/app.js");
    expect(rewrite("/config.json").uri).toBe("/config.json");
    expect(rewrite("/styles.css").uri).toBe("/styles.css");
  });

  it("leaves /api and /api/* unchanged", () => {
    expect(rewrite("/api").uri).toBe("/api");
    expect(rewrite("/api/events").uri).toBe("/api/events");
    expect(rewrite("/api/events/x").uri).toBe("/api/events/x");
  });

  it("leaves /banners and /banners/* unchanged", () => {
    expect(rewrite("/banners").uri).toBe("/banners");
    expect(rewrite("/banners/e1/x.png").uri).toBe("/banners/e1/x.png");
    expect(rewrite("/banners/e1").uri).toBe("/banners/e1");
  });

  it("preserves the query string while rewriting", () => {
    const querystring = { returnTo: { value: "/admin/stats" } };
    const result = rewrite("/sign-in", querystring);
    expect(result.uri).toBe("/index.html");
    expect(result.querystring).toEqual({ returnTo: { value: "/admin/stats" } });
  });
});
