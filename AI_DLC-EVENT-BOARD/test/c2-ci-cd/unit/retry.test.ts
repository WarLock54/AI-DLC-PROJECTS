import { describe, expect, it } from "vitest";
import {
  parseRetryArguments,
  retryCommand,
  RetryExhaustedError,
  type CommandRunner,
} from "../../../scripts/ci/retry.js";

function scriptedRunner(failuresBeforeSuccess: number): {
  run: CommandRunner;
  calls: Array<{ command: string; args: readonly string[] }>;
} {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const run: CommandRunner = (command, args) => {
    calls.push({ command, args });
    if (calls.length <= failuresBeforeSuccess) {
      throw new Error(`transient failure ${calls.length}`);
    }
  };
  return { run, calls };
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms) => {
      waits.push(ms);
    },
  };
}

describe("retryCommand", () => {
  it("returns on the first successful attempt without sleeping", async () => {
    const { run, calls } = scriptedRunner(0);
    const { sleep, waits } = recordingSleep();
    const logs: string[] = [];

    const attempt = await retryCommand({
      command: "npm",
      args: ["run", "health-check"],
      attempts: 10,
      delayMs: 30_000,
      run,
      sleep,
      log: (message) => logs.push(message),
    });

    expect(attempt).toBe(1);
    expect(calls).toEqual([{ command: "npm", args: ["run", "health-check"] }]);
    expect(waits).toEqual([]);
    expect(logs).toEqual(["Attempt 1/10.", "Attempt 1/10 succeeded."]);
  });

  it("succeeds after transient failures and waits between attempts", async () => {
    const { run, calls } = scriptedRunner(2);
    const { sleep, waits } = recordingSleep();

    const attempt = await retryCommand({
      command: "npm",
      args: ["run", "health-check"],
      attempts: 5,
      delayMs: 1_000,
      run,
      sleep,
      log: () => undefined,
    });

    expect(attempt).toBe(3);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1_000, 1_000]);
  });

  it("fails after the final attempt and surfaces the last error as the cause", async () => {
    const { run, calls } = scriptedRunner(Number.POSITIVE_INFINITY);
    const { sleep, waits } = recordingSleep();

    const failure = await retryCommand({
      command: "npm",
      args: ["run", "health-check"],
      attempts: 3,
      delayMs: 10,
      run,
      sleep,
      log: () => undefined,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RetryExhaustedError);
    expect((failure as RetryExhaustedError).message).toBe("Command failed after 3 attempt(s).");
    expect(((failure as RetryExhaustedError).cause as Error).message).toBe("transient failure 3");
    expect(calls).toHaveLength(3);
    // No wait after the last attempt.
    expect(waits).toEqual([10, 10]);
  });

  it.each([
    { attempts: 0, delayMs: 0, message: /attempts/ },
    { attempts: 1.5, delayMs: 0, message: /attempts/ },
    { attempts: 1, delayMs: -1, message: /delay/ },
    { attempts: 1, delayMs: Number.NaN, message: /delay/ },
  ])(
    "rejects invalid bounds (attempts=$attempts, delayMs=$delayMs) before running",
    async ({ attempts, delayMs, message }) => {
      const { run, calls } = scriptedRunner(0);
      await expect(
        retryCommand({ command: "npm", args: [], attempts, delayMs, run, sleep: async () => {} }),
      ).rejects.toThrow(message);
      expect(calls).toHaveLength(0);
    },
  );

  it("rejects an empty command", async () => {
    await expect(
      retryCommand({
        command: " ",
        args: [],
        attempts: 1,
        delayMs: 0,
        run: () => undefined,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/command must not be empty/);
  });
});

describe("parseRetryArguments", () => {
  it("parses attempts, delay, and the command after the separator", () => {
    expect(
      parseRetryArguments([
        "--attempts",
        "10",
        "--delay-seconds",
        "30",
        "--",
        "npm",
        "run",
        "health-check",
      ]),
    ).toEqual({ attempts: 10, delaySeconds: 30, command: "npm", args: ["run", "health-check"] });
  });

  it.each([
    { argv: ["--attempts", "3", "--delay-seconds", "1", "npm"], message: /Missing `--`/ },
    { argv: ["--attempts", "3", "--delay-seconds", "1", "--"], message: /No command/ },
    { argv: ["--attempts", "3", "--", "npm"], message: /Both --attempts and --delay-seconds/ },
    { argv: ["--attempts", "x", "--delay-seconds", "1", "--", "npm"], message: /numeric/ },
    { argv: ["--attempts", "0", "--delay-seconds", "1", "--", "npm"], message: /attempts/ },
    { argv: ["--retries", "3", "--delay-seconds", "1", "--", "npm"], message: /Unknown option/ },
  ])("rejects malformed arguments: $argv", ({ argv, message }) => {
    expect(() => parseRetryArguments(argv)).toThrow(message);
  });
});
