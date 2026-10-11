// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkUi } from "../../../scripts/health-check-ui.js";

const SITE = "https://site.test";
const CONFIG = {
  region: "us-east-1",
  userPoolId: "us-east-1_TestPool1",
  userPoolClientId: "testclient123",
};

function stub(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    const route = routes[path];
    if (!route) {
      throw new Error(`Unexpected request to ${path}`);
    }
    return route();
  });
}

const html = (): Response =>
  new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
const json =
  (body: unknown): (() => Response) =>
  () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

describe("UI health check (D17)", () => {
  it("passes when the deep link serves HTML and config.json has the Cognito ids", async () => {
    const fetchImpl = stub({ "/events": html, "/config.json": json(CONFIG) });
    await expect(checkUi(SITE, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails when the deep link is not HTML or not 200", async () => {
    const xml = stub({
      "/events": () =>
        new Response("<Error/>", { status: 200, headers: { "content-type": "application/xml" } }),
      "/config.json": json(CONFIG),
    });
    await expect(checkUi(SITE, xml)).rejects.toThrow(/instead of text\/html/);
    const missing = stub({ "/events": () => new Response("denied", { status: 403 }) });
    await expect(checkUi(SITE, missing)).rejects.toThrow("UI deep link /events returned HTTP 403.");
  });

  it("fails when config.json is missing, not JSON, or lacks a Cognito id", async () => {
    await expect(
      checkUi(
        SITE,
        stub({ "/events": html, "/config.json": json({ ...CONFIG, userPoolClientId: "" }) }),
      ),
    ).rejects.toThrow("UI config.json has no userPoolClientId.");
    await expect(
      checkUi(
        SITE,
        stub({ "/events": html, "/config.json": () => new Response("<html>", { status: 200 }) }),
      ),
    ).rejects.toThrow("UI config.json is not valid JSON.");
    await expect(
      checkUi(
        SITE,
        stub({ "/events": html, "/config.json": () => new Response("", { status: 404 }) }),
      ),
    ).rejects.toThrow("UI config.json returned HTTP 404.");
  });
});
