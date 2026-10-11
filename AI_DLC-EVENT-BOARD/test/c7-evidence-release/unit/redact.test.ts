import { describe, expect, it } from "vitest";
import { redact } from "../../../scripts/evidence/redact.js";

// Fake secrets are assembled at run time so secret scanners do not flag this file.
const accessKeyId = ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
const jwt = ["eyJhbGciOi", "eyJzdWIiOiIxMjM0", "c2lnbmF0dXJl"].join(".");
const accountId = ["1234", "5678", "9012"].join("");

describe("redact", () => {
  it("removes access key IDs, session tokens, and secret keys", () => {
    const sessionValue = ["abcdef", "123456"].join("");
    const secretValue = ["zzz", "999"].join("");
    const text = [
      `key ${accessKeyId}`,
      ["AWS_SESSION", "_TOKEN"].join("") + "=" + sessionValue,
      ["AWS_SECRET", "_ACCESS_KEY"].join("") + ": " + secretValue,
    ].join("\n");
    const out = redact(text);
    expect(out).not.toContain(accessKeyId);
    expect(out).not.toContain(sessionValue);
    expect(out).not.toContain(secretValue);
    expect(out).toContain("[redacted-access-key-id]");
  });

  it("removes ARNs and bare account IDs", () => {
    const arn = `arn:aws:cloudformation:us-east-1:${accountId}:stack/team32-ceb-foundation/guid`;
    const out = redact(`stack ${arn} in account ${accountId}.`);
    expect(out).not.toContain(accountId);
    expect(out).toContain("[redacted-arn]");
    expect(out).toContain("[redacted-account-id]");
  });

  it("removes JWTs and bearer tokens", () => {
    const out = redact(`token ${jwt} and Authorization: Bearer opaque-value_1`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("opaque-value_1");
  });

  it("removes cancellation tokens from JSON", () => {
    expect(redact('{"status":"confirmed","cancelToken":"abc123"}')).toBe(
      '{"status":"confirmed","cancelToken":"[redacted-token]"}',
    );
  });

  it("keeps the email domain but removes the local part", () => {
    expect(redact("sent to jane.doe+tag@example.com ok")).toBe("sent to [redacted]@example.com ok");
  });

  it("leaves ordinary evidence text unchanged", () => {
    const text = "p95 latency 320 ms across 1000 requests; stack team32-ceb-foundation.";
    expect(redact(text)).toBe(text);
  });
});
