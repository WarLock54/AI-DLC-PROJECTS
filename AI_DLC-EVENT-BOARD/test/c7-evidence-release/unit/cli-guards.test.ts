import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readFoundationOutputs, requireHttpsSiteUrl } from "../../../scripts/c5/outputs.js";
import { assertNotPipeline, assertOptIn } from "../../../scripts/evidence/guards.js";
import { findDebugEvidenceInPipeline } from "../../../scripts/evidence/manifest.js";
import { parseCleanupArguments } from "../../../scripts/evidence/render-cleanup.js";

const TSX = "node_modules/.bin/tsx";

/** Runs a CLI with a minimal environment: no AWS credentials, so any AWS call would fail loudly. */
function runCli(script: string, environment: Record<string, string> = {}, args: string[] = []) {
  return spawnSync(TSX, [`scripts/evidence/${script}`, ...args], {
    env: { PATH: process.env.PATH ?? "", ...environment },
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe("opt-in guards (unit)", () => {
  it("require the exact opt-in value", () => {
    expect(() => assertOptIn({}, "LOAD_TEST", "The load test")).toThrow(/Set LOAD_TEST=true/);
    expect(() => assertOptIn({ LOAD_TEST: "1" }, "LOAD_TEST", "The load test")).toThrow();
    expect(() => assertOptIn({ LOAD_TEST: "true" }, "LOAD_TEST", "The load test")).not.toThrow();
  });

  it("refuse to run inside a GitLab pipeline", () => {
    expect(() => assertNotPipeline({ GITLAB_CI: "true" })).toThrow(/never by the final/);
    expect(() => assertNotPipeline({})).not.toThrow();
  });
});

describe("evidence CLI entry points", () => {
  const cases = [
    ["load-test-cli.ts", "LOAD_TEST"],
    ["cleanup-evidence-cli.ts", "TEARDOWN_EVIDENCE"],
    ["ses-proof-cli.ts", "DEBUG_SANDBOX"],
  ] as const;

  for (const [script, optIn] of cases) {
    it(`${script} exits non-zero without ${optIn} and never reaches AWS`, () => {
      const run = runCli(script);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(`Set ${optIn}=true`);
    });

    it(`${script} refuses inside a GitLab pipeline even with the opt-in`, () => {
      const run = runCli(script, { [optIn]: "true", GITLAB_CI: "true" });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("GitLab pipeline");
    });
  }

  it("load test with opt-in but no credentials fails loudly before any AWS call", () => {
    const run = runCli("load-test-cli.ts", { LOAD_TEST: "true" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("AWS_ACCESS_KEY_ID");
  });

  it("SES proof with opt-in but no addresses fails loudly", () => {
    const run = runCli("ses-proof-cli.ts", { DEBUG_SANDBOX: "true" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("SES_PROOF_SENDER");
  });
});

describe("cleanup arguments", () => {
  it("parses the log path, exit status, and live flag", () => {
    expect(parseCleanupArguments(["--log", "t.log", "--exit-status", "0"])).toEqual({
      logPath: "t.log",
      exitStatus: 0,
      live: true,
    });
    expect(parseCleanupArguments(["--log", "t.log", "--exit-status", "2", "--no-live"]).live).toBe(
      false,
    );
  });

  it("rejects missing or malformed arguments", () => {
    expect(() => parseCleanupArguments([])).toThrow(/Usage/);
    expect(() => parseCleanupArguments(["--log", "t.log"])).toThrow(/Usage/);
    expect(() => parseCleanupArguments(["--log", "t.log", "--exit-status", "x"])).toThrow(/Usage/);
  });
});

describe("C-01 output parsing used by the load test", () => {
  const file = (stack: Record<string, string>) => async () =>
    JSON.stringify({ "team32-ceb-foundation": stack });

  it("reads the required outputs", async () => {
    const outputs = await readFoundationOutputs(
      ["SiteUrl", "UserPoolId"] as const,
      file({ SiteUrl: "https://d.example", UserPoolId: "pool" }),
    );
    expect(outputs).toEqual({ SiteUrl: "https://d.example", UserPoolId: "pool" });
  });

  it("reports missing or empty outputs and a missing stack", async () => {
    await expect(
      readFoundationOutputs(
        ["SiteUrl", "UserPoolId"] as const,
        file({ SiteUrl: "https://d.example" }),
      ),
    ).rejects.toThrow(/UserPoolId/);
    await expect(
      readFoundationOutputs(["SiteUrl"] as const, async () => JSON.stringify({})),
    ).rejects.toThrow(/missing/);
  });

  it("rejects a plain-HTTP site URL", () => {
    expect(() => requireHttpsSiteUrl("http://insecure.example")).toThrow(/HTTPS/);
    expect(requireHttpsSiteUrl("https://secure.example").protocol).toBe("https:");
  });
});

describe("pipeline definition", () => {
  const text = readFileSync(".gitlab-ci.yml", "utf8");
  const pipeline = parse(text) as Record<string, { script?: string[]; stage?: string }>;

  it("does not run any debug-only evidence command", () => {
    expect(findDebugEvidenceInPipeline(text)).toEqual([]);
  });

  it("keeps evidence commands out of the deploy path and the teardown job", () => {
    for (const job of ["deploy", "health-check", "teardown"]) {
      const scripts = (pipeline[job].script ?? []).join("\n");
      expect(scripts).not.toContain("evidence");
    }
  });

  it("runs the C7 unit tests and the manifest check in the validate stage", () => {
    expect(pipeline.test.script).toContain("npm run test:c7-evidence-release");
    expect(pipeline.lint.script).toContain("npm run evidence:manifest-check");
  });
});
