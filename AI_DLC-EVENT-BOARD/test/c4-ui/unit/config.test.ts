import { describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "../../../ui/src/config.js";
import { toResponse } from "./support/fake-api.js";

const VALID = {
  region: "us-east-1",
  userPoolId: "us-east-1_TestPool1",
  userPoolClientId: "testclient123",
};

describe("config.json loading (D5)", () => {
  it("loads and returns a valid configuration", async () => {
    const fetchImpl = vi.fn(async () => toResponse({ status: 200, body: VALID }));
    await expect(loadConfig(fetchImpl)).resolves.toEqual(VALID);
  });

  it("fails when the file is missing", async () => {
    const fetchImpl = vi.fn(async () => toResponse({ status: 404, text: "missing" }));
    await expect(loadConfig(fetchImpl)).rejects.toThrow(/HTTP 404/);
  });

  it("fails when a required field is missing or malformed", async () => {
    const missing = vi.fn(async () =>
      toResponse({ status: 200, body: { region: "us-east-1", userPoolId: VALID.userPoolId } }),
    );
    await expect(loadConfig(missing)).rejects.toThrow(/userPoolClientId/);
    const malformed = vi.fn(async () =>
      toResponse({ status: 200, body: { ...VALID, userPoolId: "not a pool" } }),
    );
    await expect(loadConfig(malformed)).rejects.toBeInstanceOf(ConfigError);
  });

  it("fails when the body is not JSON or the request cannot be sent", async () => {
    const notJson = vi.fn(async () => toResponse({ status: 200, text: "<html></html>" }));
    await expect(loadConfig(notJson)).rejects.toThrow(/not valid JSON/);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadConfig(offline)).rejects.toBeInstanceOf(ConfigError);
  });

  it("requests /config.json without using the HTTP cache", async () => {
    const fetchImpl = vi.fn(async () => toResponse({ status: 200, body: VALID }));
    await loadConfig(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/config.json", { cache: "no-store" });
  });
});
